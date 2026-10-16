/**
 * preset 平面：把接口表里带 `expose` 的条目注册成 `ctx.tools` 里的 `ftshare_*` 工具，
 * 外加一个长尾入口 `ftshare_call`。
 *
 * 由 preset 行以子路径名 `@ft/dsh-fft-ftshare/tools` 挂载，因此这些工具只存在于
 * 所选 preset 的 agent 作用域内（标准模式下不存在）。取数走全局平面提供的
 * `ctx.ftshareData`，本平面不开连接、不碰凭据。
 *
 * 每个工具都把 {@link FtshareCallResult} 的四态结局原样印进正文：`denied` 说
 * 「当前套餐无权访问」，`empty` 才说「没有记录」。这是 P8 的教训——两种结局不能
 * 长得一样。
 * @module @ft/dsh-fft-ftshare/tools
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { FTSHARE_CAPABILITIES, type Capability } from './capabilities.js'
import { catalogEntryOf, missingRequiredArgs } from './catalog.js'
import { FTSHARE_CATALOG_INDEX_PATH, loadCatalog } from './catalog-host.js'
import { isRecord } from './errors.js'
import { renderCallResult } from './project.js'

export * from './capabilities.js'
export * from './catalog.js'

/** Cordis 插件名。 */
export const name = '@ft/dsh-fft-ftshare/tools'

/** 注册工具要 `tools`，取数要全局 plane 的 `ftshareData`。 */
export const inject = ['tools', 'ftshareData']

/**
 * 工具的规范化输出：渲染好的正文加四态结局。
 *
 * 结局单独留一个字段，是为了让 `presentResult` 之类的消费者将来能按状态取样式，
 * 而不必再解析正文。
 */
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tool: { type: 'string' },
    state: { type: 'string' },
    text: { type: 'string' },
  },
} as const satisfies ValueSchemaSpec

/** 所有 `ftshare_*` 工具共用的输出：正文加四态结局。 */
const toolOutput = {
  schema: outputSchema,
  render: (_args: unknown, value: { text?: string }) => [{ type: 'text' as const, text: value.text ?? '' }],
}

/** 接口表里要下发给模型的那部分（其余条目只供本仓程序调用）。 */
export const FTSHARE_EXPOSED_CAPABILITIES: readonly Capability[] =
  FTSHARE_CAPABILITIES.filter(entry => entry.expose !== undefined)

/** 长尾接口的通用直调工具名。 */
export const FTSHARE_CALL_TOOL = 'ftshare_call'

/**
 * 注册接口表里每一个暴露条目，外加一个通用直调。
 * @param ctx - preset 子树的上下文。
 */
export function apply(ctx: Context): void {
  const logger = ctx.logger('dsh-fft-ftshare-tools')
  for (const entry of FTSHARE_EXPOSED_CAPABILITIES) register(ctx, logger, entry)
  registerCatalogTool(ctx, logger)
}

/**
 * 注册单个接口表条目。
 * @param ctx - preset 子树的上下文。
 * @param logger - 具名 logger。
 * @param entry - 带 `expose` 的接口表条目。
 */
function register(ctx: Context, logger: Logger, entry: Capability): void {
  const exposed = entry.expose
  if (exposed === undefined) return
  ctx.tools.register(defineTool({
    name: exposed.name,
    description: `${entry.title}。${exposed.description}`,
    parameters: entry.args,
    output: toolOutput,
    async execute(args: unknown, exec: ToolRunContext) {
      const result = await ctx.ftshareData.call(entry.interface, (args ?? {}) as Record<string, unknown>, { signal: exec.signal })
      if (result.state === 'denied' || result.state === 'failed') {
        logger.warn('ftshare.tool_result', { tool: entry.interface, state: result.state, code: result.notice?.code })
      }
      return { tool: entry.interface, state: result.state, text: renderCallResult(entry.title, entry.interface, result) }
    },
  }))
}

/**
 * 注册通用直调：`ftshare_call(interface, args)`。
 *
 * 它是长尾接口的唯一入口——一个工具定义换掉 250 份 schema。三种结局各有各的话：
 * 名字不在目录（给出索引文件路径，让模型去 `grep`，而不是猜第二个名字）、套餐无权
 * （由 {@link renderCallResult} 带上升级入口）、配额用尽（由 errors 层附文案）。
 * @param ctx - preset 子树的上下文。
 * @param logger - 具名 logger。
 */
function registerCatalogTool(ctx: Context, logger: Logger): void {
  ctx.tools.register(defineTool({
    name: FTSHARE_CALL_TOOL,
    description:
      `直调 FTShare 目录里的任意接口。不要猜接口名：先在 ${FTSHARE_CATALOG_INDEX_PATH} 里 grep `
      + '（一行一个接口，格式 `接口名 | 标题 | 入参名`，带 * 的是必填），目录之外的名字会被拒绝。',
    parameters: {
      interface: { type: 'string', description: '上游接口名，必须来自目录索引', required: true },
      args: { type: 'object', additionalProperties: true, description: '接口入参；必填项见目录索引里带 * 的名字' },
    },
    output: toolOutput,
    async execute(args: unknown, exec: ToolRunContext) {
      const call = isRecord(args) ? args : {}
      const interfaceName = typeof call.interface === 'string' ? call.interface.trim() : ''
      const callArgs = isRecord(call.args) ? call.args : {}
      const entry = catalogEntryOf(loadCatalog(), interfaceName)
      if (entry === undefined) {
        return {
          tool: interfaceName,
          state: 'failed',
          text: `目录里没有接口 ${interfaceName === '' ? '（未给名字）' : interfaceName}，不能直调。`
            + `先在 ${FTSHARE_CATALOG_INDEX_PATH} 里 grep 一下：一行一个接口，格式「接口名 | 标题 | 入参名」。`,
        }
      }
      const missing = missingRequiredArgs(entry, callArgs)
      if (missing.length > 0) {
        return {
          tool: entry.name,
          state: 'failed',
          text: `缺必填入参：${missing.join('、')}。${entry.name} 的必填项见目录索引里带 * 的名字。`,
        }
      }
      const result = await ctx.ftshareData.call(entry.name, callArgs, { signal: exec.signal })
      if (result.state === 'denied' || result.state === 'failed') {
        logger.warn('ftshare.tool_result', { tool: entry.name, state: result.state, code: result.notice?.code })
      }
      return { tool: entry.name, state: result.state, text: renderCallResult(entry.title, entry.name, result) }
    },
  }))
}
