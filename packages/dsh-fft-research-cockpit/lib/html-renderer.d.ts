import type { OhlcvPoint, PermissionNotice, Snapshot, TechnicalSignals } from './types.js';
import type { DeepReadReport } from './report-schema.js';
export interface ReportViewModel {
    base_data: {
        date: string;
        stock: {
            name: string;
            symbol_id: string;
            price: number | null;
        };
    };
    llm_content: DeepReadReport | null;
    quant_data: {
        capitalFlow?: Snapshot['capitalFlow'];
        marginDetail?: Snapshot['marginDetail'];
        financial: Snapshot['financial'];
        valuation: Snapshot['valuation'];
        announcements: Snapshot['announcements'];
        research: Snapshot['research'];
    };
    kline_data: OhlcvPoint[];
    kline_indicator_data: TechnicalSignals;
    t0_data: null;
    data_gaps: string[];
    provenance: Snapshot['provenance'];
    llm_meta?: {
        attempted: boolean;
        used: boolean;
        rounds: number;
        provider: string;
        model: string;
    };
}
export type TemplateContext = Record<string, unknown>;
declare const TEMPLATE_FILES: Record<string, string>;
export declare function renderReportTemplate(reportType: keyof typeof TEMPLATE_FILES, context: TemplateContext, permissions?: PermissionNotice[], dataGaps?: string[]): Promise<string>;
export declare function renderReportHtml(model: ReportViewModel, permissions?: PermissionNotice[]): Promise<string>;
export {};
//# sourceMappingURL=html-renderer.d.ts.map