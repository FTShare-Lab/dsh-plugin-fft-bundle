import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import type { JsonRecord, PermissionNotice, Provenance } from './types.js';
/**
 * A deterministic portfolio construction layer inspired by stock_rec_stream's
 * portfolio_engine. It deliberately stays separate from report generation:
 * first select a portfolio from a universe, then optionally hand the selected
 * symbols to the existing portfolio report tool.
 */
export type PortfolioPoolSource = 'csi1000' | 'custom';
export type PortfolioRecommendationStrategy = 'auto' | 'theme' | 'diversified' | 'equal_weight' | 'minimum_variance' | 'risk_budgeting';
export interface PortfolioRecommendationArgs {
    poolSource?: PortfolioPoolSource;
    /** User supplied candidate pool. It is never treated as the final portfolio. */
    symbols?: string[];
    /** CSI 1000 defaults to 000852; exposed for future supported index pools. */
    indexCode?: string;
    portfolioSize?: number;
    portfolioCount?: number;
    strategy?: PortfolioRecommendationStrategy;
    asOf?: string;
    includeReport?: boolean;
    maxSingleWeight?: number;
    maxIndustryWeight?: number;
    maxCandidates?: number;
}
export interface PortfolioRecommendationHolding {
    symbol: string;
    name: string;
    industry: string;
    weight: number;
    score: number;
    role: 'core' | 'satellite';
    reasons: string[];
    metrics: JsonRecord;
    dataGaps: string[];
}
export interface PortfolioRecommendation {
    portfolioId: string;
    description: string;
    strategy: PortfolioRecommendationStrategy;
    holdings: PortfolioRecommendationHolding[];
    industryExposure: Array<{
        industry: string;
        weight: number;
        count: number;
    }>;
    overlapWithPrevious: number;
}
export interface PortfolioRecommendationResult {
    status: 'complete' | 'degraded' | 'permission_required';
    asOf: string;
    poolSource: PortfolioPoolSource;
    indexCode?: string;
    strategyRequested: PortfolioRecommendationStrategy;
    strategyUsed: PortfolioRecommendationStrategy;
    candidatePool: {
        requested: number;
        loaded: number;
        scored: number;
        selected: number;
        coverage: number;
        industries: number;
        sourceDescription: string;
    };
    recommendations: PortfolioRecommendation[];
    candidateDiagnostics: Array<{
        symbol: string;
        name: string;
        industry: string;
        score: number;
        selectedIn: string[];
        excludedReason?: string;
        dataGaps: string[];
    }>;
    dataGaps: string[];
    warnings: string[];
    permissions: PermissionNotice[];
    provenance: Provenance[];
    freshness: JsonRecord;
    report?: JsonRecord;
}
export declare function generatePortfolioRecommendation(ctx: Context, input: PortfolioRecommendationArgs, signal: AbortSignal, config: Config): Promise<PortfolioRecommendationResult>;
//# sourceMappingURL=portfolio-recommendation.d.ts.map