import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@ft/dsh-fft-settings'

import { Config } from './config.js'
import { registerReportTool } from './report-tool.js'

export const name = 'FT 投研舱'
export const inject = ['tools', 'llm', 'ftshareSettings']

export { Config }
export type { Config as InvestmentResearchConfig } from './config.js'
export type {
  PortfolioPoolSource,
  PortfolioRecommendationArgs,
  PortfolioRecommendationResult,
  PortfolioRecommendationStrategy,
} from './portfolio-recommendation.js'

export function apply(ctx: Context, config: Config): void {
  // 具名 logger 只创建一次，再显式注入到各服务/函数：不使用模块级单例，
  // 免得插件重载后残留上一个 fiber 的 logger。
  const logger = ctx.logger('ft-research-cockpit')
  registerReportTool(ctx, config, logger)
}
