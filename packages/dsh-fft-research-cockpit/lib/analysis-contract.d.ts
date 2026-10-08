import type { JsonRecord } from './types.js';
export declare const ANALYSIS_UNAVAILABLE = "\u672C\u6B21 AI \u5206\u6790\u672A\u751F\u6210\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u62A5\u544A\u3002";
/** Only contract fields belong to the model; all other values remain factual. */
export declare function projectAnalysis(value: unknown, shape: unknown): unknown;
/** Retain layout and factual siblings, but never use canned commentary as AI. */
export declare function clearAnalysis(context: JsonRecord, shape: JsonRecord): JsonRecord;
export declare function mergeAnalysis(context: JsonRecord, patch: JsonRecord): JsonRecord;
export declare function missingAnalysis(value: unknown, shape: unknown, prefix?: string): string[];
export declare function analysisMetadata(value: JsonRecord, shape: JsonRecord): JsonRecord;
export declare function remainingAnalysisContract(value: unknown, shape: JsonRecord): JsonRecord;
//# sourceMappingURL=analysis-contract.d.ts.map