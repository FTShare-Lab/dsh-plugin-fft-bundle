import { type ProbeResult, type ValidationResult } from './contract.js';
import type { FeatureLogger } from './logging.js';
export declare const PROBE_TIMEOUT_MS = 8000;
export declare const PROBE_CONTRACTS: {
    readonly daily: "api/v1/market/data/stock-candlesticks";
    readonly historicalMinute: "api/v2/market/data/stock_minutes";
};
/** Error text is classified internally and never returned verbatim. */
export declare function classifyFailure(code: number, text: string): ProbeResult;
/** Two fixed, bounded requests. No SDK, arbitrary URL, retries or stored rows. */
export declare function probeApiKey(key: string | undefined, signal: AbortSignal, fetcher?: typeof fetch, now?: number, logger?: FeatureLogger): Promise<ValidationResult>;
