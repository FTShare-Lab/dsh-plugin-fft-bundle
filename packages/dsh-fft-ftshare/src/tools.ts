/**
 * preset 平面：把接口表里带 `expose` 的条目注册成 `ctx.tools` 里的 `ftshare_*` 工具。
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
import { renderCallResult } from './project.js'

export * from './capabilities.js'

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

/** 接口表里要下发给模型的那部分（其余条目只供本仓程序调用）。 */
export const FTSHARE_EXPOSED_CAPABILITIES: readonly Capability[] =
  FTSHARE_CAPABILITIES.filter(entry => entry.expose !== undefined)

/**
 * 注册接口表里每一个暴露条目。
 * @param ctx - preset 子树的上下文。
 */
export function apply(ctx: Context): void {
  const logger = ctx.logger('dsh-fft-ftshare-tools')
  for (const entry of FTSHARE_EXPOSED_CAPABILITIES) register(ctx, logger, entry)
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
    output: {
      schema: outputSchema,
      render: (_args: unknown, value) => [{ type: 'text', text: value.text ?? '' }],
    },
    async execute(args: unknown, exec: ToolRunContext) {
      const result = await ctx.ftshareData.call(entry.interface, (args ?? {}) as Record<string, unknown>, { signal: exec.signal })
      if (result.state === 'denied' || result.state === 'failed') {
        logger.warn('ftshare.tool_result', { tool: entry.interface, state: result.state, code: result.notice?.code })
      }
      return { tool: entry.interface, state: result.state, text: renderCallResult(entry.title, entry.interface, result) }
    },
  }))
}
