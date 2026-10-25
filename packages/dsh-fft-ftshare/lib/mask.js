/**
 * preset 平面：把 `dsh_kline` 的 **FTShare wrapper 工具**从模型可见面掩掉。
 *
 * ### 为什么掩而不是删
 *
 * kline 的 MCP 工具是那一层（mcp 行）的自有注册，MCP 客户端**没有工具白名单**
 * （`@deepseek-ai/dsh-mcp-client`），所以「只挂一部分 MCP 工具」做不到，只能在
 * 可见性上掩。替代能力走 `ctx.ftshareData`（`ftshare_*` 与 `ftshare_call`），
 * 这也是「替代接口必须进接口表」的硬理由。
 *
 * ### 为什么落到 agent 自己的 layer
 *
 * `ctx.tools.restrict()` 只过滤**继承来的**工具，永不过滤调用者自己层的注册
 * （`@deepseek-ai/dsh-tools` 的 `view()`）。preset 行 ctx 的 scope 就是它的
 * standing scope，kline 工具属于那一层的自有注册，在它上面 restrict 会直接抛
 * `unknown global tool`。落到 agent 自己的 layer 还有两个好处：随 agent 销毁自动
 * 解除，且只影响这一支。
 *
 * ### 四个坑（都实测过）
 *
 * 1. **未知名字会抛**：必须与当前可见集取交集再 restrict。
 * 2. **`agent/created` 是串行监听**：监听器抛错会连带 agent 创建失败，因此这里
 *    自己 try/catch 记 warn，绝不上抛。
 * 3. **MCP 工具可能晚于 agent 创建到达**（stdio + 重连），所以同时监听
 *    `tools/change`；掩掉的工具会从可见集消失，因此「交集」本身就是去重，不会
 *    重复 append 限制。
 * 4. **清单只有一处**：{@link MASKED_KLINE_TOOLS}，由 `dsh-fft-bundle` 的契约测试
 *    断言它是 kline `server.py` 里 `@mcp.tool` 名字集合的子集。
 * @module @dsh-ft/dsh-fft-ftshare/mask
 */
import { DEFAULT_MCP_SERVER_NAME } from './project.js';
/** Cordis 插件名。 */
export const name = '@dsh-ft/dsh-fft-ftshare/mask';
/**
 * 被掩掉的 kline 工具（MCP 公共名去掉 `mcp__<server>__` 前缀之后的那一段）。
 *
 * 只掩 FTShare wrapper：它们的实现直接连 FTShare 网关，凭据与错误语义都自成一套，
 * 现在由本底座统一承接。「行情 / K 线 / 指标 / 自选」是 kline 的保留能力，一条都不
 * 在这里。
 *
 * 边界由人定过一次（2026-10-16）：`configure_ftshare` / `test_ftshare_connection` /
 * `data_source_status` **不掩** —— 它们属于 kline 自己的设置与自检面，掩掉会让
 * kline 侧边栏的既有路径失效。
 */
export const MASKED_KLINE_TOOLS = [
    'market_pulse',
    'market_board_detail',
    'security_intelligence',
];
/**
 * 一个 kline 工具名对应的 MCP 公共名。
 * @param tool - 短名，例如 `market_pulse`。
 * @returns 公共名，例如 `mcp__dsh-kline__market_pulse`。
 */
export function publicToolName(tool) {
    return `mcp__${DEFAULT_MCP_SERVER_NAME}__${tool}`;
}
/**
 * 纯函数：算出这次该 deny 哪些名字。
 *
 * 与当前可见集取交集是必须的——`restrict` 对未知名字直接抛错。掩掉的工具会从可见集
 * 消失，所以下一次调用自然只剩新到达的那些，不需要另记「已 deny 集合」。
 * @param visible - 该 agent 当前可见的工具名。
 * @returns 需要 deny 的名字，按 {@link MASKED_KLINE_TOOLS} 的顺序。
 */
export function maskPlan(visible) {
    const names = new Set(visible);
    return MASKED_KLINE_TOOLS.map(publicToolName).filter(name => names.has(name));
}
/**
 * 注册掩码行。
 * @param ctx - preset 子树的上下文（standing scope）。
 */
export function apply(ctx) {
    const logger = ctx.logger('dsh-fft-ftshare-mask');
    const host = ctx;
    const live = new Set();
    /**
     * 给一个 agent 补上缺失的掩码。绝不抛：`agent/created` 是串行监听，抛错会连带
     * agent 创建失败。
     * @param agent - 目标 agent。
     */
    const applyMask = (agent) => {
        try {
            const deny = maskPlan(agent.ctx.tools.schemas(agent).map(tool => tool.name));
            if (deny.length === 0)
                return;
            agent.ctx.tools.restrict({ deny });
            logger.info('ftshare.kline_tools_masked', { tools: deny.join(',') });
        }
        catch (error) {
            logger.warn('ftshare.mask_failed', { message: error instanceof Error ? error.message : String(error) });
        }
    };
    host.on('agent/created', ({ agent }) => {
        live.add(agent);
        agent.ctx.effect(() => () => { live.delete(agent); });
        // MCP 工具可能晚到；先掩一次能掩的，剩下的交给 tools/change。
        applyMask(agent);
    });
    host.on('tools/change', () => {
        for (const agent of live)
            applyMask(agent);
    });
}
//# sourceMappingURL=mask.js.map