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
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { FtshareCallResult } from './contract.js';
/** MCP 公共名的服务器段：`mcp__<server>__<tool>`。缺省只接管 dsh-kline。 */
export declare const DEFAULT_MCP_SERVER_NAME = "dsh-kline";
/**
 * 接管投影的工具（MCP 公共名去掉前缀之后的那一段）。
 *
 * 前三个是「明细藏在 structuredContent」的重灾区；后五个只要求「不再输出裸计数」，
 * 走通用渲染。`analyze_kline` 不在列表里：它的 content 本身就是完整行情说明，
 * 重排它只会丢掉信息。
 */
export declare const PROJECTED_TOOLS: readonly string[];
/**
 * `security_intelligence` 的投影：逐条渲染资金流，并把三段状态显式化。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；形状不符时 undefined（调用方原样放行）。
 */
export declare function renderSecurityIntelligence(payload: unknown): string | undefined;
/**
 * `market_pulse` 的投影。`sections` 决定渲染哪些分组，因此「本次未请求」也能显式
 * 说出来，而不是看着空。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；形状不符时 undefined。
 */
export declare function renderMarketPulse(payload: unknown): string | undefined;
/**
 * `market_board_detail` 的投影。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；形状不符时 undefined。
 */
export declare function renderMarketBoardDetail(payload: unknown): string | undefined;
/**
 * 通用渲染：给没有专属渲染器的摘要式工具用。
 *
 * 只做两件正确的事：把数组摊开、把标量写全。**不输出 `key=count` 这类裸计数**——
 * 那正是 P8 的形态；数组为空时写「无数据」，不写 `0`。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；没有可渲染内容时 undefined（放行原结果）。
 */
export declare function renderGenericPayload(payload: unknown): string | undefined;
/**
 * 把 MCP 公共名拆成服务器段与工具段。
 * @param publicName - 形如 `mcp__dsh-kline__security_intelligence`。
 * @returns 两段名字；不是 MCP 公共名时 undefined。
 */
export declare function mcpToolNameOf(publicName: string): {
    server: string;
    tool: string;
} | undefined;
/** 该工具是否由本包接管投影。 */
export declare function isProjectedTool(tool: string): boolean;
/**
 * 纯函数：给公共工具名与结果值，产出替换用的文本。
 * @param publicName - MCP 公共名。
 * @param value - `ToolExecutionSuccess.value`（MCP 的 `{content, structuredContent}`）。
 * @returns 模型可见文本；不接管或形状不符时 undefined。
 */
export declare function renderProjection(publicName: string, value: unknown): string | undefined;
/**
 * 纯函数：算出要替换的 `content`。
 *
 * 文本块被替换，非文本块（图片等）原样保留在末尾；失败结果与无可渲染内容一律
 * 返回 undefined，由调用方原样放行。
 * @param name - 公共工具名。
 * @param result - 归一后的执行结果视图。
 * @returns 新的 content 数组，或 undefined。
 */
export declare function projectContent(name: string, result: {
    isError: boolean;
    value?: unknown;
    content: ContentBlock[];
}): ContentBlock[] | undefined;
/**
 * 把一次 `ctx.ftshareData.call()` 的结果渲染成模型可见文本（工具平面与投影平面共用）。
 * @param title - 中文标题。
 * @param tool - 上游工具名。
 * @param result - 归一结果。
 * @returns 文本。
 */
export declare function renderCallResult(title: string, tool: string, result: FtshareCallResult): string;
/**
 * 注册投影钩子。必须在 preset 子树里挂载：DSH 对 `tools/post-execute` 按
 * `exec.agent` 做作用域过滤，钩子只对所选 preset 的 agent 生效。
 * @param ctx - preset 子树的上下文。
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=project.d.ts.map