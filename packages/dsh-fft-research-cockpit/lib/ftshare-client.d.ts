import type { Logger } from '@deepseek-ai/cordis';
import type { JsonRecord } from './types.js';
import type { PermissionNotice } from './types.js';
/** FTShare subscription tiers, ordered from lowest to highest access. */
export type FtSharePlan = 'Free' | 'Basic' | 'Advanced' | 'Pro';
export interface FtShareCallCandidate {
    tool: string;
    arguments_: JsonRecord;
    /** Optional explicit tier; otherwise inferred from the FTShare tool name. */
    plan?: FtSharePlan;
}
export interface FtShareCallResult {
    value: JsonRecord;
    tool: string;
    plan: FtSharePlan;
    attemptedTools: string[];
    permissions: PermissionNotice[];
    downgraded: boolean;
}
export declare class FtShareError extends Error {
    constructor(message: string, options?: ErrorOptions & {
        code?: string;
        tool?: string;
    });
    readonly code?: string;
    readonly tool?: string;
}
export declare class FtSharePermissionError extends FtShareError {
    readonly permission: PermissionNotice;
    constructor(message: string, permission: PermissionNotice, options?: ErrorOptions & {
        code?: string;
        tool?: string;
    }, permissions?: PermissionNotice[]);
    readonly permissions: PermissionNotice[];
}
export declare function isFtSharePermissionError(error: unknown): error is FtSharePermissionError;
export declare const FTSHARE_UPGRADE_URL = "https://ftai.chat/me/profile?tab=subscription";
export declare const FTSHARE_PLAN_LABELS: Record<FtSharePlan, string>;
export declare function planForTool(tool: string): FtSharePlan;
export declare function permissionNotices(error: unknown): PermissionNotice[];
/**
 * Some FTShare gateways return a successful MCP envelope whose metadata says
 * the field is subscription-gated, instead of returning an MCP error. Keep
 * that access decision lossless so an empty gated result can still produce a
 * field-level veil. We deliberately require an explicit permission/access
 * marker; an ordinary empty array or an informational warning is not enough.
 */
export declare function permissionNoticesFromPayload(tool: string, value: JsonRecord): PermissionNotice[];
export interface FtShareSession {
    call(tool: string, arguments_: JsonRecord, signal: AbortSignal): Promise<JsonRecord>;
}
/**
 * Prefer the most capable endpoint and fall back only for explicit upstream
 * permission failures. Failed higher-tier notices are retained even when a
 * lower-tier endpoint succeeds, so reports can explain the downgrade and link
 * to the subscription page.
 */
export declare function callWithSubscriptionFallback(session: FtShareSession, candidates: FtShareCallCandidate[], signal: AbortSignal, logger?: Logger): Promise<FtShareCallResult>;
export declare class FtShareClient {
    private readonly endpoint;
    private readonly logger?;
    constructor(endpoint: string, configuredApiKey?: string, logger?: Logger | undefined);
    private readonly headers;
    withSession<T>(signal: AbortSignal, fn: (session: FtShareSession) => Promise<T>): Promise<T>;
}
//# sourceMappingURL=ftshare-client.d.ts.map