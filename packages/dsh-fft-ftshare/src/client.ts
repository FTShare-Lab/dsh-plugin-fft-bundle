/**
 * 浏览器助手：造一个与宿主**同名同形**的 `ftshareData`（**消费方自己挂**）。
 *
 * ```ts
 * ctx.provide('ftshareData', createFtshareClient({ catalog, fetch: window.fetch.bind(window) }))
 * ```
 *
 * 面板因此与宿主消费方写法一致：`state === 'denied'` 显示「去升级」，
 * `state === 'empty'` 才是「没有数据」。两处刻意的差别（设计 §5.2）：
 *
 * - **可调集合是目录全量**，不是模型那张策展接口表 —— 面板不受提示词预算约束；
 * - **发现靠本地 `search()`**，是对目录的纯函数，不发网络。
 *
 * 这个模块是**只读子集**：不碰凭据、不碰网关地址、不维护接口表。它只认两样输入——
 * 随包的目录与被注入的 `fetch`；`@dsh-ft/dsh-fft-ftshare/route` 与网关常量都不在这里的
 * 依赖里，`scripts/test-crossplane.mjs` 会 grep 产物把这条钉住。
 * @module @dsh-ft/dsh-fft-ftshare/client
 */

import { asCatalog, catalogEntryOf, missingRequiredArgs, type Catalog, type CatalogEntry } from './catalog.js'
import { FTSHARE_DATA_ROUTE, type FtshareCallResult, type FtshareCallOptions, type FtshareCallState, type FtshareDataService, type FtshareNotice, type FtshareToolInfo } from './contract.js'

/** 浏览器侧可用的 `fetch` 子集；测试直接注入假实现。 */
export type FtshareFetch = (input: string, init: RequestInit) => Promise<Response>

/** 客户端服务的调用选项。 */
export interface FtshareClientOptions {
  /** 随包目录（`catalog.json` 的解析结果），决定哪些接口可调。 */
  catalog: unknown
  /** 同源 fetch；浏览器传 `window.fetch.bind(window)`。 */
  fetch: FtshareFetch
  /** 路由覆盖，默认 {@link FTSHARE_DATA_ROUTE}。 */
  route?: string
  /** 成功结果的缓存时长；`denied` 与失败从不缓存。 */
  ttlMs?: number
  /** 时钟，测试用来固定 `source.fetchedAt`。 */
  now?: () => Date
}

/** 客户端服务：与 {@link FtshareDataService} 同名同形，另加一个本地检索。 */
export interface FtshareClientService extends FtshareDataService {
  /**
   * 在目录里本地检索（纯函数，不发网络）。
   * @param query - 关键词，大小写不敏感；空串返回前 `limit` 条。
   * @param limit - 最多返回条数，默认 20。
   * @returns 命中的目录条目。
   */
  search(query: string, limit?: number): CatalogEntry[]
}

/** 默认缓存时长：面板会连点，一次调用不值得重复出站；`denied` 例外。 */
const DEFAULT_TTL_MS = 60_000

/** 默认检索条数上限。 */
const DEFAULT_SEARCH_LIMIT = 20

/** 传输层失败（断网、超时、非 2xx、解析失败）统一落的结局。 */
const TRANSPORT_FAILURE: FtshareCallState = 'failed'

/** 四态集合；客户端只认这四个，别的一律当形状不符。 */
const STATES = new Set<FtshareCallState>(['available', 'empty', 'denied', 'failed'])

/** 判断一个值是不是可当对象读的记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 造一个客户端 `ftshareData`。
 * @param options - 见 {@link FtshareClientOptions}。
 * @returns 与宿主同名同形的服务，外加本地 `search()`。
 */
export function createFtshareClient(options: FtshareClientOptions): FtshareClientService {
  const catalog: Catalog = asCatalog(options.catalog)
  const route = options.route ?? FTSHARE_DATA_ROUTE
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => new Date())
  const send = options.fetch
  const cache = new Map<string, { at: number; result: FtshareCallResult }>()

  /** 本地就能定的失败：`source` 用客户端时钟，其余字段与宿主同形。 */
  const failure = (code: string, message: string, retryable = false): FtshareCallResult => ({
    ok: false,
    state: TRANSPORT_FAILURE,
    rows: [],
    notice: { code, message, retryable },
    source: { name: 'FTShare', fetchedAt: now().toISOString() },
  })

  /** 收敛远端返回；形状不对一律 undefined（由调用方落成 failed）。 */
  const asCallResult = (value: unknown): FtshareCallResult | undefined => {
    if (!isRecord(value)) return undefined
    const state = value.state
    if (typeof state !== 'string' || !STATES.has(state as FtshareCallState)) return undefined
    if (typeof value.ok !== 'boolean' || !Array.isArray(value.rows)) return undefined
    if (!isRecord(value.source)) return undefined
    const notice = value.notice
    const normalized: FtshareCallResult = {
      ok: value.ok,
      state: state as FtshareCallState,
      rows: value.rows.filter(isRecord),
      source: value.source as unknown as FtshareCallResult['source'],
      ...isRecord(notice) && typeof notice.code === 'string' && typeof notice.message === 'string'
        ? { notice: { ...notice, retryable: notice.retryable === true } as unknown as FtshareNotice }
        : {},
    }
    return normalized
  }

  return {
    async call(interfaceName, args = {}, callOptions?: FtshareCallOptions): Promise<FtshareCallResult> {
      const entry = catalogEntryOf(catalog, interfaceName)
      if (entry === undefined) {
        return failure('unknown_interface', `接口 ${interfaceName} 不在 FTShare 目录里，不能调用`)
      }
      const missing = missingRequiredArgs(entry, args)
      if (missing.length > 0) return failure('missing_arguments', `缺必填入参：${missing.join('、')}`)

      const key = `${interfaceName} ${JSON.stringify(args)}`
      const hit = cache.get(key)
      if (hit !== undefined && Date.now() - hit.at < ttlMs) return hit.result

      try {
        const response = await send(route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ interface: interfaceName, args }),
          ...callOptions?.signal === undefined ? {} : { signal: callOptions.signal },
        })
        if (!response.ok) {
          const detail = await readErrorBody(response)
          // 非 2xx 一律 failed：面板只需要一种方式渲染「取数失败」。
          return failure(detail?.code ?? `http_${response.status}`, detail?.message ?? `FTShare 取数失败（HTTP ${response.status}）`, true)
        }
        const result = asCallResult(await response.json())
        if (result === undefined) return failure('invalid_response', 'FTShare 底座返回的形状不对，无法渲染')
        // denied 不缓存：用户可能正好在另一个标签页里改了订阅或 Key。
        if (result.state !== 'denied') cache.set(key, { at: Date.now(), result })
        return result
      } catch (error) {
        return failure('transport_failed', `FTShare 取数失败：${error instanceof Error ? error.message : String(error)}`, true)
      }
    },

    async listTools(): Promise<readonly FtshareToolInfo[]> {
      // 面板不需要为清单再跑一趟网络：目录就是清单。
      return catalog.entries.map(entry => ({
        tool: entry.name,
        title: entry.title,
        ...entry.description !== undefined ? { description: entry.description } : {},
        ...entry.inputSchema !== undefined ? { inputSchema: entry.inputSchema } : {},
      }))
    },

    search(query, limit = DEFAULT_SEARCH_LIMIT) {
      const needle = query.trim().toLowerCase()
      const matched = needle === ''
        ? catalog.entries
        : catalog.entries.filter(entry =>
          entry.name.toLowerCase().includes(needle)
          || entry.title.toLowerCase().includes(needle)
          || (entry.description ?? '').toLowerCase().includes(needle))
      return matched.slice(0, Math.max(0, limit))
    },
  }
}

/** 读路由的错误信封；读不出来就返回 undefined，由调用方给通用措辞。 */
async function readErrorBody(response: Response): Promise<{ code: string; message: string } | undefined> {
  try {
    const body: unknown = await response.json()
    if (!isRecord(body) || !isRecord(body.error)) return undefined
    const code = typeof body.error.code === 'string' ? body.error.code : undefined
    const message = typeof body.error.message === 'string' ? body.error.message : undefined
    if (code === undefined || message === undefined) return undefined
    return { code, message }
  } catch {
    return undefined
  }
}
