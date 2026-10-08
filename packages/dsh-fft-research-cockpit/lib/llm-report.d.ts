import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Snapshot, TechnicalSignals, JsonRecord } from './types.js';
import type { DeepReadReport } from './report-schema.js';
export interface LlmConfig {
    provider: string;
    model: string;
    maxAttempts: number;
}
export interface LlmLike {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * Keep a valid report shell when one LLM chapter cannot be generated. The
 * successful chapters are merged into this shell, so a missing data source or
 * a transient failure does not erase analysis that was already produced.
 */
export declare function emptyDeepReadReport(): DeepReadReport;
export declare function generateStructuredReport(llm: LlmLike, snapshot: Snapshot, technical: TechnicalSignals, config: LlmConfig, signal: AbortSignal): Promise<DeepReadReport>;
import type { ReportFacts } from './report-data.js';
import type { ReportType } from './types.js';
export interface TemplateLlmResult {
    context: JsonRecord;
    attempted: boolean;
    used: boolean;
    rounds: number;
    error?: string;
}
/**
 * Deterministic deep-read fallback. It uses only the facts already retrieved
 * from FTShare, so an LLM timeout or missing credential cannot turn an
 * otherwise data-rich report into a repeated empty-state shell.
 */
export declare function deterministicDeepReadReport(snapshot: Snapshot, technical: TechnicalSignals): DeepReadReport;
type CountValue = number | string;
interface MarketBreadthCounts {
    up_count: CountValue;
    down_count: CountValue;
    flat_count: CountValue;
    limit_up_count: CountValue;
    limit_down_count: CountValue;
}
export declare function phaseLabelFor(phase: ReportFacts['request']['phase']): {
    key: 'midday' | 'after_close';
    label: string;
};
export declare function marketBreadthFromFacts(facts: ReportFacts): MarketBreadthCounts & {
    up_width_pct: number;
    down_width_pct: number;
    flat_width_pct: number;
    limit_width_pct: number;
};
declare function fallbackContext(facts: ReportFacts): JsonRecord;
/** Generate homepage analysis independently from the complete report, using only scoped evidence. */
export declare function generateTemplateReport(llm: LlmLike, reportType: ReportType, facts: ReportFacts, config: LlmConfig, signal: AbortSignal): Promise<TemplateLlmResult>;
export { fallbackContext };
//# sourceMappingURL=llm-report.d.ts.map