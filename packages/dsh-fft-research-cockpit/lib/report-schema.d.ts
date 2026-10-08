import type { JsonRecord } from './types.js';
export interface DeepReadReport extends JsonRecord {
    title: string;
    investment_thesis: string;
    business_overview: JsonRecord;
    fundamental_analysis: JsonRecord;
    technical_analysis: JsonRecord;
    industry_position: JsonRecord;
    valuation: JsonRecord;
    catalysts: JsonRecord[];
    t0_assessment: JsonRecord;
    risks: JsonRecord[];
    key_observation_points: JsonRecord[];
    validation_framework: JsonRecord;
    conclusion: JsonRecord;
}
export declare function validateDeepReadReport(value: unknown): {
    ok: true;
    report: DeepReadReport;
} | {
    ok: false;
    errors: string[];
};
//# sourceMappingURL=report-schema.d.ts.map