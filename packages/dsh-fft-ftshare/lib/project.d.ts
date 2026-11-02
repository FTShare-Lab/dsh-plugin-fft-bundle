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
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { FtshareCallResult } from './contract.js';
/** MCP 公共名的服务器段：`mcp__<server>__<tool>`。缺省只接管 dsh-kline。 */
export declare const DEFAULT_MCP_SERVER_NAME = "dsh-kline";
/**
 * 接管投影的工具（MCP 公共名去掉前缀之后的那一段）。
 *
 * 只列保留工具：FTShare wrapper 那三个已由 `./mask` 掩掉，不再需要投影。
 * `analyze_kline` 不在列表里：它的 content 本身就是完整行情说明，重排它只会丢掉
 * 信息。
 */
export declare const PROJECTED_TOOLS: readonly string[];
/**
 * 通用渲染：保留工具统一走它。
 *
 * 只做两件正确的事：把数组摊开、把标量写全。**不输出 `key=count` 这类裸计数**——
 * 那正是 P8 的形态；数组为空时写「无数据」，不写 `0`。
 * @param payload - 工具返回的 `structuredContent`。
 * @returns 模型可见文本；没有可渲染内容时 undefined（放行原结果）。
 */
export declare function renderGenericPayload(payload: unknown): string | undefined;
/**
 * 把 MCP 公共名拆成服务器段与工具段。
 * @param publicName - 形如 `mcp__dsh-kline__fetch_candles`。
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
 *
 * 失败说明只展示事实：上游原文、上游状态、指纹、上游给的档位与重试提示。不翻译、
 * 不归因——「是不是额度」让原文自己说。
 * @param title - 中文标题。
 * @param tool - 上游接口名。
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