/**
 * Agent 平面（preset 平面）入口：金融模式里的 10 个 `cockpit_*` 工具。
 *
 * 由 preset 行以子路径名 `@ft/dsh-fft-research-cockpit/agent` 挂载，因此这些
 * 工具只存在于所选 preset 的 agent 作用域内（标准模式下不存在）。
 *
 * 包自身的宿主入口 `./index.ts` 是**纯载体**：它不注册任何工具，只负责让
 * DSH 的浏览器模块扫描在根 loader 里看到本包的裸包名，从而组合出浏览器半
 * （报告卡、会话「报告」视图、侧栏 tab）。两个平面因此各占一行、互不重复。
 * @module @ft/dsh-fft-research-cockpit/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@ft/dsh-fft-ftshare/contract'

import { Config } from './config.js'
import { registerReportTool } from './report-tool.js'

export const name = 'FT 投研舱'

/**
 * 工具注册需要的能力；缺任一项（如自造最小 profile）本行会挂起等待，属刻意的 fail-loud。
 *
 * `ftshareData` 是 FTShare 公用底座（全局平面）发布的唯一取数服务：本包不再自己连
 * 网关、不再自己读凭据，凭据只由底座经 `ftshareSettings` 解析一次。
 */
export const inject = ['tools', 'llm', 'ftshareData']

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
