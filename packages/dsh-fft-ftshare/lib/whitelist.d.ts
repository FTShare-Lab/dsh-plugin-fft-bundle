/**
 * `ftshare_*` 白名单：本底座注册给模型的 FTShare 直连工具。
 *
 * 选品口径有两条，都很硬：
 *
 * 1. **不重复 `dsh_kline` 已有的能力**。行情、K 线、技术指标、板块联动、
 *    市场脉搏、自选清单都由 `mcp__dsh-kline__*` 提供，这里一条都不列。
 * 2. **入参形状必须在本仓已有验证**。每个条目下方注释写明参数是从哪次既有调用
 *    抄来的；没有验证过的入参宁可不注册，也不猜一个字段名让上游报错。
 *
 * 白名单是显式的静态清单：网关有几百个工具，全量注册会把模型的选择空间灌满，
 * 也会把「大概能用」的接口暴露成「看起来能用」。
 * @module @ft/dsh-fft-ftshare/whitelist
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools';
/** 白名单中的一个条目：上游工具名 + 注册到 `ctx.tools` 的名字与入参。 */
export interface FtshareWhitelistEntry {
    /** 上游 FTShare 网关工具名。 */
    tool: string;
    /** 注册到 `ctx.tools` 的名字，形如 `ftshare_*`。 */
    name: string;
    /** 中文短标题，用于工具描述首行。 */
    title: string;
    /** 模型可见描述。 */
    description: string;
    /** 入参规格，交给 `defineTool` 编译。 */
    parameters: ParameterSchemaSpec;
}
/**
 * 白名单本体。顺序即模型看到的顺序：先用得上的排前面。
 */
export declare const FTSHARE_TOOL_WHITELIST: readonly FtshareWhitelistEntry[];
/** 按 `ftshare_*` 名字反查白名单条目。 */
export declare const FTSHARE_TOOL_BY_NAME: ReadonlyMap<string, FtshareWhitelistEntry>;
//# sourceMappingURL=whitelist.d.ts.map