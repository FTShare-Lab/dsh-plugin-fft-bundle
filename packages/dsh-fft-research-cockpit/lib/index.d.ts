import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
export declare const name = "FT \u6295\u7814\u8231";
export declare const inject: string[];
export { Config };
export type { Config as InvestmentResearchConfig } from './config.js';
export type { PortfolioPoolSource, PortfolioRecommendationArgs, PortfolioRecommendationResult, PortfolioRecommendationStrategy, } from './portfolio-recommendation.js';
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map