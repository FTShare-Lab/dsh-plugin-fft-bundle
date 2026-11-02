/**
 * 上游失败的观测与四态归一的**薄**层。
 *
 * 只做四件事：抄事实、判 HTTP 语义、留现场、算指纹。**不解释上游**：不维护错误码表，
 * 不按中文文案猜「配额/权限/凭据」，不编造 remedy。上游改名、改文案、加码，这里一行
 * 都不用改。
 *
 * 判定只剩两条 HTTP 语义（稳定、不会随上游文案变）：
 *
 * - `401` / `403` → `denied`（面板遮罩要用）；
 * - 其余 → `failed`。
 *
 * `empty` 不在这里判定：它由成功载荷的**正向证据**决定（见 `./index.ts` 的
 * `observePayload`）。「成功信封里带权限标记」是载荷事实，由
 * {@link permissionNoticeFromPayload} 识别，同样不是文案猜测。
 * @module @dsh-ft/dsh-fft-ftshare/errors
 */
import { type FtshareNotice } from './contract.js';
/** 失败从哪条通道来：成功信封内、HTTP 非 2xx、传输层、纯文本。 */
export type FailureSurface = 'envelope' | 'http' | 'transport' | 'text';
/** 一次失败的观测事实。只记事实，不下结论。 */
export interface UpstreamFailure {
    /** 观测通道。 */
    surface: FailureSurface;
    /** 剥掉 SDK 包装后的可读文本；单行。 */
    message: string;
    /** 上游信封里的码，原样大小写；不猜、不改写。 */
    code?: string;
    /** HTTP 状态：`Error.code`、信封 `upstream_code`，或文本里有分界的写法。 */
    status?: number;
    /** 上游自己的 retryable hint；只有信封里有，只作提示。 */
    retryable?: boolean;
    /** 上游真给了才带上。 */
    requiredPlan?: string;
    /** 原始报文（未截断），用于指纹与 fixture 草稿。 */
    raw: string;
    /** 稳定短指纹，见 {@link fingerprintOf}。 */
    fingerprint: string;
}
/** 判断一个值是不是可当对象读的记录。 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** 读一个非空字符串；其余一律 undefined。 */
export declare function asText(value: unknown): string | undefined;
/** 不依赖 `node:crypto` 的稳定指纹：FNV-1a 64 位，十六进制 16 位。 */
export declare function hashText(text: string): string;
/**
 * 失败指纹：同工具、同状态、同码、同归一文案的失败聚合用。
 *
 * 文案里的数字会归一成 `#`，否则「请等待 N 小时」会让每次失败都算新指纹。
 * @param status - HTTP 状态。
 * @param code - 上游码。
 * @param message - 可读文案。
 * @returns 16 位十六进制指纹。
 */
export declare function fingerprintOf(status: number | undefined, code: string | undefined, message: string): string;
/**
 * 把一次抛出物归一成 {@link UpstreamFailure}（只记事实）。
 * @param value - 抛出物或上游返回的文本。
 * @returns 观测事实。
 */
export declare function observeFailure(value: unknown): UpstreamFailure;
/**
 * 把一次失败折成结局与提示。
 *
 * 顺序即语义：`401/403` 是上游拒绝 → `denied`；其余一律 `failed`。不再按文案细分
 * 配额/凭据/档位——原文已经带出这些信息。
 * @param error - 抛出物。
 * @param tool - 上游工具名（只用于调用方日志，不写进提示）。
 * @returns 结局与可直接展示的提示。
 */
export declare function classifyFailure(error: unknown, tool: string): {
    state: 'denied' | 'failed';
    notice: FtshareNotice;
    failure: UpstreamFailure;
};
/**
 * 从「调用成功但信封说自己无权」的载荷里读出权限提示。
 *
 * 部分网关把订阅门禁放在成功信封的 `metadata.permissions` 或 `permission` 里，而不是
 * 返回错误；只看空数组就会把这种情况读成「没有数据」。这里只认**显式标记**（
 * `access_denied` 之类布尔标记）或 `401/403` 状态码，不按文案猜。
 * @param tool - 上游工具名（只用于调用方日志，不写进提示）。
 * @param value - 上游返回的结构化载荷。
 * @returns 权限提示；没有标记时 undefined。
 */
export declare function permissionNoticeFromPayload(tool: string, value: unknown): FtshareNotice | undefined;
//# sourceMappingURL=errors.d.ts.map