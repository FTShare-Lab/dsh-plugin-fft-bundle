/**
 * preset 平面：`tools/post-execute` 投影钩子 —— **P7/P8 的修复本体**。
 *
 * ### 病
 *
 * `@ftshare-lab/dsh-kline` 的摘要式 MCP 工具把明细只放进 `structuredContent`，
 * `content` 只有一行 `security_intelligence · 600519.XSHG · flows=10 · events=0`。
 * DSH 的 MCP 桥只把 `content` 投影给模型
 * （`thirdparty/deepseek-harness/packages/mcp/mcp-client/src/tools.ts`，`createOutput`），
 * 所以模型看不到那 10 条资金流（**P7**）。更糟的是这行摘要把「真的没有」「套餐
 * 无权限（网关 403 route_not_allowed）」「取数失败」一律印成 `0`（**P8**）。
 *
 * ### 药
 *
 * `tools/post-execute` 是 waterfall 钩子，签名 `(exec, result, next)`，返回
 * `{ kind: 'accept', content }` 即可替换模型可见文本
 * （`@deepseek-ai/dsh-tools` 的 `index.ts` 声明与 `postExecute` 实现）。`result`
 * 是 `ToolExecutionSuccess`，其 `value` 就是 MCP 工具返回的
 * `{ content, structuredContent }`，取之做纯函数渲染即可。
 *
 * 三条约束写死在实现里：
 * 1. **只替换 `content`，绝不动 `value`**——同时给 `content` 和 `value` 会抛
 *    `TypeError`（`postExecute` 里的显式检查）。
 * 2. **绝不用 `block`**——那会把结果变成错误。
 * 3. **形状不符就原样放行**（`return decision`）并记一条 warn，绝不吞结果。
 *
 * 钩子用 `ctx.on` 注册在 preset 子树里，DSH 对瀑布按 `exec.agent` 做作用域过滤，
 * 因此**只有金融模式的 agent 受影响**，标准模式一个字都不变。
 * @module @ft/dsh-fft-ftshare/project
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

import type { FtshareCallResult } from './contract.js'
import { asText, isPermissionSignal, isRecord } from './errors.js'

/**
 * cordis 把 `on` 混在 `ctx` 上，其类型来自 cordis 内部的**相对路径**模块增强
 * （`declare module './context.ts'`）。本包开着 `declaration: true` 时 TypeScript
 * 解析不到这类相对增强，所以这里把 `tools/post-execute` 那一个重载显式写出来；
 * 签名逐字抄自 `@deepseek-ai/dsh-tools` 的事件声明，运行时行为不变。
 */
interface ProjectionHost extends Context {
  on(
    name: 'tools/post-execute',
    listener: (
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>,
  ): () => boolean
}

/** MCP 公共名的服务器段：`mcp__<server>__<tool>`。缺省只接管 dsh-kline。 */
export const DEFAULT_MCP_SERVER_NAME = 'dsh-kline'

/** 有专属渲染器的工具。 */
const CUSTOM_RENDERED = new Set(['security_intelligence', 'market_pulse', 'market_board_detail'])

/**
 * 接管投影的工具（MCP 公共名去掉前缀之后的那一段）。
 *
 * 前三个是「明细藏在 structuredContent」的重灾区；后五个只要求「不再输出裸计数」，
 * 走通用渲染。`analyze_kline` 不在列表里：它的 content 本身就是完整行情说明，
 * 重排它只会丢掉信息。
 */
export const PROJECTED_TOOLS: readonly string[] = [
  'security_intelligence',
  'market_pulse',
  'market_board_detail',
  'fetch_candles',
  'calc_metrics',
  'analyze_kline_rows',
  'get_watchlist',
  'save_watchlist',
]

/** 各类列表的渲染条数上限，避免把上下文灌满。 */
const MAX_FLOW_ITEMS = 10
const MAX_SECTOR_ITEMS = 8
const MAX_EVENT_ITEMS = 8
const MAX_GENERIC_ITEMS = 8
/** 整段投影的字符上限；超长按行截断。 */
const MAX_CHARS = 4000

/** 四态结局的中文名。 */
const STATE_LABELS: Record<string, string> = {
  available: '可用',
  empty: '无数据',
  denied: '无权访问',
  failed: '取数失败',
}

/** 段落状态的中文措辞。 */
const SECTION_STATES: Record<string, string> = {
  empty: '无数据',
  deferred: '本次未请求',
  not_applicable: '不适用于该标的',
  unsupported: '该数据源不支持该接口',
  source_dependent: '取决于数据源，暂无数据',
}

/** 读数组；非数组得空数组。 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 读记录数组；过滤掉非对象元素。 */
function asRecords(value: unknown): Record<string, unknown>[] {
  return asArray(value).filter(isRecord)
}

/**
 * 把内部记录读成段落视图 `{state, errors}`。
 * @param value - `sections.<name>` 的值。
 * @returns 状态与错误列表；缺字段按 `unknown` 处理。
 */
function readSection(value: unknown): { state: string; errors: Record<string, unknown>[] } {
  const record = isRecord(value) ? value : {}
  return { state: asText(record.state) ?? 'unknown', errors: asRecords(record.errors) }
}

/** 一条段落错误的可读文本。 */
function errorText(error: Record<string, unknown>): string {
  return [asText(error.code), asText(error.message)].filter(part => part !== undefined).join('：')
}

/** 该段落错误是否表达「无权访问」。 */
function isDenialError(error: Record<string, unknown>): boolean {
  return isPermissionSignal(asText(error.code), asText(error.message) ?? '')
}

/** 属于「路由/能力未开通」的拒绝码：这一类才是网关的 403 route_not_allowed。 */
const ROUTE_DENIAL_CODES = new Set(['route_not_allowed', 'capability_limited', '403', 'forbidden', 'permission_denied', 'insufficient_permissions', 'subscription_required', 'quota_exceeded', 'insufficient_quota'])

/** 凭据类拒绝：与套餐档位无关，不能笼统说成「套餐无权」。 */
const CREDENTIAL_DENIAL_CODES = new Set(['401', 'unauthorized', 'invalid_key', 'invalid_api_key', 'auth_required'])

/**
 * 一段的「无权访问」措辞。
 *
 * 刻意把网关的真实原因（HTTP 403 `route_not_allowed`）和「不是没有数据」一起写
 * 出来：这正是 P8 被误读的地方。凭据问题单独措辞，免得把「没配 Key」说成「套餐
 * 不够」。
 * @param label - 段落名。
 * @param error - 触发该措辞的上游错误。
 * @param emptyHint - 被误读成「没有 X」的那个 X。
 * @returns 一行状态文本。
 */
function denialLine(label: string, error: Record<string, unknown>, emptyHint: string): string {
  const detail = errorText(error)
  const code = asText(error.code)?.toLowerCase()
  const tail = detail === '' ? '' : `。上游标记 ${detail}`
  if (code !== undefined && CREDENTIAL_DENIAL_CODES.has(code)) {
    return `${label}：✗ FTShare 凭据未配置或无效（${code}）—— 不是“${emptyHint}”${tail}`
  }
  const reason = code === undefined || ROUTE_DENIAL_CODES.has(code) ? '403 route_not_allowed' : code
  return `${label}：✗ 当前套餐无权访问该接口（${reason}）—— 不是“${emptyHint}”${tail}`
}

/**
 * 渲染一段的状态行。
 * @param label - 段落名。
 * @param section - `sections.<name>` 的值。
 * @param emptyHint - 该段落「空」时的说法，例如「没有事件」。
 * @param count - 已渲染的条数，用于 `partial` 措辞。
 * @returns 一行状态文本。
 */
function sectionStatusLine(label: string, section: unknown, emptyHint: string, count: number): string {
  const { state, errors } = readSection(section)
  const denial = errors.find(isDenialError)
  if (state === 'available') return `${label}：可用`
  if (state === 'empty') return `${label}：无数据（上游返回成功且没有权限限制，只是没有记录）`
  if (state === 'partial') {
    const missing = errors.map(errorText).filter(text => text !== '')
    const tail = denial !== undefined
      ? `其中一段无权访问（403 route_not_allowed）—— 不是“${emptyHint}”`
      : `缺失：${missing.length > 0 ? missing.join('；') : '部分数据'}`
    return `${label}：部分可用（已返回 ${count} 条；${tail}）`
  }
  if (state === 'error') {
    if (denial !== undefined) return denialLine(label, denial, emptyHint)
    const missing = errors.map(errorText).filter(text => text !== '')
    return `${label}：✗ 取数失败（${missing.length > 0 ? missing.join('；') : '上游未给出原因'}）`
  }
  const known = SECTION_STATES[state]
  if (known !== undefined) return `${label}：${known}`
  return `${label}：状态未知（${state}）`
}

/**
 * 「情报卡片」已经占用的字段；兜底渲染时要跳过，免得同一字段出现两次。
 * 形状见 `dsh-kline` 的 `_intelligence_item` / `_flow_history_items`。
 */
const ITEM_KEYS = new Set(['title', 'value', 'change', 'detail', 'tone'])

/**
 * 把一条记录渲染成一行。
 * @param row - 明细行。
 * @param label - 是否给 value 加「净额」、change 加「占比」这类业务标签
 *   （资金流用标签，同类公司/事件这类混合语义的行不加，免得贴错标签）。
 * @returns 一行文本，或 undefined（整行没有任何可读字段）。
 */
function itemLine(row: Record<string, unknown>, label: boolean): string | undefined {
  const value = asText(row.value)
  const change = asText(row.change)
  const parts = [
    asText(row.title),
    value === undefined ? undefined : label ? `净额 ${value}` : value,
    change === undefined ? undefined : label ? `占比 ${change}` : change,
    asText(row.detail),
  ].filter((part): part is string => part !== undefined)
  if (parts.length === 0) {
    // 不是情报卡片（例如原始 K 线行）就如实摊开标量字段，总比什么都不显示强。
    for (const [key, field] of Object.entries(row)) {
      if (ITEM_KEYS.has(key) || field === null || field === undefined || typeof field === 'object') continue
      parts.push(`${key} ${String(field)}`)
    }
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * 渲染一组情报卡片，带条数上限。
 * @param rows - 明细行。
 * @param cap - 最多渲染条数。
 * @param label - 传给 {@link itemLine} 的标签开关。
 * @returns 渲染出的行数组。
 */
function renderItems(rows: Record<string, unknown>[], cap: number, label: boolean): string[] {
  const lines: string[] = []
  let printed = 0
  for (const row of rows.slice(0, cap)) {
    const rendered = itemLine(row, label)
    if (rendered === undefined) continue
    printed += 1
    lines.push(`${printed}. ${rendered}`)
  }
  if (rows.length > cap) lines.push(`（共 ${rows.length} 条，此处只显示前 ${cap} 条）`)
  return lines
}

/** 数据来源行。 */
function sourceLine(source: unknown): string | undefined {
  const record = isRecord(source) ? source : undefined
  if (record === undefined) return undefined
  const name = asText(record.name)
  const updated = asText(record.updated_at) ?? asText(record.updatedAt) ?? asText(record.fetchedAt)
  const status = asText(record.status)
  const parts = [name, updated ?? status].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? undefined : `数据源 ${parts.join(' · ')}`
}

/**
 * 收口：拼行、去空、限长。
 * @param lines - 渲染出的行。
 * @returns 文本，或 undefined（没有任何可渲染内容时放行原结果）。
 */
function finish(lines: string[]): string | undefined {
  const text = lines.filter(line => line.trim() !== '').join('\n')
  if (text === '') return undefined
  if (text.length <= MAX_CHARS) return text
  const cut = text.lastIndexOf('\n', MAX_CHARS)
  return `${text.slice(0, cut > 0 ? cut : MAX_CHARS)}\n…（内容过长，已截断）`
}

/**
 * `security_intelligence` 的投影：逐条渲染资金流，并把三段状态显式化。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；形状不符时 undefined（调用方原样放行）。
 */
export function renderSecurityIntelligence(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const intel = isRecord(payload.security_intelligence) ? payload.security_intelligence : undefined
  const sections = isRecord(payload.sections) ? payload.sections : undefined
  if (intel === undefined && sections === undefined) return undefined
  const lines: string[] = []
  const header = [asText(payload.symbol), asText(intel?.name), sourceLine(payload.source)]
    .filter((part): part is string => part !== undefined)
  lines.push(`标的情报${header.length > 0 ? ` · ${header.join(' · ')}` : ''}`)

  const flows = asRecords(intel?.flows)
  if (sections?.flows !== undefined || flows.length > 0) {
    lines.push(sectionStatusLine('资金流', sections?.flows, '没有资金流数据', flows.length))
    lines.push(...renderItems(flows, MAX_FLOW_ITEMS, true))
  }

  const sector = isRecord(intel?.sector) ? intel.sector : undefined
  const sectorFlow = asRecords(sector?.flow)
  const peers = asRecords(sector?.peers)
  if (sections?.sector !== undefined || sector !== undefined) {
    lines.push(sectionStatusLine('板块', sections?.sector, '没有板块数据', sectorFlow.length + peers.length))
    const industry = asText(sector?.industry)
    if (industry !== undefined && industry !== '--') lines.push(`所属行业：${industry}`)
    if (sectorFlow.length > 0) {
      lines.push(`板块资金流（${sectorFlow.length} 条）`)
      lines.push(...renderItems(sectorFlow, MAX_SECTOR_ITEMS, true))
    }
    if (peers.length > 0) {
      lines.push(`同类公司（${peers.length} 条）`)
      lines.push(...renderItems(peers, MAX_SECTOR_ITEMS, false))
    }
  }

  const events = asRecords(intel?.events)
  if (sections?.events !== undefined || events.length > 0) {
    lines.push(sectionStatusLine('交易事件', sections?.events, '没有事件', events.length))
    lines.push(...renderItems(events, MAX_EVENT_ITEMS, false))
  }
  return finish(lines)
}

/**
 * `market_pulse` 的投影。`sections` 决定渲染哪些分组，因此「本次未请求」也能显式
 * 说出来，而不是看着空。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；形状不符时 undefined。
 */
export function renderMarketPulse(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const pulse = isRecord(payload.market_pulse) ? payload.market_pulse : undefined
  const sections = isRecord(payload.sections) ? payload.sections : undefined
  if (pulse === undefined && sections === undefined) return undefined
  const asOf = asText(pulse?.as_of)
  const source = sourceLine(payload.source)
  const lines = [`市场脉搏 · ${[asOf ?? '最新', source].filter(part => part !== undefined).join(' · ')}`]

  const rankings = isRecord(pulse?.rankings) ? pulse.rankings : undefined
  const groups: Array<{ key: string; label: string; rows: Record<string, unknown>[] }> = [
    { key: 'breadth', label: '涨跌停家数', rows: asRecords(pulse?.breadth) },
    { key: 'flows', label: '资金流', rows: asRecords(pulse?.flows) },
    { key: 'sectors', label: '热门行业', rows: asRecords(pulse?.hot_sectors) },
    { key: 'concepts', label: '热门概念', rows: asRecords(pulse?.hot_concepts) },
    { key: 'rankings', label: '人气与异动榜', rows: [...asRecords(rankings?.hot), ...asRecords(rankings?.surging)] },
    { key: 'events', label: '异动', rows: asRecords(pulse?.abnormal_trading) },
  ]
  const requested = sections === undefined ? undefined : Object.keys(sections)
  for (const group of groups) {
    const section = sections?.[group.key]
    // 没声明 sections 的老载荷，按「有数据就渲染」处理；声明了就按声明走，
    // 这样 deferred（本次未请求）才不会被误读成空。
    if (requested !== undefined && !requested.includes(group.key)) continue
    if (section === undefined && group.rows.length === 0) continue
    lines.push(sectionStatusLine(group.label, section, `没有${group.label}`, group.rows.length))
    lines.push(...renderItems(group.rows, MAX_SECTOR_ITEMS, false))
  }
  const hotSource = asText(rankings?.hot_source)
  if (hotSource !== undefined) lines.push(`榜单来源：${hotSource}`)
  return finish(lines)
}

/**
 * `market_board_detail` 的投影。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；形状不符时 undefined。
 */
export function renderMarketBoardDetail(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const board = isRecord(payload.board) ? payload.board : undefined
  const sections = isRecord(payload.sections) ? payload.sections : undefined
  if (board === undefined && sections === undefined) return undefined
  const name = asText(board?.name)
  const kind = asText(board?.kind)
  const code = asText(board?.code)
  const source = sourceLine(payload.source)
  const head = [name ?? code ?? '板块', kind, source].filter((part): part is string => part !== undefined)
  const lines = [`板块详情 · ${head.join(' · ')}`]
  const history = asRecords(board?.history)
  if (sections?.board !== undefined || board !== undefined) {
    lines.push(sectionStatusLine('板块行情', sections?.board, '没有板块行情', history.length))
  }
  const snapshot = isRecord(board?.snapshot) ? board.snapshot : undefined
  if (snapshot !== undefined) {
    const rendered = itemLine(snapshot, true)
    if (rendered !== undefined) lines.push(`快照：${rendered}`)
  }
  if (history.length > 0) {
    lines.push(`资金流历史（${history.length} 条）`)
    lines.push(...renderItems(history, MAX_SECTOR_ITEMS, true))
  }
  if (sections?.members !== undefined) {
    lines.push(sectionStatusLine('成分股', sections.members, '没有成分股数据', asRecords(board?.members).length))
    lines.push(...renderItems(asRecords(board?.members), MAX_SECTOR_ITEMS, false))
  }
  return finish(lines)
}

/**
 * 通用渲染：给没有专属渲染器的摘要式工具用。
 *
 * 只做两件正确的事：把数组摊开、把标量写全。**不输出 `key=count` 这类裸计数**——
 * 那正是 P8 的形态；数组为空时写「无数据」，不写 `0`。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；没有可渲染内容时 undefined（放行原结果）。
 */
export function renderGenericPayload(payload: unknown): string | undefined {
  const lines: string[] = []
  /**
   * 递归摊平一层层对象；数组只摊开一层元素。
   * @param value - 当前值。
   * @param prefix - 键路径前缀。
   * @param depth - 当前深度，限制在 2 层内。
   */
  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord)
      if (value.length === 0) {
        lines.push(`${prefix}：无数据`)
        return
      }
      if (rows.length === 0) {
        lines.push(`${prefix}（${value.length} 条）：${value.slice(0, MAX_GENERIC_ITEMS).map(item => String(item)).join('、')}`)
        return
      }
      const rendered = renderItems(rows, MAX_GENERIC_ITEMS, false)
      lines.push(`${prefix}（${value.length} 条）`, ...rendered)
      return
    }
    if (isRecord(value)) {
      if (prefix === 'source' || prefix === 'metadata') return
      if (depth >= 3) {
        lines.push(`${prefix}：${Object.keys(value).length} 个字段`)
        return
      }
      const keys = Object.keys(value).filter(key => key !== 'metadata' && key !== 'source')
      if (keys.length === 0) {
        lines.push(`${prefix}：无数据`)
        return
      }
      for (const key of keys) walk(value[key], prefix === '' ? key : `${prefix}.${key}`, depth + 1)
      return
    }
    if (value === null || value === undefined) return
    lines.push(`${prefix}：${String(value)}`)
  }

  if (!isRecord(payload)) return undefined
  const envelope = new Set(['ok', 'success', 'cached', 'metadata', 'source'])
  for (const [key, value] of Object.entries(payload)) {
    if (envelope.has(key)) continue
    walk(value, key, 1)
  }
  const source = sourceLine(payload.source)
  if (source !== undefined) lines.push(source)
  return finish(lines)
}

/**
 * 把 MCP 公共名拆成服务器段与工具段。
 * @param publicName - 形如 `mcp__dsh-kline__security_intelligence`。
 * @returns 两段名字；不是 MCP 公共名时 undefined。
 */
export function mcpToolNameOf(publicName: string): { server: string; tool: string } | undefined {
  const matched = /^mcp__(.+?)__(.+)$/u.exec(publicName)
  if (matched === null) return undefined
  const [, server, tool] = matched
  return server === undefined || tool === undefined ? undefined : { server, tool }
}

/** 该工具是否由本包接管投影。 */
export function isProjectedTool(tool: string): boolean {
  return PROJECTED_TOOLS.includes(tool)
}

/**
 * 纯函数：给公共工具名与结果值，产出替换用的文本。
 * @param publicName - MCP 公共名。
 * @param value - `ToolExecutionSuccess.value`（MCP 的 `{content, structuredContent}`）。
 * @returns 模型可见文本；不接管或形状不符时 undefined。
 */
export function renderProjection(publicName: string, value: unknown): string | undefined {
  const parsed = mcpToolNameOf(publicName)
  if (parsed === undefined || parsed.server !== DEFAULT_MCP_SERVER_NAME) return undefined
  if (!isProjectedTool(parsed.tool)) return undefined
  // MCP 桥的 value 是 `{content, structuredContent}`；明细只在后者里。
  const payload = isRecord(value) && value.structuredContent !== undefined ? value.structuredContent : value
  if (CUSTOM_RENDERED.has(parsed.tool)) {
    if (parsed.tool === 'security_intelligence') return renderSecurityIntelligence(payload)
    if (parsed.tool === 'market_pulse') return renderMarketPulse(payload)
    return renderMarketBoardDetail(payload)
  }
  return renderGenericPayload(payload)
}

/**
 * 纯函数：算出要替换的 `content`。
 *
 * 文本块被替换，非文本块（图片等）原样保留在末尾；失败结果与无可渲染内容一律
 * 返回 undefined，由调用方原样放行。
 * @param name - 公共工具名。
 * @param result - 归一后的执行结果视图。
 * @returns 新的 content 数组，或 undefined。
 */
export function projectContent(
  name: string,
  result: { isError: boolean; value?: unknown; content: ContentBlock[] },
): ContentBlock[] | undefined {
  if (result.isError) return undefined
  const text = renderProjection(name, result.value)
  if (text === undefined) return undefined
  const preserved = result.content.filter(block => block.type !== 'text')
  return [...preserved, { type: 'text', text }]
}

/**
 * 把一次 `ctx.ftshareData.call()` 的结果渲染成模型可见文本（工具平面与投影平面共用）。
 * @param title - 中文标题。
 * @param tool - 上游工具名。
 * @param result - 归一结果。
 * @returns 文本。
 */
export function renderCallResult(title: string, tool: string, result: FtshareCallResult): string {
  const lines = [`${title}（${tool}）：${STATE_LABELS[result.state] ?? result.state}`]
  const notice = result.notice
  if (notice !== undefined) {
    lines.push(`⚠ ${notice.message}`)
    if (notice.requiredPlan !== undefined) lines.push(`所需订阅：${notice.requiredPlan}`)
    if (notice.upgradeUrl !== undefined) lines.push(`升级入口：${notice.upgradeUrl}`)
    if (notice.retryable) lines.push('该失败可重试。')
  }
  if (result.state === 'available') lines.push(...renderItems(result.rows, MAX_GENERIC_ITEMS, false))
  if (result.state === 'empty') lines.push('上游返回成功、没有权限限制标记，只是没有记录。')
  lines.push(sourceLine(result.source) ?? `数据源 FTShare · ${result.source.fetchedAt}`)
  return lines.join('\n')
}

/**
 * 注册投影钩子。必须在 preset 子树里挂载：DSH 对 `tools/post-execute` 按
 * `exec.agent` 做作用域过滤，钩子只对所选 preset 的 agent 生效。
 * @param ctx - preset 子树的上下文。
 */
export function apply(ctx: Context): void {
  const logger = ctx.logger('dsh-fft-ftshare-projection')
  const host = ctx as ProjectionHost
  host.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    // 先让下游听完：本钩子只做「补充投影」，不该改变别人的决定。
    const decision = await next()
    try {
      if (result.isError) return decision
      const parsed = mcpToolNameOf(exec.name)
      if (parsed === undefined || parsed.server !== DEFAULT_MCP_SERVER_NAME || !isProjectedTool(parsed.tool)) return decision
      // 下游若整块替换了 value，或把结果判成失败，就别再动 content。
      if (decision.kind === 'block' || Object.hasOwn(decision, 'value')) return decision
      const content = projectContent(exec.name, { isError: result.isError, value: result.value, content: result.content })
      if (content === undefined) {
        const payload = isRecord(result.value) && result.value.structuredContent !== undefined ? result.value.structuredContent : result.value
        logger.warn('ftshare.projection_shape_mismatch', {
          tool: exec.name,
          keys: isRecord(payload) ? Object.keys(payload).join(',') : typeof payload,
        })
        return decision
      }
      return {
        kind: 'accept',
        content,
        ...(decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {}),
      }
    } catch (error) {
      logger.warn('ftshare.projection_failed', {
        tool: exec.name,
        message: error instanceof Error ? error.message : String(error),
      })
      return decision
    }
  })
}
