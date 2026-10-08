import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import type { ReportRequest, ReportToolResult } from './types.js';
export interface DeepReadArgs {
    symbol: string;
    asOf?: string;
}
export declare function generateDeepReadReport(ctx: Context, args: DeepReadArgs, signal: AbortSignal, config: Config): Promise<ReportToolResult>;
export interface InvestmentReportArgs extends ReportRequest {
}
export declare function generateInvestmentReport(ctx: Context, args: InvestmentReportArgs, signal: AbortSignal, config: Config): Promise<ReportToolResult>;
//# sourceMappingURL=report-service.d.ts.map