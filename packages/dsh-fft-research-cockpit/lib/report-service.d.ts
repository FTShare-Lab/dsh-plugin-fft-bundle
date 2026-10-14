import type { Context, Logger } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import type { ReportRequest, ReportToolResult } from './types.js';
/**
 * 本次报告使用的模型路由。
 *
 * 用户在模型设置页切模型改的是宿主服务 `agentDefaultModel`，不是本插件的
 * config；跟着宿主走才不会出现「设置页显示 A、报告实际用 B」。这里用
 * `ctx.get` **可选**读取，不写进静态 `inject`：静态 inject 是硬等待，缺这个
 * 服务的最小 profile 会让整行不激活。读不到或读到的路由不完整时，回退到
 * config 的两个字段。
 * @param ctx - 工具行上下文（preset 子树会链到根服务）。
 * @param config - 本插件配置，仅作为回退。
 * @returns 供 LLM 调用与结果元数据共用的 provider / model。
 */
export declare function llmRoute(ctx: Context, config: Config): {
    provider: string;
    model: string;
};
export interface DeepReadArgs {
    symbol: string;
    asOf?: string;
}
export declare function generateDeepReadReport(ctx: Context, args: DeepReadArgs, signal: AbortSignal, config: Config, logger?: Logger): Promise<ReportToolResult>;
export interface InvestmentReportArgs extends ReportRequest {
}
export declare function generateInvestmentReport(ctx: Context, args: InvestmentReportArgs, signal: AbortSignal, config: Config, logger?: Logger): Promise<ReportToolResult>;
//# sourceMappingURL=report-service.d.ts.map