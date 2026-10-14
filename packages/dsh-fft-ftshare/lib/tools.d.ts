/**
 * preset 平面：把 {@link FTSHARE_TOOL_WHITELIST} 注册成 `ctx.tools` 里的
 * `ftshare_*` 工具。
 *
 * 由 preset 行以子路径名 `@ft/dsh-fft-ftshare/tools` 挂载，因此这些工具只存在于
 * 所选 preset 的 agent 作用域内（标准模式下不存在）。取数走全局 plane 提供的
 * `ctx.ftshareMarket`，本平面不开连接、不碰凭据。
 *
 * 每个工具都把 {@link FtshareCallResult} 的四态结局原样印进正文：`denied` 说
 * 「当前套餐无权访问」，`empty` 才说「没有记录」。这是 P8 的教训——两种结局不能
 * 长得一样。
 * @module @ft/dsh-fft-ftshare/tools
 */
import type { Context } from '@deepseek-ai/cordis';
export { FTSHARE_TOOL_WHITELIST, FTSHARE_TOOL_BY_NAME, type FtshareWhitelistEntry } from './whitelist.js';
/** Cordis 插件名。 */
export declare const name = "@ft/dsh-fft-ftshare/tools";
/** 注册工具要 `tools`，取数要全局 plane 的 `ftshareMarket`。 */
export declare const inject: string[];
/**
 * 注册白名单里的每一个工具。
 * @param ctx - preset 子树的上下文。
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=tools.d.ts.map