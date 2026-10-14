/**
 * 上游失败的归一：把 FTShare 网关千奇百怪的报错折成 {@link FtshareNotice}
 * 加一个四态结局。
 *
 * 这是 P8 的解药所在。网关对「套餐没开通这个接口」返回的是 HTTP 403 +
 * `route_not_allowed`，`dsh-kline` 把它归类成 `capability_limited` 之后，摘要里
 * 只留下一个 `0`；调用方于是无法区分「今天真的没有涨停事件」和「这个套餐根本
 * 调不了这个接口」。本模块只做一件事：把权限失败与真实失败分开，并各自带上
 * 用户能看懂的中文说明。
 * @module @ft/dsh-fft-ftshare/errors
 */
import { type FtshareNotice } from './contract.js';
/** 上游返回的错误信封，字段全部按「可能不存在」处理。 */
interface UpstreamErrorEnvelope {
    code?: string;
    message: string;
    requiredPlan?: string;
}
/** 判断一个值是不是可当对象读的记录。 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** 读一个非空字符串；其余一律 undefined。 */
export declare function asText(value: unknown): string | undefined;
/**
 * 从工具名推断所需订阅档位（`ft_v3_*` → Advanced 等）。
 * 网关没有权威的版本→档位映射，这只是一个升级提示的默认值。
 * @param tool - 上游工具名。
 * @returns 档位名。
 */
export declare function planForTool(tool: string): string;
/**
 * 一个码或一句话是否表达「无权访问」。
 * @param code - 上游错误码，可能没有。
 * @param message - 上游错误文案，可能为空串。
 * @returns 是否属于权限失败。
 */
export declare function isPermissionSignal(code: string | undefined, message: string): boolean;
/** 一个码是否值得原样重试。 */
export declare function isRetryableSignal(code: string | undefined, message: string): boolean;
/**
 * 从 MCP 客户端抛出的错误（其 message 常是被字符串化的一段上游 JSON）里抽出码与说明。
 *
 * 上游两种形态都出现过：结构化 `{"error":{"code":…,"message":…}}`，以及
 * 一行纯文本。两者都要能读，读不出来就保留原文。
 * @param value - 抛出物或上游返回的文本。
 * @returns 归一后的码与说明。
 */
export declare function parseUpstreamError(value: unknown): UpstreamErrorEnvelope;
/**
 * 造一条「无权访问」提示。措辞刻意把「不是没有数据」写进去：P8 的病根就是这句
 * 缺失，让「套餐没开通」看起来像「今天什么都没有」。
 * @param tool - 上游工具名。
 * @param code - 上游错误码，缺省按 `route_not_allowed` 记。
 * @param message - 上游说明。
 * @param requiredPlan - 已知的所需档位；未知时按工具版本推断。
 * @returns 可直接展示的提示。
 */
export declare function deniedNotice(tool: string, code: string | undefined, message: string, requiredPlan?: string): FtshareNotice;
/**
 * 把一次失败折成结局与提示。
 * @param error - 抛出物。
 * @param tool - 上游工具名，用于推断所需档位。
 * @returns 结局（`denied` 或 `failed`）与可直接展示的提示。
 */
export declare function classifyFailure(error: unknown, tool: string): {
    state: 'denied' | 'failed';
    notice: FtshareNotice;
};
/**
 * 从「调用成功但信封说自己无权」的载荷里读出权限提示。
 *
 * 部分网关把订阅门禁放在成功信封的 `metadata.permissions` 里，而不是返回错误；
 * 只看空数组就会把这种情况读成「没有数据」。这里的标记判定与投研舱既有实现保持
 * 同一口径：必须出现显式的权限标记或权限文案，普通空数组不算。
 * @param tool - 上游工具名。
 * @param value - 上游返回的结构化载荷。
 * @returns 权限提示；没有标记时 undefined。
 */
export declare function permissionNoticeFromPayload(tool: string, value: unknown): FtshareNotice | undefined;
export {};
//# sourceMappingURL=errors.d.ts.map