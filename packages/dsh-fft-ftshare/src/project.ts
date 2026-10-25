/**
 * preset 平面：`tools/post-execute` 投影钩子。
 *
 * ### 它现在只做一件事
 *
 * `@ftshare-lab/dsh-kline` 的摘要式 MCP 工具把明细放进 `structuredContent`，
 * `content` 只有一行 `fetch_candles · 600519.XSHG · rows=250`。DSH 的 MCP 桥只把
 * `content` 投影给模型（`@deepseek-ai/dsh-mcp-client` 的 `createOutput`），所以模型
 * 看不到那 250 行（**P7**）；而且这行摘要把「真的没有」「套餐无权限（网关 403
 * `route_not_allowed`）」「取数失败」一律印成 `0`（**P8**）。
 *
 * 所以保留工具（K 线、指标、自选）的投影统一走通用渲染：摊开数组、写全标量、
 * 空数组写「无数据」，绝不输出 `key=count` 这类裸计数。
 *
 * 三个「明细藏在 `structuredContent`」的重灾区（`security_intelligence` /
 * `market_pulse` / `market_board_detail`）不再由本行接管：它们是 FTShare wrapper，
 * 已被 `./mask` 从模型可见面掩掉，替代能力走 `ctx.ftshareData`（见设计 §6）。
 *
 * ### 三条约束写死在实现里
 *
 * 1. **只替换 `content`，绝不动 `value`**——同时给 `content` 和 `value` 会抛
 *    `TypeError`（`postExecute` 里的显式检查）。
 * 2. **绝不用 `block`**——那会把结果变成错误。
 * 3. **形状不符就原样放行**（`return decision`）并记一条 warn，绝不吞结果。
 *
 * 钩子用 `ctx.on` 注册在 preset 子树里，DSH 对瀑布按 `exec.agent` 做作用域过滤，
 * 因此**只有金融模式的 agent 受影响**，标准模式一个字都不变。
 * @module @dsh-ft/dsh-fft-ftshare/project
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

import type { FtshareCallResult } from './contract.js'
import { asText, isRecord } from './errors.js'

/**
 * cordis 把 `on` 混在 `ctx` 上，其类型来自 cordis 内部的**相对路径**模块增强
 * （`declare module './context.ts'`）。本包开着 `declaration: true` 时 TypeScript
 * 解析不到这类相对增强，所以这里把要用到的那一个重载显式写出来，运行时行为不变。
 *
 * 刻意**不** `extends Context`：`@deepseek-ai/dsh-tools` 给这个事件声明的监听者带
 * `this: Scoped<ToolRuntime>`，而那句增强是否进了本次编译单元取决于文件处理顺序
 * （`src/capabilities.ts` 一进来就会把它带进程序）。extends 一旦撞上增强就报
 * TS2430，所以这里只描述「我需要的那一个方法」，用 `as unknown as` 收口。
 */
interface ProjectionHost {
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

/**
 * 接管投影的工具（MCP 公共名去掉前缀之后的那一段）。
 *
 * 只列保留工具：FTShare wrapper 那三个已由 `./mask` 掩掉，不再需要投影。
 * `analyze_kline` 不在列表里：它的 content 本身就是完整行情说明，重排它只会丢掉
 * 信息。
 */
export const PROJECTED_TOOLS: readonly string[] = [
  'fetch_candles',
  'calc_metrics',
  'analyze_kline_rows',
  'get_watchlist',
  'save_watchlist',
]

/** 通用渲染的条数上限，避免把上下文灌满。 */
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

/** 读数组；非数组得空数组。 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 读记录数组；过滤掉非对象元素。 */
function asRecords(value: unknown): Record<string, unknown>[] {
  return asArray(value).filter(isRecord)
}

/**
 * 「情报卡片」已经占用的字段；兜底渲染时要跳过，免得同一字段出现两次。
 * 形状见 `dsh-kline` 的 `_intelligence_item` / `_flow_history_items`。
 */
const ITEM_KEYS = new Set(['title', 'value', 'change', 'detail', 'tone'])

/**
 * 把一条记录渲染成一行。
 * @param row - 明细行。
 * @param label - 是否给 value 加「净额」、change 加「占比」这类业务标签。
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
 * 渲染一组明细，带条数上限。
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
 * 通用渲染：保留工具统一走它。
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
   * @param depth - 当前深度，限制在 3 层内。
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
 * @param publicName - 形如 `mcp__dsh-kline__fetch_candles`。
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
 * @param tool - 上游接口名。
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
  const host = ctx as unknown as ProjectionHost
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
