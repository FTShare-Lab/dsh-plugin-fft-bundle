import { type ProbeResult, type ValidationResult } from './contract.js';
import type { FeatureLogger } from './logging.js';
export declare const PROBE_TIMEOUT_MS = 8000;
export declare const PROBE_CONTRACTS: {
    readonly daily: "api/v1/market/data/stock-candlesticks";
    readonly historicalMinute: "api/v2/market/data/stock_minutes";
};
/** Error text is classified internally and never returned verbatim. */
export declare function classifyFailure(code: number, text: string): ProbeResult;
/**
 * Two fixed, bounded requests. No SDK, arbitrary URL, retries or stored rows.
 *
 * 配置了 Key 时两项检查都携带它：匿名额度按出口 IP 计，用尽后未携带 Key 的请求会被
 * 网关以 429 拒绝，若远端检查仍走匿名就会把「Key 已配置且可用」误报成受限。未配置
 * Key 时退回匿名远端检查（401/403 不能用来指控 Key）。
 */
export declare function probeApiKey(key: string | undefined, signal: AbortSignal, fetcher?: typeof fetch, now?: number, logger?: FeatureLogger): Promise<ValidationResult>;
