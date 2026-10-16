/**
 * preset 平面：把 {@link FTSHARE_TOOL_WHITELIST} 注册成 `ctx.tools` 里的
 * `ftshare_*` 工具。
 *
 * 由 preset 行以子路径名 `@ft/dsh-fft-ftshare/tools` 挂载，因此这些工具只存在于
 * 所选 preset 的 agent 作用域内（标准模式下不存在）。取数走全局 plane 提供的
 * `ctx.ftshareData`，本平面不开连接、不碰凭据。
 *
 * 每个工具都把 {@link FtshareCallResult} 的四态结局原样印进正文：`denied` 说
 * 「当前套餐无权访问」，`empty` 才说「没有记录」。这是 P8 的教训——两种结局不能
 * 长得一样。
 * @module @ft/dsh-fft-ftshare/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { renderCallResult } from './project.js';
import { FTSHARE_TOOL_WHITELIST } from './whitelist.js';
export { FTSHARE_TOOL_WHITELIST, FTSHARE_TOOL_BY_NAME } from './whitelist.js';
/** Cordis 插件名。 */
export const name = '@ft/dsh-fft-ftshare/tools';
/** 注册工具要 `tools`，取数要全局 plane 的 `ftshareData`。 */
export const inject = ['tools', 'ftshareData'];
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
};
/**
 * 注册白名单里的每一个工具。
 * @param ctx - preset 子树的上下文。
 */
export function apply(ctx) {
    const logger = ctx.logger('dsh-fft-ftshare-tools');
    for (const entry of FTSHARE_TOOL_WHITELIST)
        register(ctx, logger, entry);
}
/**
 * 注册单个白名单工具。
 * @param ctx - preset 子树的上下文。
 * @param logger - 具名 logger。
 * @param entry - 白名单条目。
 */
function register(ctx, logger, entry) {
    ctx.tools.register(defineTool({
        name: entry.name,
        description: `${entry.title}。${entry.description}`,
        parameters: entry.parameters,
        output: {
            schema: outputSchema,
            render: (_args, value) => [{ type: 'text', text: value.text ?? '' }],
        },
        async execute(args, exec) {
            const result = await ctx.ftshareData.call(entry.tool, (args ?? {}), { signal: exec.signal });
            if (result.state === 'denied' || result.state === 'failed') {
                logger.warn('ftshare.tool_result', { tool: entry.tool, state: result.state, code: result.notice?.code });
            }
            return { tool: entry.tool, state: result.state, text: renderCallResult(entry.title, entry.tool, result) };
        },
    }));
}
//# sourceMappingURL=tools.js.map