/**
 * 宿主平面（**全局**）入口：`provide('ftshareData')`。
 *
 * 为什么这一行必须挂在全局、而不是金融 preset 里：preset 内 `provide` 会直接抛
 * `Preset services require isolate realms`
 * （`@deepseek-ai/dsh-agent-preset-registry` 的 `mount.ts`，`mountPreset` 结尾的
 * `leakedServices` 检查）；而按提示加上 `isolate` 之后，服务会变成 preset 私有
 * 的隔离域，preset 之外的插件再也 `inject` 不到，公用底座就白叫了。所以：
 * **provider 全局，工具与投影钩子在 preset**（见 `./tools`、`./project`）。
 *
 * 凭据一律走 `ctx.ftshareSettings.apiKey.resolve()`，本包不读任何凭据文件。
 * @module @ft/dsh-fft-ftshare
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import type {} from '@ft/dsh-fft-settings'

import { FTSHARE_DATA_SERVICE, type FtshareCallResult, type FtshareDataService, type FtshareToolInfo } from './contract.js'
import { asText, classifyFailure, isRecord, permissionNoticeFromPayload } from './errors.js'
import { createFtshareTransport, FTSHARE_GATEWAY_ENDPOINT, type FtshareTransport } from './transport.js'

export * from './contract.js'
export { FTSHARE_GATEWAY_ENDPOINT } from './transport.js'

/** Cordis 插件名。 */
export const name = '@ft/dsh-fft-ftshare'

/** 凭据来自设置服务；缺这一项本行挂起等待，属刻意的 fail-loud。 */
export const inject = ['ftshareSettings']

/** 本行发布的服务名。 */
export const provide = [FTSHARE_DATA_SERVICE]

/**
 * cordis 把 `provide` 混在 `ctx` 上，其类型来自 cordis 内部的**相对路径**模块增强
 * （`declare module './context.ts'`）。本包开着 `declaration: true` 时 TypeScript
 * 解析不到这类相对增强（实测：去掉 `declaration` 才看得到 `ctx.provide`），所以
 * 这里把要用到的那一个重载显式写出来。签名抄自 `@deepseek-ai/cordis` 的
 * `reflect.d.ts`，运行时调用与设置服务里的 `ctx.provide(...)` 完全一致。
 */
interface ProviderHost extends Context {
  provide(name: string, value?: unknown): () => void
}

/** 宿主行的可选配置。 */
export interface FtshareDataConfig {
  /** 覆盖网关地址；默认 {@link FTSHARE_GATEWAY_ENDPOINT}。 */
  endpoint?: string
  /** MCP 客户端自称的名字，只影响上游日志。 */
  clientName?: string
}

/** 建服务所需的依赖，全部可注入，便于测试。 */
export interface FtshareDataServiceOptions {
  /** 传输层；测试注入假实现即可完全不联网。 */
  transport: FtshareTransport
  /** 具名 logger。 */
  logger?: Logger
  /** 时钟，测试用来固定 `source.fetchedAt`。 */
  now?: () => Date
}

/**
 * 载荷里当「明细容器」看待的键，按优先级排列。
 *
 * 上游数据接口的返回形态不统一：多数是 `{"data":[…]}`，也有 `rows`/`items`/
 * `result`。这个列表是**读取顺序**，不是白名单——列表里没有的键会在兜底扫描里
 * 作为「任意数组」被找到。
 */
const PAYLOAD_KEYS = ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response'] as const

/** 只描述调用本身、不含事实的键；判断「是否存在事实」时忽略。 */
const ENVELOPE_KEYS = new Set(['ok', 'success', 'cached', 'metadata', 'message', 'error', 'code', 'status', 'request_id', 'permission', 'permissions', 'source'])

/** 只留下记录元素。 */
function recordsOf(value: unknown[]): Record<string, unknown>[] {
  return value.filter(isRecord)
}

/**
 * 从任意上游载荷里找出明细行。
 *
 * 规则按优先级：数组自己就是行；`data`/`rows`/… 里第一个非空数组是行；否则找第一
 * 个「元素是对象的数组」；再否则，若记录里还有非信封字段，就把整条记录当作一行
 * （单对象返回值也是数据）。只有「信封里什么都没有」才返回空数组，也就是
 * `empty`——这正是「真的没有数据」的定义。
 * @param value - 上游结构化载荷。
 * @returns 明细行；空数组表示确实没有数据。
 */
export function normalizeRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return recordsOf(value)
  if (!isRecord(value)) return []
  for (const key of PAYLOAD_KEYS) {
    if (!(key in value)) continue
    const found = normalizeRows(value[key])
    if (found.length > 0) return found
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (ENVELOPE_KEYS.has(key) || !Array.isArray(candidate)) continue
    const found = recordsOf(candidate)
    if (found.length > 0) return found
  }
  // 兜底：没有任何数组键、但确实带了非信封字段时，整条记录算一行。数组键（哪怕是
  // 空数组）已经在上面的扫描里表过态，不能再把 `{"data": []}` 读成「有一条数据」。
  const meaningful = Object.keys(value).filter(key => !ENVELOPE_KEYS.has(key) && !Array.isArray(value[key]))
  return meaningful.length > 0 ? [value] : []
}

/**
 * 上游接口清单的缓存时长。清单一天最多变几次，而目录产物是发版时生成的，运行期
 * 只用来回答「这个接口名上游认不认」，所以短缓存足够。
 */
const TOOLS_TTL_MS = 5 * 60_000

/**
 * 建一个 `ctx.ftshareData`。
 * @param options - 见 {@link FtshareDataServiceOptions}。
 * @returns 服务实现；`call` 不抛异常，失败走 `state`/`notice`。
 */
export function createFtshareDataService(options: FtshareDataServiceOptions): FtshareDataService {
  const now = options.now ?? (() => new Date())
  let cache: { tools: readonly FtshareToolInfo[]; at: number } | undefined

  return {
    async call(interfaceName, args = {}, callOptions): Promise<FtshareCallResult> {
      const source = { name: 'FTShare' as const, fetchedAt: now().toISOString() }
      const startedAt = Date.now()
      try {
        const { value } = await options.transport.call(interfaceName, args, callOptions)
        const rows = normalizeRows(value)
        if (rows.length > 0) return { ok: true, state: 'available', rows, source }
        const gated = permissionNoticeFromPayload(interfaceName, value)
        // 成功信封 + 权限标记 = 无权，不是没有数据。这是 P8 的第二种形态。
        if (gated !== undefined) return { ok: false, state: 'denied', rows: [], notice: gated, source }
        return { ok: true, state: 'empty', rows: [], source }
      } catch (error) {
        const { state, notice } = classifyFailure(error, interfaceName)
        options.logger?.warn('ftshare.call_classified', { tool: interfaceName, state, code: notice.code, durationMs: Date.now() - startedAt })
        return { ok: false, state, rows: [], notice, source }
      }
    },

    async listTools(): Promise<readonly FtshareToolInfo[]> {
      if (cache !== undefined && Date.now() - cache.at < TOOLS_TTL_MS) return cache.tools
      try {
        const tools = await options.transport.listTools()
        cache = { tools, at: Date.now() }
        return tools
      } catch (error) {
        // 清单是增强信息，不该让调用方拿到异常；失败就退回上一次的清单。
        options.logger?.warn('ftshare.list_tools_failed', { message: error instanceof Error ? error.message : String(error) })
        return cache?.tools ?? []
      }
    },
  }
}

/**
 * 取一次凭据。设置服务缺失或读取抛错都不让整行崩掉：返回 undefined，网关会以
 * 「未携带 API Key」给出可诊断的拒绝。
 * @param ctx - 宿主上下文。
 * @param logger - 具名 logger。
 * @returns API Key，或 undefined。
 */
async function resolveApiKey(ctx: Context, logger: Logger): Promise<string | undefined> {
  const apiKey = ctx.ftshareSettings?.apiKey
  if (apiKey === undefined) {
    logger.warn('ftshare.api_key_namespace_missing', { message: '设置服务未注册 API Key 命名空间，FTShare 取数将不可用' })
    return undefined
  }
  try {
    return asText(await apiKey.resolve())
  } catch (error) {
    logger.warn('ftshare.api_key_resolve_failed', { message: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}

/**
 * 注册 `ctx.ftshareData`。
 * @param ctx - 宿主上下文；必须是全局（根 loader）子树，preset 子树会抛错。
 * @param config - 可选配置。
 */
export function apply(ctx: Context, config?: FtshareDataConfig): void {
  const logger = ctx.logger('dsh-fft-ftshare')
  const transport = createFtshareTransport({
    endpoint: config?.endpoint,
    clientName: config?.clientName,
    resolveApiKey: () => resolveApiKey(ctx, logger),
    logger,
  })
  const host = ctx as ProviderHost
  host.provide(FTSHARE_DATA_SERVICE, createFtshareDataService({ transport, logger }))
}
