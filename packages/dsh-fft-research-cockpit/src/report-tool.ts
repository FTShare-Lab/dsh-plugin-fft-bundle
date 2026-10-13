import type { Context, Logger } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import type { Config } from './config.js'
import { generateDeepReadReport, generateInvestmentReport } from './report-service.js'
import { generatePortfolioRecommendation } from './portfolio-recommendation.js'
import type { ReportType } from './types.js'

const REPORT_TYPES: ReportType[] = ['deep_read', 'holding_analysis', 'limit_up_attribution', 'market_commentary', 'portfolio_etfs', 'portfolio_stocks', 'review', 'sector_analysis']
const PLAN_LABELS: Record<string, string> = { Free: '免费版', Basic: '基础版', Advanced: '进阶版', Pro: '专业版（Pro）' }

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' }, reportType: { type: 'string' }, symbol: { type: 'string' }, asOf: { type: 'string' },
    reportFilename: { type: 'string' }, reportHtml: { type: 'string' }, reportPdfBase64: { type: 'string' }, reportPngBase64: { type: 'string' }, reportPath: { type: 'string' },
    structuredReport: { type: 'json' }, evidence: { type: 'json' }, provenance: { type: 'json' }, freshness: { type: 'json' },
    dataGaps: { type: 'array', items: { type: 'string' } }, warnings: { type: 'array', items: { type: 'string' } }, permissions: { type: 'array', items: { type: 'json' } }, llm: { type: 'json' },
  },
} as const satisfies ValueSchemaSpec

const commonParameters = {
  reportType: { type: 'string', description: '报告类型：deep_read、holding_analysis、limit_up_attribution、market_commentary、portfolio_etfs、portfolio_stocks、review、sector_analysis' },
  symbol: { type: 'string', description: '证券代码或 FTShare 支持的证券标识' },
  symbols: { type: 'array', items: { type: 'string' }, description: '证券代码列表' },
  holdings: { type: 'json', description: '持仓快照数组，元素包含 symbol/name/quantity/costPrice/currentPrice/marketValue/pnl/pnlPct/weight' },
  asOf: { type: 'string', description: '分析日期 YYYY-MM-DD；默认今天' },
  startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
  endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
  phase: { type: 'string', description: '市场点评阶段：midday 或 after_close' },
  sectorCode: { type: 'string', description: '行业/板块代码' },
  sectorName: { type: 'string', description: '行业/板块名称' },
  itemType: { type: 'string', description: '复盘对象：stock 或 etf' },
  title: { type: 'string', description: '报告标题覆盖值' },
} as const satisfies ParameterSchemaSpec

const recommendationParameters = {
  poolSource: { type: 'string', description: '候选池来源：csi1000（默认）或 custom' },
  symbols: { type: 'array', items: { type: 'string' }, description: '自定义候选股票代码列表；这些代码只作为候选池，不会自动全部持仓' },
  indexCode: { type: 'string', description: '指数代码，默认 000852（中证1000）' },
  portfolioSize: { type: 'number', description: '每个组合的股票数量，默认 5，范围 2-20' },
  portfolioCount: { type: 'number', description: '要生成的组合数量，默认 1，范围 1-5' },
  strategy: { type: 'string', description: '组合方式：auto、theme、diversified、equal_weight、minimum_variance、risk_budgeting' },
  asOf: { type: 'string', description: '组合时点 YYYY-MM-DD；默认今天' },
  includeReport: { type: 'boolean', description: '是否对第一个推荐组合继续生成股票组合 HTML 报告，默认 false' },
  maxSingleWeight: { type: 'number', description: '单只股票权重上限，默认 0.30' },
  maxIndustryWeight: { type: 'number', description: '单一行业权重上限，默认 0.50' },
  maxCandidates: { type: 'number', description: '最多拉取完整快照的候选数量，默认 60；大股票池会抽样并披露覆盖率' },
} as const satisfies ParameterSchemaSpec

const recommendationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' }, asOf: { type: 'string' }, poolSource: { type: 'string' }, indexCode: { type: 'string' },
    strategyRequested: { type: 'string' }, strategyUsed: { type: 'string' }, candidatePool: { type: 'json' }, recommendations: { type: 'json' },
    candidateDiagnostics: { type: 'json' }, dataGaps: { type: 'array', items: { type: 'string' } }, warnings: { type: 'array', items: { type: 'string' } },
    permissions: { type: 'array', items: { type: 'json' } }, provenance: { type: 'json' }, freshness: { type: 'json' }, report: { type: 'json' },
  },
} as const satisfies ValueSchemaSpec

function renderResult(value: Record<string, unknown>): Array<{ type: 'text'; text: string }> {
  const permissions = Array.isArray(value.permissions) ? value.permissions as Array<{ message?: string; upgradeUrl?: string; requiredPlan?: string }> : []
  const permissionText = permissions.length
    ? `FTShare 权限提示：${permissions.map(item => `${item.message ?? ''} [升级 FTShare ${PLAN_LABELS[item.requiredPlan ?? 'Pro'] ?? item.requiredPlan ?? '专业版（Pro）'} 订阅](${item.upgradeUrl ?? 'https://ftai.chat/me/profile?tab=subscription'})`).join('；')}`
    : ''
  const report = value.structuredReport && typeof value.structuredReport === 'object' && !Array.isArray(value.structuredReport)
    ? value.structuredReport as Record<string, unknown>
    : undefined
  const analysis = report?.analysis_meta as Record<string, unknown> | undefined
  const conclusion = report?.conclusion && typeof report.conclusion === 'object' && !Array.isArray(report.conclusion)
    ? report.conclusion as Record<string, unknown>
    : undefined
  const preview = typeof report?.investment_thesis === 'string' && report.investment_thesis.trim()
    ? report.investment_thesis.trim()
    : typeof conclusion?.rationale === 'string' && conclusion.rationale.trim()
      ? conclusion.rationale.trim()
      : undefined
  return [{ type: 'text', text: [
    `投研报告状态：${String(value.status ?? '')}`,
    `报告类型：${String(value.reportType ?? '')}`,
    value.symbol ? `证券：${String(value.symbol)}` : undefined,
    value.asOf ? `分析日期：${String(value.asOf)}` : undefined,
    value.reportFilename ? `报告文件名：${String(value.reportFilename)}` : undefined,
    preview ? `报告摘要：${preview}` : undefined,
    analysis ? `AI 分析状态：${analysis.status}；已生成 ${analysis.generated ?? 0}/${analysis.total ?? '—'} 个契约字段` : undefined,
    analysis?.status !== 'generated' && Array.isArray(value.warnings) ? value.warnings.filter(warning => typeof warning === 'string' && /AI 分析|首页分析|LLM/.test(warning)).join('；') : undefined,
    '报告内容：结果区域提供“展开”预览；点击“导出为”下拉可选择 PNG、PDF 或 HTML，右侧预览还支持独立放大。',
    permissionText || undefined,
  ].filter(Boolean).join('\n') }]
}

function presentationMeta(value: Record<string, unknown>): any {
  return {
    kind: 'investment-report',
    reportHtml: typeof value.reportHtml === 'string' ? value.reportHtml : '',
    ...(typeof value.reportPdfBase64 === 'string' ? { reportPdfBase64: value.reportPdfBase64 } : {}),
    ...(typeof value.reportPngBase64 === 'string' ? { reportPngBase64: value.reportPngBase64 } : {}),
    filename: typeof value.reportFilename === 'string' ? value.reportFilename : 'FtAi-investment-report.html',
    reportType: typeof value.reportType === 'string' ? value.reportType : 'investment_report',
    ...(typeof value.symbol === 'string' ? { symbol: value.symbol } : {}),
    ...(typeof value.asOf === 'string' ? { asOf: value.asOf } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
  }
}

function renderRecommendation(value: Record<string, unknown>): Array<{ type: 'text'; text: string }> {
  const recommendations = Array.isArray(value.recommendations) ? value.recommendations as Array<Record<string, unknown>> : []
  const lines = [
    `组合推荐状态：${String(value.status ?? '')}`,
    `候选池：${String(value.poolSource ?? '')}${value.indexCode ? ` / ${String(value.indexCode)}` : ''}`,
    `策略：${String(value.strategyUsed ?? value.strategyRequested ?? '')}`,
  ]
  for (const recommendation of recommendations) {
    const holdings = Array.isArray(recommendation.holdings) ? recommendation.holdings as Array<Record<string, unknown>> : []
    const holdingText = holdings.map(holding => `${String(holding.symbol)} ${String(holding.name)} ${(Number(holding.weight ?? 0) * 100).toFixed(1)}%`).join('；')
    lines.push(`${String(recommendation.portfolioId ?? '')}：${holdingText}`)
  }
  const pool = value.candidatePool && typeof value.candidatePool === 'object' && !Array.isArray(value.candidatePool) ? value.candidatePool as Record<string, unknown> : undefined
  if (pool) lines.push(`覆盖率：${(Number(pool.coverage ?? 0) * 100).toFixed(1)}%，已评分 ${String(pool.scored ?? 0)} 只，入选 ${String(pool.selected ?? 0)} 只`)
  lines.push(Array.isArray(value.dataGaps) && value.dataGaps.length ? `数据缺口：${value.dataGaps.join('；')}` : '数据缺口：无')
  lines.push(Array.isArray(value.warnings) && value.warnings.length ? `警告：${value.warnings.join('；')}` : '警告：无')
  const permissions = Array.isArray(value.permissions) ? value.permissions as Array<{ message?: string; requiredPlan?: string; upgradeUrl?: string }> : []
  if (permissions.length) lines.push(`FTShare 权限提示：${permissions.map(item => `${item.message ?? ''} [升级 FTShare ${PLAN_LABELS[item.requiredPlan ?? 'Pro'] ?? item.requiredPlan ?? '专业版（Pro）'} 订阅](${item.upgradeUrl ?? 'https://ftai.chat/me/profile?tab=subscription'})`).join('；')}`)
  if (value.report && typeof value.report === 'object' && !Array.isArray(value.report)) lines.push('已附带第一个推荐组合的股票组合报告结果。')
  return [{ type: 'text', text: lines.join('\n') }]
}

function register(ctx: Context, config: Config, name: string, logger?: Logger, fixedType?: ReportType): void {
  const parameters: ParameterSchemaSpec = fixedType
    ? Object.fromEntries(Object.entries(commonParameters).filter(([key]) => key !== 'reportType')) as ParameterSchemaSpec
    : commonParameters
  ctx.tools.register(defineTool({
    name,
    description: fixedType ? `Generate a real FTShare-data ${fixedType} investment report with LLM-grounded analysis.` : 'Generate one of eight real FTShare-data investment reports with LLM-grounded analysis.',
    parameters,
    output: {
      schema: outputSchema,
      render: (_args: unknown, value) => renderResult(value as Record<string, unknown>),
      presentationMeta: (_args: unknown, value: any) => presentationMeta(value as Record<string, unknown>),
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<any> {
      const input = args as Record<string, unknown>
      const request = fixedType ? { ...input, reportType: fixedType } : input
      if (fixedType === 'deep_read') return generateDeepReadReport(ctx, request as { symbol: string; asOf?: string }, exec.signal, config, logger) as any
      return generateInvestmentReport(ctx, request as any, exec.signal, config, logger) as any
    },
  }))
}

export function registerReportTool(ctx: Context, config: Config, logger?: Logger): void {
  register(ctx, config, 'cockpit_investment_report', logger)
  for (const reportType of REPORT_TYPES) register(ctx, config, `cockpit_${reportType}_report`, logger, reportType)
  ctx.tools.register(defineTool({
    name: 'cockpit_portfolio_recommendation',
    description: '从中证1000或用户自定义股票池中构建可解释的股票组合推荐；先筛选候选，再按主题/分散/风险权重生成组合，可选继续生成股票组合报告。',
    parameters: recommendationParameters,
    output: {
      schema: recommendationOutputSchema,
      render: (_args: unknown, value) => renderRecommendation(value as Record<string, unknown>),
      presentationMeta: (_args: unknown, value: any) => {
        const report = value?.report
        if (report && typeof report === 'object' && typeof report.reportHtml === 'string') return presentationMeta(report as Record<string, unknown>)
        return { kind: 'portfolio-recommendation', strategy: value?.strategyUsed, poolSource: value?.poolSource }
      },
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<any> {
      return generatePortfolioRecommendation(ctx, args as any, exec.signal, config, logger)
    },
  }))
}
