/**
 * 叶子取数函数与 FTShare 数据底座之间唯一的接缝。
 *
 * 投研舱不再自己连网关：所有取数都经 `ctx.ftshareData.call(interface, args, { signal })`
 * （见 `docs/specs/ftshare-base/design.html` §8.1）。叶子函数（`ftshare-data` /
 * `report-data` / `portfolio-recommendation` 里的取数函数）保持纯函数，只吃一个
 * {@link FtshareCaller}，**绝不接触 cordis ctx**，因此测试可以用假实现完整替换网关。
 *
 * 结局只看 {@link FtshareCallResult.state}：`empty` 才是「上游确实没有数据」，
 * `denied` 带升级入口，`failed` 是取数失败。`rows` 不是权限判据——旧实现把这三者都
 * 读成「空数组」，正是底座要治的病。
 * @module
 */
import type { Logger } from '@deepseek-ai/cordis';
import { type FtshareCallResult, type FtshareCallState, type FtshareDataService, type FtshareNotice } from '@ft/dsh-fft-ftshare/contract';
import type { JsonRecord, PermissionNotice } from './types.js';
/** 叶子函数依赖的最小服务面，由 `ctx.ftshareData` 提供（测试可传假实现）。 */
export type FtshareCaller = Pick<FtshareDataService, 'call'>;
/**
 * 一次取数在叶子层的读法。
 *
 * `value` 是给既有扁平化工具（`rows()` / `flattenRows()`）读的行信封：只有
 * `available` 才带数据。`gap` / `warning` 分别是写进 `dataGaps` / `warnings` 的原文，
 * 由底座的四态与 `notice` 直接派生，不在调用点上再编一遍文案。
 */
export interface FtshareOutcome {
    /** 四态结局，原样来自底座。 */
    state: FtshareCallState;
    /** 可取用的行信封 `{ data: rows, metadata }`；`denied` / `failed` / `empty` 为 null。 */
    value: JsonRecord | null;
    /** `available` 时的明细行。 */
    rows: JsonRecord[];
    /** `denied` 时的权限提示，已归一成报告遮罩用的 {@link PermissionNotice}。 */
    permission?: PermissionNotice;
    /** 写进 `dataGaps` 的一句话。 */
    gap?: string;
    /** 写进 `warnings` 的一句话。 */
    warning?: string;
    /** 是否值得原样重试（限流、超时、网络抖动）。 */
    retryable: boolean;
}
/** 报告侧的四本账；本包各处 `state` 参数都满足这个形状。 */
export interface FtshareLedger {
    permissions: PermissionNotice[];
    /** 权限遮罩用的账本；只需要披露权限、不需要遮罩的调用方可以不提供。 */
    blockedPermissions?: PermissionNotice[];
    dataGaps: string[];
    warnings: string[];
}
/** 订阅档位的中文名；档位只来自上游信封，本包不按接口版本号猜。 */
export declare const FTSHARE_PLAN_LABELS: Record<string, string>;
/** 权限提示的去重键；`requiredPlan` 可能缺省（上游没说档位）。 */
export declare function permissionKey(notice: PermissionNotice): string;
/** 把底座的 notice 归一成报告遮罩认得的权限提示。 */
export declare function permissionFromNotice(tool: string, notice: FtshareNotice): PermissionNotice;
/**
 * 把底座的四态结果折成叶子层的读法。
 * @param tool - 上游接口名。
 * @param result - 底座的归一结果。
 * @returns 叶子层结局；`gap` / `warning` 文案在这一处生成。
 */
export declare function outcomeOf(tool: string, result: FtshareCallResult): FtshareOutcome;
/**
 * 调一次底座接口，并把「值得重试的失败」重试到 {@link MAX_ATTEMPTS} 次。
 *
 * 底座的 `call()` 契约上不抛异常，但这里仍兜一层：一个坏掉的客户端实现不该让整份
 * 报告崩掉，它只会变成一条 `failed`。
 * @param caller - 底座服务（或测试假实现）。
 * @param tool - 上游接口名。
 * @param args - 上游入参，原样透传。
 * @param signal - 取消信号，转给底座。
 * @param logger - 具名 logger；权限与失败各记一条，便于线上定位。
 * @returns 叶子层结局。
 */
export declare function callInterface(caller: FtshareCaller, tool: string, args?: JsonRecord, signal?: AbortSignal, logger?: Logger): Promise<FtshareOutcome>;
/**
 * 把一次取数结局记进四本账。
 * @param ledger - 权限/遮罩/缺口/警告四本账。
 * @param outcome - {@link callInterface} 的结局。
 * @returns `available` 时的行信封，其余为 null。
 */
export declare function recordOutcome(ledger: FtshareLedger, outcome: FtshareOutcome): JsonRecord | null;
//# sourceMappingURL=ftshare-call.d.ts.map