/**
 * preset 平面：把接口表里带 `expose` 的条目注册成 `ctx.tools` 里的 `ftshare_*` 工具，
 * 外加一个长尾入口 `ftshare_call` 与一个失败现场入口 `ftshare_status`。
 *
 * 由 preset 行以子路径名 `@dsh-ft/dsh-fft-ftshare/tools` 挂载，因此这些工具只存在于
 * 所选 preset 的 agent 作用域内（标准模式下不存在）。取数走全局平面提供的
 * `ctx.ftshareData`，本平面不开连接、不碰凭据；`ftshare_status` 只读进程内账本，
 * 不联网。
 *
 * 每个工具都把 {@link FtshareCallResult} 的四态结局原样印进正文：`denied` 说
 * 「无权访问」，`empty` 才说「没有记录」。这是 P8 的教训——两种结局不能长得一样。
 * @module @dsh-ft/dsh-fft-ftshare/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Capability } from './capabilities.js';
export * from './capabilities.js';
export * from './catalog.js';
/** Cordis 插件名。 */
export declare const name = "@dsh-ft/dsh-fft-ftshare/tools";
/** 注册工具要 `tools`，取数要全局 plane 的 `ftshareData`。 */
export declare const inject: string[];
/** 接口表里要下发给模型的那部分（其余条目只供本仓程序调用）。 */
export declare const FTSHARE_EXPOSED_CAPABILITIES: readonly Capability[];
/** 长尾接口的通用直调工具名。 */
export declare const FTSHARE_CALL_TOOL = "ftshare_call";
/** 失败现场查询工具名。 */
export declare const FTSHARE_STATUS_TOOL = "ftshare_status";
/**
 * 注册接口表里每一个暴露条目，外加通用直调与失败现场查询。
 * @param ctx - preset 子树的上下文。
 */
export declare function apply(ctx: Context): void;
/**
 * 渲染失败账本。
 * @returns 模型可见文本。
 */
export declare function renderStatus(): string;
//# sourceMappingURL=tools.d.ts.map