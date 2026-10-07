import { ANALYSIS_UNAVAILABLE } from './analysis-contract.js'
import { readFile } from 'node:fs/promises'

import nunjucks from 'nunjucks'

import { calculateTechnicalSignals } from './indicators.js'
import { FTSHARE_PLAN_LABELS } from './ftshare-client.js'
import type { JsonRecord, OhlcvPoint, PermissionNotice, Snapshot, TechnicalSignals } from './types.js'
import type { DeepReadReport } from './report-schema.js'

export interface ReportViewModel {
  base_data: {
    date: string
    stock: { name: string; symbol_id: string; price: number | null }
  }
  llm_content: DeepReadReport | null
  quant_data: {
    capitalFlow?: Snapshot['capitalFlow']
    marginDetail?: Snapshot['marginDetail']
    financial: Snapshot['financial']
    valuation: Snapshot['valuation']
    announcements: Snapshot['announcements']
    research: Snapshot['research']
  }
  kline_data: OhlcvPoint[]
  kline_indicator_data: TechnicalSignals
  t0_data: null
  data_gaps: string[]
  provenance: Snapshot['provenance']
  llm_meta?: { attempted: boolean; used: boolean; rounds: number; provider: string; model: string }
}

export type TemplateContext = Record<string, unknown>

const TEMPLATE_FILES: Record<string, string> = {
  deep_read: 'deep_read_report.html',
  holding_analysis: 'holding_analysis_report.html',
  limit_up_attribution: 'limit_up_attribution_report.html',
  market_commentary: 'market_commentary_report.html',
  portfolio_etfs: 'portfolio_etfs_report.html',
  portfolio_stocks: 'portfolio_stocks_report.html',
  review: 'review_report.html',
  sector_analysis: 'sector_analysis_report.html',
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    // Escape characters that can terminate or mutate an inline script. A
    // literal `>` is safe once `<` is escaped and keeps CSS selectors readable
    // in the generated report (useful for audits and support diagnostics).
    .replaceAll('<', '\\u003c').replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function roundValue(value: unknown, precision = 0): number | string {
  const numeric = numberValue(value)
  if (numeric === null) return value == null ? '' : String(value)
  const factor = 10 ** Math.max(0, Math.trunc(precision))
  return Math.round((numeric + Number.EPSILON) * factor) / factor
}

function latestNumber(row: JsonRecord | undefined, ...keys: string[]): number | null {
  if (!row) return null
  for (const key of keys) {
    const value = numberValue(row[key])
    if (value !== null) return value
  }
  return null
}

function latestText(row: JsonRecord | undefined, ...keys: string[]): string | null {
  if (!row) return null
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function legacyKline(points: OhlcvPoint[]): JsonRecord {
  return { trade_dates: points.map(point => point.date), ohlc: points.map(point => [point.open, point.high, point.low, point.close]), volumes: points.map(point => point.volume) }
}

function legacyIndicators(indicators: TechnicalSignals, points: OhlcvPoint[]): JsonRecord {
  const latest = indicators.latestClose == null ? null : {
    ema5: indicators.ema5, ema10: indicators.ema10, ema20: indicators.ema20,
    boll_position: indicators.boll.middle == null || indicators.boll.upper == null || indicators.boll.lower == null
      ? '—' : indicators.latestClose > indicators.boll.upper ? '上轨上方' : indicators.latestClose < indicators.boll.lower ? '下轨下方' : '布林带内',
    boll_middle: indicators.boll.middle, macd_histogram: indicators.macd.histogram, macd_dif: indicators.macd.dif, macd_dea: indicators.macd.dea,
    rsi14: indicators.rsi14, stoch_k: indicators.kdj.k, stoch_d: indicators.kdj.d, stoch_j: indicators.kdj.j,
  }
  const series = indicators.series ?? calculateTechnicalSignals(points).series
  const aligned = (values: Array<number | null> | undefined): Array<number | null> =>
    Array.isArray(values) && values.length === points.length ? values : points.map(() => null)
  return {
    trade_dates: points.map(point => point.date), ohlc: points.map(point => [point.open, point.high, point.low, point.close]), volumes: points.map(point => point.volume),
    overlays: {
      ema: { '5': aligned(series?.ema5), '10': aligned(series?.ema10), '20': aligned(series?.ema20) },
      boll: { upper: aligned(series?.bollUpper), middle: aligned(series?.bollMiddle), lower: aligned(series?.bollLower) },
    },
    oscillators: {
      macd: { dif: aligned(series?.macdDif), dea: aligned(series?.macdDea), histogram: aligned(series?.macdHistogram) },
    }, latest,
  }
}

function legacyFinancialIndicator(model: ReportViewModel): JsonRecord | null {
  const income = model.quant_data.financial?.income?.[0]
  const samePeriod = (row: JsonRecord) => row.year === income?.year && row.report_type === income?.report_type && (row.report_form_type ?? row.detail_report_type) === income?.report_form_type
  const cashflow = model.quant_data.financial?.cashflow?.find(samePeriod)
  const balances = model.quant_data.financial?.balance ?? []
  const balance = balances.find(samePeriod)
  const opening = balances.find(row => Number(row.year) === Number(income?.year) - 1 && row.report_type === 'annual' && (row.report_form_type ?? row.detail_report_type) === income?.report_form_type)
  const revenue = latestNumber(income, 't_revenue', 'oper_revenue', 'revenue')
  const cost = latestNumber(income, 'cost', 'oper_cost')
  const profit = latestNumber(income, 'n_profit', 'net_profit')
  const equity = latestNumber(balance, 't_equity')
  const openingEquity = latestNumber(opening, 't_equity')
  const ratio = (a: number | null, b: number | null) => a !== null && b !== null && b > 0 ? a / b * 100 : null
  const reportedRoe = latestNumber(income, 'roe_ttm', 'roe')
  if (!income && !cashflow) return null
  const reportPeriod = [latestText(income, 'year', 'report_type_cn', 'report_type'), latestText(income, 'report_type_cn', 'report_type')]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(' ')
  return {
    ann_date: latestText(income, 'publish_date', 'ann_date', 'announcement_date') ?? latestText(cashflow, 'publish_date', 'ann_date', 'announcement_date'),
    report_period: reportPeriod,
    oper_revenue_ttm: latestNumber(income, 'oper_revenue_ttm', 't_revenue', 'oper_revenue', 'revenue'),
    net_profit_ttm: latestNumber(income, 'parcomp_n_profit', 'net_profit_ttm', 'net_profit', 'net_income'),
    cfo_ttm: latestNumber(cashflow, 'cfo_ttm', 'net_oper_cash_flow', 'net_operating_cash_flow', 'cfo'),
    roe_ttm: reportedRoe ?? ratio(profit, equity !== null && openingEquity !== null ? (equity + openingEquity) / 2 : null),
    roe_label: reportedRoe !== null ? 'ROE（披露值）' : '净资产收益率（总权益简算）',
    gross_profit_margin_ttm: latestNumber(income, 'gross_profit_margin_ttm', 'gross_profit_margin', 'gross_margin') ?? ratio(revenue !== null && cost !== null ? revenue - cost : null, revenue),
    net_profit_margin_ttm: latestNumber(income, 'net_profit_margin_ttm', 'net_profit_margin', 'net_margin') ?? ratio(profit, revenue),
    yoy_net_profit: latestNumber(income, 'parcomp_n_profit_yoy', 'yoy_net_profit', 'net_profit_yoy', 'profit_yoy'),
  }
}

function legacyQuant(model: ReportViewModel): JsonRecord {
  const valuationRow = model.quant_data.valuation ?? undefined
  const totalMarketCap = latestNumber(valuationRow, 'total_market_cap', 'market_cap')
  const floatMarketCap = latestNumber(valuationRow, 'notlimited_marketcap_a', 'float_market_cap')
  const pe = latestNumber(valuationRow, 'pe_ttm', 'pe')
  const peg = latestNumber(valuationRow, 'peg_car', 'peg')
  const valuationDate = latestText(valuationRow, 'trade_date', 'date')
  const volume = model.kline_data.find(row => row.date === valuationDate)?.volume ?? null
  const floatingShares = latestNumber(valuationRow, 'free_shares_a')
  const floatTurnover = volume !== null && floatingShares !== null && floatingShares > 0 ? volume / floatingShares * 100 : null
  const valuation = valuationRow ? {
    trade_date: latestText(valuationRow, 'trade_date', 'date'), total_mv: totalMarketCap == null ? null : totalMarketCap / 10000, float_mv: floatMarketCap == null ? null : floatMarketCap / 10000,
    pe_ttm: pe, pe_ttm_note: pe == null ? '—' : null, pb: latestNumber(valuationRow, 'pb_mrq', 'pb'), ps_ttm: latestNumber(valuationRow, 'ps_ttm', 'ps'), pcf_ttm: latestNumber(valuationRow, 'pcf_ocf_ttm', 'pcf'),
    est_pe_fy1: null, est_pe_fy1_note: 'FY1 PE 未纳入本次快照', est_peg_fy1: peg, est_peg_fy1_note: peg == null ? '—' : null, turnover: latestNumber(valuationRow, 'turnover_rate') ?? floatTurnover, free_turnover: latestNumber(valuationRow, 'free_turnover'),
  } : null
  return { financial_indicator: legacyFinancialIndicator(model), valuation, beta: null, capital_flow: model.quant_data.capitalFlow ?? null, margin_detail: model.quant_data.marginDetail ?? null, announcements: model.quant_data.announcements, research: model.quant_data.research }
}

function emptyReport(): DeepReadReport {
  const unavailable = ANALYSIS_UNAVAILABLE
  const item = () => ({ title: '—', description: unavailable })
  return {
    title: '深度研读报告', investment_thesis: unavailable,
    business_overview: { main_business: unavailable, moat: [item(), item()], revenue_structure: unavailable },
    fundamental_analysis: { financial_health: { items: [item(), item(), item()], summary: unavailable }, growth: { items: [item(), item(), item()], summary: unavailable }, profitability: { items: [item(), item(), item()], summary: unavailable } },
    technical_analysis: { trend: unavailable, pattern: unavailable, key_levels: unavailable, volume_price: unavailable, conclusion: unavailable },
    industry_position: { industry_overview: unavailable, market_share: unavailable, competitors: [item(), item()] },
    valuation: { current_valuation: unavailable, historical_percentile: unavailable, peer_comparison: unavailable, conclusion: unavailable },
    catalysts: [{ event: '公开事件', timeline: '待跟踪', impact: unavailable }, { event: '价格趋势', timeline: '待跟踪', impact: unavailable }, { event: '估值复核', timeline: '待跟踪', impact: unavailable }],
    t0_assessment: { level: '未覆盖', suitability: unavailable, backtest_summary: unavailable },
    risks: Array.from({ length: 5 }, () => ({ category: '数据边界', description: unavailable, severity: '中' })),
    key_observation_points: Array.from({ length: 4 }, () => ({ dimension: '数据完整性', signal: unavailable, meaning: unavailable, invalidation_condition: unavailable })),
    validation_framework: { description: unavailable, items: Array.from({ length: 3 }, () => ({ dimension: '数据更新', hypothesis: unavailable, evidence: unavailable, invalidation: unavailable })) },
    conclusion: { rating: '未覆盖', rationale: unavailable, suitable_investors: unavailable },
  }
}

function legacyContext(model: ReportViewModel): TemplateContext {
  const report = model.llm_content ?? emptyReport()
  const marketCap = latestNumber(model.quant_data.valuation ?? undefined, 'total_market_cap', 'market_cap')
  return {
    base_data: { date: model.base_data.date, stock: { name: model.base_data.stock.name, symbol_id: model.base_data.stock.symbol_id, industry: '行业未映射', t0_level: '未覆盖', price: model.base_data.stock.price, market_cap: marketCap } },
    llm_content: report, quant_data: legacyQuant(model), kline_data: legacyKline(model.kline_data), kline_indicator_data: legacyIndicators(model.kline_indicator_data, model.kline_data),
    t0_data: { trade_date: [], t0_po_total: [] }, llm_meta: model.llm_meta ?? { attempted: false, used: false, rounds: 0, provider: '', model: '' }, data_gaps: model.data_gaps,
  }
}

function prepareTemplate(template: string): string {
  return template.replace(/self::(\w+)\s*\(/g, '$1(').replace(/endmacro\s+\w+/g, 'endmacro')
}

function createEnvironment(): nunjucks.Environment {
  // `addTest` is supported by Nunjucks at runtime but is missing from the
  // published @types/nunjucks Environment declaration.
  const environment = new nunjucks.Environment(undefined, { autoescape: false, throwOnUndefined: false }) as nunjucks.Environment & {
    addTest(name: string, callback: (...args: unknown[]) => unknown): void
  }
  environment.addFilter('json_encode', safeJson)
  environment.addFilter('safe', (value: unknown) => value == null ? '' : String(value))
  // Optional research modules should only occupy space when they contain analysis.
  // Check individual sentences so a missing-data caveat does not discard real facts.
  const hasAnalysis = (value: unknown): boolean => typeof value === 'string' && value.split(/[。！？\n]/).some(sentence => {
    const text = sentence.trim()
    return Boolean(text) && !/^(?:[—–\-\s]+|暂无数据|未覆盖|未接入)$/.test(text)
      && !/(?:未提供|未包含|未纳入|未接入|缺少|缺乏|暂无|无法|数据不足|数据已遮罩|尚无)/.test(text)
  })
  environment.addFilter('has_analysis', hasAnalysis)
  environment.addFilter('available_items', (value: unknown) => Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && hasAnalysis(item.description)) : [])
  environment.addFilter('round', (value: unknown, method?: string | { precision?: number }, precision?: number) => {
    // Nunjucks passes keyword filter arguments as one object.
    const digits = typeof method === 'object' && method !== null ? method.precision : precision
    return roundValue(value, digits ?? 0)
  })
  environment.addTest('number', (value: unknown) => numberValue(value) !== null)
  environment.addTest('containing', (value: unknown, expected: unknown) => typeof value === 'string' && value.includes(String(expected)))
  return environment
}

interface PermissionMaskTarget {
  selector: string
  tools: string[]
  /** Match any blocked dependency (default) or require every dependency. */
  matchMode?: 'any' | 'all'
  label: string
  /** Optional short title used by the centered unlock card. */
  title?: string
  /** Data-gap fragments that should lock this module even without a permission error. */
  gaps?: string[]
  /** Lock only elements that visibly contain an unavailable-data marker. */
  forceUnavailable?: boolean
  /** Promote a matched child to the nearest complete data surface. */
  hostSelector?: string
  /** Use a denser unlock treatment for short metric and judgement cards. */
  compact?: boolean
  /** Use a single low-profile row across a wide table or data surface. */
  horizontal?: boolean
}

/**
 * Permission errors are rendered next to the data that they affect. Selectors
 * intentionally point at data surfaces rather than whole sections so that the
 * section title and explanatory copy remain readable.
 */
const PERMISSION_MASK_TARGETS: Record<string, PermissionMaskTarget[]> = {
  deep_read: [
    { selector: '#technical-metrics, #technical-state-chart, #technical-analysis-data', tools: ['ft_v1_stock_candlesticks'], label: '技术指标与分析', horizontal: true },
    { selector: '#report-quote-access', tools: ['ft_v1_company_list', 'ft_v4_stock_realtime_day_kline'], label: '实时行情', horizontal: true },
    { selector: '#catalyst-data', tools: ['ft_v3_announcements_stock_announcements', 'ft_v1_report_announcement_list', 'ft_v1_report_announcements_list', 'ft_v3_report_stock_reports'], label: '公告与研报证据', horizontal: true },
    { selector: '#quant-financial-chart, #quant-financial-table', tools: ['ft_v1_finance_income', 'ft_v1_finance_cashflow'], label: '财务规模与现金流', title: '财务规模与现金流', horizontal: true },
    { selector: '#quant-profitability-chart', tools: ['ft_v1_finance_income'], label: '盈利质量', title: '盈利质量', horizontal: true },
    { selector: '#quant-valuation-chart, #quant-valuation-table', tools: ['ft_v1_eastmoney_stock_valuation'], label: '估值数据', title: '估值数据', horizontal: true },
    { selector: '#quant-flow-chart, #quant-flow-table', tools: ['ft_v1_stock_capital_flows', 'ft_v1_eastmoney_stock_flow', 'ft_v2_eastmoney_stock_flow'], label: '资金流数据', title: '资金流数据', horizontal: true },
    { selector: '#quant-risk-chart, #quant-risk-table', tools: ['ft_v1_beta_snapshot', 'ft_v2_risk_beta'], label: '风险暴露数据', title: '风险暴露数据', horizontal: true },
    { selector: '#kline-chart', tools: ['ft_v1_stock_candlesticks'], label: '技术行情数据', title: '技术行情数据', horizontal: true },
  ],
  holding_analysis: [
    { selector: '.return-curve', tools: ['ft_v1_stock_candlesticks'], label: '持仓篮子行情走势', title: '持仓篮子行情走势', gaps: ['ft_v1_stock_candlesticks', '日线 OHLCV', '行情走势'], forceUnavailable: true, horizontal: true },
    { selector: '.diagnosis-grid', tools: ['ft_v1_stock_candlesticks', 'ft_v4_stock_realtime_day_kline', 'ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation'], label: '持仓诊断数据', title: '持仓诊断数据', forceUnavailable: true, horizontal: true },
    { selector: '.treemap, .contrib-list', tools: ['ft_v1_company_list', 'ft_v4_stock_realtime_day_kline'], label: '持仓行情与盈亏', title: '持仓行情与盈亏', gaps: ['ft_v1_company_list', 'ft_v4_stock_realtime_day_kline', '实时行情', '个股快照'], forceUnavailable: true, horizontal: true },
    { selector: '.exposure-grid, #exposure-analysis', tools: ['ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation'], label: '持仓暴露数据', title: '持仓暴露数据', gaps: ['ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation', '财务收入', '现金流', '估值数据'], forceUnavailable: true, horizontal: true },
    { selector: '#drawdown-analysis', tools: ['ft_v1_stock_candlesticks'], label: '回撤与波动数据', title: '回撤与波动数据', gaps: ['ft_v1_stock_candlesticks', '日线 OHLCV', '波动'], forceUnavailable: true, horizontal: true },
    { selector: '.analysis-surface', tools: ['ft_v1_stock_candlesticks', 'ft_v4_stock_realtime_day_kline', 'ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation'], label: '持仓分析数据', title: '持仓分析数据', forceUnavailable: true, horizontal: true },
    // The pseudo-diversification matrix is a protected composite: when any
    // underlying holding snapshot permission is downgraded, its neutral “—”
    // cells must not be mistaken for ordinary missing data.
    { selector: '.factor-matrix', tools: ['ft_v1_company_list', 'ft_v4_stock_realtime_day_kline', 'ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation'], label: '风险因子矩阵', title: '风险因子矩阵', forceUnavailable: true, horizontal: true },
    { selector: 'section > .grid-3', tools: ['ft_v1_stock_candlesticks', 'ft_v4_stock_realtime_day_kline', 'ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation'], label: '风险优先级数据', title: '风险优先级数据', forceUnavailable: true, horizontal: true },
    { selector: 'section > .timeline', tools: ['ft_v4_stock_realtime_day_kline', 'ft_v3_announcements_stock_announcements', 'ft_v1_report_announcements_list', 'ft_v3_limit_up_reports_briefs'], label: '后续观察数据', title: '后续观察数据', forceUnavailable: true, horizontal: true },
  ],
  limit_up_attribution: [
    { selector: '.metrics-panel', tools: ['ft_v1_limit_list'], label: '涨停统计数据', title: '涨停统计数据', gaps: ['ft_v1_limit_list', '涨停池'], forceUnavailable: true, horizontal: true },
    { selector: '.case-list, .empty-state', tools: ['ft_v1_limit_list', 'ft_v2_limit_event_timeline_3s'], label: '涨停案例数据', title: '涨停案例数据', gaps: ['ft_v1_limit_list', 'ft_v2_limit_event_timeline_3s', '涨停案例', '涨停池'], forceUnavailable: true, horizontal: true },
    { selector: '.attribution-block', tools: ['ft_v3_limit_up_reports_briefs', 'ft_v3_announcements_stock_announcements', 'ft_v1_report_announcements_list', 'ft_v1_report_announcement_list'], label: '涨停归因证据', title: '涨停归因证据', gaps: ['ft_v3_limit_up_reports_briefs', 'ft_v3_announcements_stock_announcements', 'ft_v1_report_announcements_list', 'ft_v1_report_announcement_list', '涨停归因', '公告数据'], forceUnavailable: true, horizontal: true },
  ],
  market_commentary: [
    { selector: '.metric-grid .metric', tools: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', 'ft_v1_eastmoney_market_valuation', 'ft_v1_stock_capital_flows', 'ft_v2_eastmoney_dapan_flow'], label: '市场指标', title: '市场指标', forceUnavailable: true, compact: true },
    { selector: '.judgement-grid .judgement', tools: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', 'ft_v1_stock_capital_flows', 'ft_v2_eastmoney_dapan_flow'], label: '市场判断', title: '市场判断', forceUnavailable: true, compact: true },
    { selector: '.driver-grid .driver-card', tools: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', 'ft_v1_stock_capital_flows', 'ft_v2_eastmoney_dapan_flow', 'ft_v1_sw_industry_overview'], label: '市场驱动', title: '市场驱动', forceUnavailable: true, compact: true },
    { selector: '.conclusion', tools: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', 'ft_v1_stock_capital_flows', 'ft_v1_limit_list'], label: '报告结论', title: '报告结论', forceUnavailable: true },
    { selector: '.dashboard-grid > article.card:first-child', tools: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', 'ft_v1_eastmoney_market_valuation'], label: '指数行情数据', title: '指数行情数据', gaps: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', 'ft_v1_eastmoney_market_valuation', '指数与市场行情', '大盘行情'], forceUnavailable: true, horizontal: true },
    { selector: '.dashboard-grid > article.card:nth-child(2)', tools: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot'], label: '市场宽度数据', title: '市场宽度数据', gaps: ['ft_v1_daec_stocks', 'ft_v1_daec_market_snapshot', '市场宽度'], forceUnavailable: true, horizontal: true },
    { selector: '#sectorChart', tools: ['ft_v1_sw_industry_overview', 'ft_v1_ths_board_list'], label: '行业强弱数据', title: '行业强弱数据', gaps: ['ft_v1_sw_industry_overview', 'ft_v1_ths_board_list', '行业强弱'] },
    { selector: '#capitalChart', tools: ['ft_v1_stock_capital_flows', 'ft_v2_eastmoney_dapan_flow'], label: '主力资金数据', title: '主力资金数据', gaps: ['ft_v1_stock_capital_flows', 'ft_v2_eastmoney_dapan_flow', '主力资金', '资金流'] },
    { selector: '#etfList', tools: ['ft_v2_etf_description_all', 'ft_v1_etf_candlesticks'], label: 'ETF 行情数据', title: 'ETF 行情数据', gaps: ['ft_v2_etf_description_all', 'ft_v1_etf_candlesticks', 'ETF 行情'] },
  ],
  portfolio_etfs: [
    { selector: '#summaryStocks', tools: ['ft_v2_etf_description_all', 'ft_v4_etf_realtime_day_kline'], label: 'ETF 基础信息', title: 'ETF 基础信息', gaps: ['ft_v2_etf_description_all', 'ETF 基础信息'], forceUnavailable: true, horizontal: true },
    { selector: '#deepCards', tools: ['ft_v1_etf_candlesticks', 'ft_v4_etf_realtime_day_kline'], label: 'ETF 技术与基本面数据', title: 'ETF 技术与基本面数据', gaps: ['ft_v1_etf_candlesticks', 'ft_v4_etf_realtime_day_kline', 'ETF 技术', 'ETF 基本面'], forceUnavailable: true, horizontal: true },
  ],
  portfolio_stocks: [
    { selector: '#summaryStocks', tools: ['ft_v1_company_list', 'ft_v4_stock_realtime_day_kline'], label: '个股行情数据', title: '个股行情数据', gaps: ['ft_v1_company_list', 'ft_v4_stock_realtime_day_kline', '实时行情', '个股快照'], forceUnavailable: true, horizontal: true },
    { selector: '#deepCards', tools: ['ft_v1_stock_candlesticks', 'ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation', 'ft_v3_report_stock_reports'], label: '个股技术与基本面数据', title: '个股技术与基本面数据', gaps: ['ft_v1_stock_candlesticks', 'ft_v1_finance_income', 'ft_v1_finance_cashflow', 'ft_v1_eastmoney_stock_valuation', 'ft_v3_report_stock_reports', '日线 OHLCV', '财务收入', '现金流', '估值数据'], forceUnavailable: true, horizontal: true },
    { selector: '.advantage-deep', tools: [], label: 'T0 回测数据', title: 'T0 回测数据', gaps: ['T0', '回测', '未纳入本次快照'], forceUnavailable: true, horizontal: true },
  ],
  review: [
    { selector: '#returnsChart', tools: ['ft_v1_stock_candlesticks', 'ft_v1_etf_candlesticks'], label: '组合收益分布数据', title: '组合收益分布数据', gaps: ['ft_v1_stock_candlesticks', 'ft_v1_etf_candlesticks', '日线 OHLCV', '组合回测', '行情数据'], forceUnavailable: true, horizontal: true },
    { selector: '#t0ContributionChart', tools: ['ft_v1_stock_candlesticks'], label: 'T0 收益分解数据', title: 'T0 收益分解数据', gaps: ['ft_v1_stock_candlesticks', 'T0', '收益分解'], forceUnavailable: true, horizontal: true },
    { selector: '#itemsGrid', tools: ['ft_v1_stock_candlesticks', 'ft_v1_etf_candlesticks'], label: '组合回测明细', title: '组合回测明细', gaps: ['ft_v1_stock_candlesticks', 'ft_v1_etf_candlesticks', '组合回测', '行情数据'], forceUnavailable: true, horizontal: true },
  ],
  sector_analysis: [
    { selector: '.metrics-panel', tools: ['ft_v1_ths_board_kline', 'ft_v1_ths_all_board_kline', 'ft_v1_sw_industry_overview', 'ft_v1_ths_board_kline', 'ft_v1_ths_industry_daily_flow'], label: '板块关键指标', title: '板块关键指标', forceUnavailable: true, horizontal: true },
    { selector: '#performance .chart-grid', tools: ['ft_v1_ths_board_kline', 'ft_v1_ths_all_board_kline', 'ft_v1_ths_board_kline'], label: '行情表现与阶段数据', title: '行情表现与阶段数据', gaps: ['ft_v1_ths_board_kline', 'ft_v1_ths_all_board_kline', '板块 K 线', '行情阶段'], forceUnavailable: true, horizontal: true },
    { selector: '#structure .structure-grid', tools: ['ft_v1_sw_industry_overview', 'ft_v1_ths_board_kline', 'ft_v1_tdx_board_members', 'ft_v1_ths_industry_daily_flow'], label: '板块内部结构数据', title: '板块内部结构数据', gaps: ['ft_v1_sw_industry_overview', 'ft_v1_ths_board_kline', 'ft_v1_tdx_board_members', 'ft_v1_ths_industry_daily_flow', '板块内部结构'], forceUnavailable: true, horizontal: true },
    { selector: '#industry-chain .chain-overview, #industry-chain .industry-chain-grid', tools: ['ft_v3_supply_chain_subindustry_supply_chain'], label: '产业链数据', title: '产业链数据', gaps: ['ft_v3_supply_chain_subindustry_supply_chain', '产业链'], forceUnavailable: true, horizontal: true },
    { selector: '#drivers [data-driver-source="price"]', tools: ['ft_v1_ths_board_kline'], label: '行情驱动数据', horizontal: true },
    { selector: '#drivers [data-driver-source="capital"]', tools: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '资金驱动数据', horizontal: true },
    { selector: '#drivers [data-driver-source="valuation"]', tools: ['ft_v1_sw_industry_overview'], label: '估值驱动数据', horizontal: true },
    { selector: '#drivers [data-driver-source="chain"]', tools: ['ft_v3_supply_chain_subindustry_supply_chain'], label: '产业链驱动数据', horizontal: true },
    { selector: '#capital-flow > article.surface', tools: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '今日资金数据', title: '今日资金数据', gaps: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow', '今日资金'], forceUnavailable: true, horizontal: true },
    { selector: '#capital-flow #capital-order-structure .capital-classification-grid', tools: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '订单结构与市场占比数据', title: '订单结构与市场占比数据', gaps: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow', '订单结构', '市场占比'], forceUnavailable: true, horizontal: true },
    { selector: '#capital-flow .capital-trend-grid', tools: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '主动资金趋势数据', title: '主动资金趋势数据', gaps: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow', '主动资金趋势'], forceUnavailable: true, horizontal: true },
    { selector: '#capital-flow #capital-channels .two-column', tools: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '资金渠道与细分流向数据', title: '资金渠道与细分流向数据', gaps: ['ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow', '资金渠道', '细分流向'], forceUnavailable: true, horizontal: true },
    { selector: '#validation .logic-surface', tools: ['ft_v1_ths_board_kline', 'ft_v1_ths_all_board_kline', 'ft_v1_sw_industry_overview', 'ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '逻辑验证数据', title: '逻辑验证数据', forceUnavailable: true, horizontal: true },
    { selector: '#valuation .two-column', tools: ['ft_v1_eastmoney_stock_valuation', 'ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '估值与拥挤度数据', title: '估值与拥挤度数据', forceUnavailable: true, horizontal: true },
    { selector: '#leaders article.surface', tools: ['ft_v1_tdx_board_members', 'ft_v1_sw_industry_overview', 'ft_v4_stock_realtime_day_kline', 'ft_v1_company_list'], label: '关键公司数据', title: '关键公司数据', forceUnavailable: true, horizontal: true },
    { selector: '#events .two-column', tools: ['ft_v3_announcements_stock_announcements', 'ft_v1_report_announcements_list', 'ft_v3_supply_chain_subindustry_supply_chain'], label: '催化与风险数据', title: '催化与风险数据', forceUnavailable: true, horizontal: true },
    { selector: '#conclusion .final-answer', tools: ['ft_v1_ths_board_kline', 'ft_v1_ths_all_board_kline', 'ft_v1_sw_industry_overview', 'ft_v1_ths_industry_daily_flow', 'ft_v1_eastmoney_sector_flow'], label: '综合结论', title: '综合结论', forceUnavailable: true, horizontal: true },
  ],
}

function permissionMaskStyle(): string {
  return `<style id="ftshare-module-mask-style">
    .report-header-main:has(.report-price.ftshare-mask-host) {
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    }
    @media (max-width: 768px) {
      .report-header-main:has(.report-price.ftshare-mask-host) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    /* Static fallback veil: this is intentionally present on the empty-state
       node itself, so a report never degrades to a lone placeholder string
       while the hydration script is still starting. */
    .ftshare-static-mask {
      position: relative !important;
      display: grid !important;
      min-height: 168px !important;
      place-items: center !important;
      overflow: hidden !important;
      color: transparent !important;
      background: rgba(78, 89, 105, 0.5) !important;
      border-radius: 8px;
    }
    .ftshare-static-mask::before {
      content: '🔒';
      position: absolute;
      top: 50%;
      left: 50%;
      z-index: 1;
      color: #fff;
      font-size: 30px;
      line-height: 1;
      transform: translate(-50%, -70%);
    }
    .ftshare-static-mask::after {
      content: '数据已遮罩';
      position: absolute;
      top: calc(50% + 24px);
      left: 50%;
      z-index: 1;
      color: rgba(255, 255, 255, 0.95);
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      transform: translateX(-50%);
    }
    .ftshare-static-mask > * { visibility: hidden !important; }
    .ftshare-mask-host {
      position: relative !important;
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) !important;
      grid-template-rows: auto !important;
      width: 100%;
      height: auto !important;
      box-sizing: border-box;
      border-radius: 8px;
      isolation: isolate;
      overflow: hidden;
      min-height: 240px;
    }
    /* Keep the unlock card crisp while applying a real blur to the protected
       content. The backdrop-filter below is the progressive enhancement;
       filtering direct children keeps the effect visible in browsers that do
       not support backdrop-filter. */
    .ftshare-mask-host > :not([data-ftshare-mask="true"]) {
      grid-area: 1 / 1;
      filter: blur(6px) grayscale(0.35);
      pointer-events: none;
      user-select: none;
      transform: scale(1.012);
      transform-origin: center;
    }
    .ftshare-mask-host > :not([data-ftshare-mask="true"]) * {
      overflow-wrap: anywhere;
    }
    /* Never let legacy empty-state widgets compete with the single
       subscription veil. Some report templates render a red bordered
       "data unavailable" panel inside an otherwise valid card; once the
       parent is masked that fallback is implementation chrome, not report
       content, so keep it visually suppressed behind the veil. */
    .ftshare-mask-host .empty-state,
    .ftshare-mask-host .status-unavailable,
    .ftshare-mask-host [data-ftshare-unavailable="true"] {
      visibility: hidden !important;
      opacity: 0 !important;
    }
    .ftshare-mask-host > :not([data-ftshare-mask="true"]) b {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      max-width: 100%;
      white-space: normal !important;
    }
    .ftshare-mask-host[data-ftshare-mask-empty="true"] {
      min-height: 240px;
    }
    .ftshare-module-mask {
      position: relative;
      grid-area: 1 / 1;
      box-sizing: border-box;
      min-width: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 160px;
      padding: 20px;
      color: #FFFFFF;
      background: rgba(78, 89, 105, 0.5);
      border-radius: inherit;
      -webkit-backdrop-filter: blur(6px) saturate(0.72);
      backdrop-filter: blur(6px) saturate(0.72);
      text-align: center;
    }
    .ftshare-module-mask-card {
      display: flex;
      box-sizing: border-box;
      min-width: 0;
      overflow-wrap: anywhere;
      max-width: 340px;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px 20px;
      background: transparent;
    }
    .ftshare-module-mask-icon {
      display: inline-flex;
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      background: transparent;
      border-radius: 0;
      line-height: 1;
    }
    .ftshare-module-mask-icon svg {
      display: block;
      width: 44px;
      height: 44px;
    }
    .ftshare-module-mask-card strong {
      color: #FFFFFF;
      font-size: 18px;
      font-weight: 700;
      line-height: 1.35;
    }
    .ftshare-module-mask-card p {
      max-width: 320px;
      margin: 0 0 4px;
      color: rgba(255, 255, 255, 0.88);
      font-size: 14px;
      line-height: 1.6;
    }
    .ftshare-module-mask-card a {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      padding: 8px 20px;
      color: #FFFFFF;
      background: #2F5BEA;
      border: 1px solid #2F5BEA;
      border-radius: 8px;
      box-shadow: 0 8px 18px rgba(47, 91, 234, 0.2);
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
    }
    .ftshare-module-mask-card a:hover {
      background: #2354E6;
      border-color: #2354E6;
    }
    .ftshare-module-mask-card a:focus-visible {
      outline: 2px solid #2354E6;
      outline-offset: 2px;
    }
    .ftshare-mask-host.ftshare-mask-host-compact {
      min-height: 184px;
    }
    .ftshare-mask-host-compact .ftshare-module-mask {
      min-height: 0;
      padding: 12px;
    }
    .ftshare-mask-host-compact .ftshare-module-mask-card {
      padding: 8px 12px;
    }
    .ftshare-mask-host-compact .ftshare-module-mask-icon,
    .ftshare-mask-host-compact .ftshare-module-mask-icon svg {
      width: 36px;
      height: 36px;
    }
    .ftshare-mask-host.ftshare-mask-host-horizontal {
      min-height: 168px;
    }
    .ftshare-mask-host-horizontal .ftshare-module-mask {
      min-height: 0;
      padding: 16px 24px;
      border-radius: 8px;
    }
    .ftshare-mask-host-horizontal .ftshare-module-mask-card {
      display: grid;
      width: min(100%, 720px);
      max-width: none;
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        "icon title action"
        "icon description action";
      gap: 4px 16px;
      padding: 12px 16px;
      text-align: left;
    }
    .ftshare-mask-host-horizontal .ftshare-module-mask-icon {
      grid-area: icon;
      align-self: center;
    }
    .ftshare-mask-host-horizontal .ftshare-module-mask-card strong {
      grid-area: title;
      align-self: end;
    }
    .ftshare-mask-host-horizontal .ftshare-module-mask-card p {
      grid-area: description;
      align-self: start;
    }
    .ftshare-mask-host-horizontal .ftshare-module-mask-card a {
      grid-area: action;
      align-self: center;
      white-space: normal;
    }
    .ftshare-partial-surface { margin: 12px 0; min-width: 0; width: 100%; }
    .ftshare-permission-supplement { max-width: 1200px; margin: 24px auto; padding: 0 12px; box-sizing: border-box; }
    @container (max-width: 560px) {
      .ftshare-mask-host-horizontal .ftshare-module-mask-card { display: flex; flex-direction: column; align-items: center; text-align: center; }
      .ftshare-mask-host-horizontal .ftshare-module-mask-card > * { align-self: center !important; grid-area: auto; }
    }
    .ftshare-mask-host { container-type: inline-size; }
    @media (max-width: 760px) {
      .ftshare-mask-host.ftshare-mask-host-horizontal {
        min-height: 216px;
      }
      .ftshare-module-mask {
        padding: 12px;
      }
      .ftshare-module-mask-card {
        width: min(100%, 300px);
        padding: 12px 16px;
      }
      .ftshare-module-mask-card strong {
        font-size: 16px;
      }
      .ftshare-module-mask-card a {
        min-width: 0;
        min-height: 38px;
        font-size: 14px;
      }
      .ftshare-mask-host-horizontal .ftshare-module-mask {
        padding: 12px;
      }
      .ftshare-mask-host-horizontal .ftshare-module-mask-card > * { align-self: center !important; grid-area: auto; }
      .ftshare-mask-host-horizontal .ftshare-module-mask-card {
        display: flex;
        width: min(100%, 300px);
        padding: 12px 16px;
        text-align: center;
      }
    }
  </style>`
}

function permissionMaskScript(reportType: keyof typeof TEMPLATE_FILES, permissions: PermissionNotice[], _dataGaps: string[] = []): string {
  // A subscription mask is a statement about access, not data completeness.
  // Empty responses, unsupported tools and deterministic fallback copy remain
  // visible and are never promoted to an upgrade requirement. The caller only
  // passes explicit restrictions, including partial-access notices. Partial
  // access keeps retrieved facts visible beside a dedicated restricted surface.
  if (permissions.length === 0) return ''
  const targets = PERMISSION_MASK_TARGETS[reportType] ?? []
  if (targets.length === 0) return ''
  const payload = safeJson({
    permissions: permissions.map(permission => ({
      tool: permission.tool,
      partial: permission.partial === true,
      requiredPlan: permission.requiredPlan,
      planLabel: FTSHARE_PLAN_LABELS[permission.requiredPlan as keyof typeof FTSHARE_PLAN_LABELS] ?? permission.requiredPlan,
      upgradeUrl: permission.upgradeUrl,
    })),
    targets: targets.map(target => ({
      selector: target.selector,
      tools: target.tools,
      matchMode: target.matchMode,
      label: target.label,
      title: target.title,
      gaps: target.gaps,
      hostSelector: target.hostSelector,
      compact: target.compact,
      horizontal: target.horizontal,
    })),
  })
  return `<script id="ftshare-module-mask-script">
    (() => {
      const payload = ${payload};
      const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
      const targets = Array.isArray(payload.targets) ? payload.targets : [];
      if (!targets.length || !document.body) return;
      const defaultUpgradeUrl = 'https://ftai.chat/me/profile?tab=subscription';

      function createMask(target, matches) {
        // Every permission-backed veil uses the same upgrade presentation so
        // the visual treatment stays identical across reports.
        const subscriptionLocked = true;
        const upgradeUrl = matches.find(item => item.upgradeUrl)?.upgradeUrl || defaultUpgradeUrl;
        const mask = document.createElement('div');
        mask.className = 'ftshare-module-mask';
        mask.dataset.ftshareMask = 'true';
        // Keep the subscription marker literal for backwards-compatible
        // consumers.
        mask.dataset.ftshareMaskReason = 'subscription';
        mask.dataset.ftshareMaskReason = subscriptionLocked ? 'subscription' : 'unavailable';
        mask.setAttribute('role', 'region');
        mask.setAttribute('aria-label', subscriptionLocked ? '升级 FtShare 订阅后查看完整内容' : '数据已遮罩');

        const card = document.createElement('div');
        card.className = 'ftshare-module-mask-card';
        const icon = document.createElement('span');
        icon.className = 'ftshare-module-mask-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false"><path d="M20 29V20a12 12 0 0 1 24 0v9" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><rect x="11" y="27" width="42" height="29" rx="3" stroke="currentColor" stroke-width="5"/><path d="M32 39v7" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
        const title = document.createElement('strong');
        title.textContent = subscriptionLocked ? '解锁' + (target.title || target.label) : '数据已遮罩';
        const description = document.createElement('p');
        description.textContent = subscriptionLocked ? '升级后即可查看完整数据与分析' : '当前结果仅展示已核验数据';
        card.append(icon, title, description);
        const link = document.createElement('a');
        link.href = upgradeUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.setAttribute('aria-label', '升级 FtShare 订阅');
        link.textContent = '升级 FtShare 订阅';
        if (subscriptionLocked) card.append(link);
        mask.append(card);
        return mask;
      }

      function applyMasks() {
        const covered = new Set();
        for (const [targetIndex, target] of targets.entries()) {
          if (!target || typeof target.selector !== 'string') continue;
          // A target is eligible only when one of its explicitly declared data
          // dependencies is blocked. Ordinary missing/empty fields have no
          // permission match and therefore never expand into a whole-card veil.
          const matches = Array.isArray(target.tools)
            ? permissions.filter(permission => target.tools.includes(permission.tool))
            : [];
          const eligible = target.matchMode === 'all'
            ? Array.isArray(target.tools) && target.tools.length > 0 && target.tools.every(tool => matches.some(permission => permission.tool === tool))
            : matches.length > 0;
          if (!eligible) continue;
          document.querySelectorAll(target.selector).forEach(match => {
            let host = typeof target.hostSelector === 'string' ? match.closest(target.hostSelector) : match;
            if (!(host instanceof HTMLElement)) return;
            if (host.id === 'report-quote-access') {
              const quote = document.getElementById('report-price-value');
              const price = quote?.dataset.price;
              if (quote && (!price || !Number.isFinite(Number(price)))) {
                host = quote.closest('.report-price') || host;
              }
            }
            // Partial access must never blur the facts that were successfully
            // returned. Reserve a separate surface for the restricted portion.
            const emptyPattern = /暂无数据|数据已遮罩|未覆盖|待确认|样本不足|未提供/;
            // Headings, ticker codes and placeholder copy are not retrieved facts.
            // A partial notice can refer to another symbol or another module.
            const valueCells = Array.from(host.querySelectorAll('.quant-value, [data-semantic], td, p, .stock-mini-price, .summary-value, .metric-value, .value'));
            const hasVisibleFacts = Boolean(host.querySelector('canvas')) || valueCells.some(cell => {
              if (cell.closest('[data-ftshare-mask], .ftshare-partial-surface, [hidden]')) return false;
              const text = (cell.textContent || '').trim();
              return text.length > 0 && !emptyPattern.test(text) && /[0-9]/.test(text);
            });
            if (host.id !== 'report-quote-access' && hasVisibleFacts && matches.every(permission => permission.partial === true)) {
              const key = String(targetIndex);
              const chart = !host.matches('[data-scroll="horizontal"]');
              // Keep scrollable table supplements inside their original grid item.
              // Other surfaces may own grid, flex or chart layouts; use a sibling.
              const owner = chart ? host.parentElement : host;
              if (!owner) return;
              let partial = Array.from(owner.children).find(child => child.dataset?.ftsharePartialKey === key && (!chart || child.previousElementSibling === host));
              if (!partial) {
                partial = document.createElement('div');
                partial.className = 'ftshare-partial-surface';
                partial.dataset.ftsharePartialKey = key;
                if (chart) host.after(partial);
                else host.append(partial);
              }
              host = partial;
            }
            // A template may replace a host's children after the first pass.
            // Skip only when an ancestor already owns the protected surface;
            // if this host lost its mask during re-rendering, rebuild it.
            if (host.parentElement?.closest('.ftshare-mask-host')) {
              if (host.getClientRects().length) matches.forEach(permission => covered.add(permission.tool));
              return;
            }
            for (const node of Array.from(host.childNodes)) {
              if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                const text = document.createElement('span');
                text.textContent = node.textContent;
                node.replaceWith(text);
              }
            }
            host.classList.add('ftshare-mask-host');
            if (target.compact === true) host.classList.add('ftshare-mask-host-compact');
            if (target.horizontal === true) host.classList.add('ftshare-mask-host-horizontal');
            const unavailablePattern = /数据已遮罩|字段未覆盖|未覆盖|公开信息暂不足/;
            host.querySelectorAll('*').forEach(element => {
              if (element.children.length === 0 && unavailablePattern.test(element.textContent || '')) {
                element.setAttribute('data-ftshare-unavailable', 'true');
              }
            });
            const hasMask = Array.from(host.children).some(child => child instanceof HTMLElement && child.dataset.ftshareMask === 'true');
            const hasContent = Array.from(host.children).some(child => !(child instanceof HTMLElement && child.dataset.ftshareMask === 'true'));
            if (!hasContent) host.dataset.ftshareMaskEmpty = 'true';
            else delete host.dataset.ftshareMaskEmpty;
            Array.from(host.children).filter(child => child.dataset?.ftshareMask !== 'true').forEach(child => {
                child.setAttribute('aria-hidden', 'true');
                child.setAttribute('inert', '');
              });
            if (!hasMask) host.append(createMask(target, matches));
            if (host.getClientRects().length) matches.forEach(permission => covered.add(permission.tool));
          });
        }
        // A new endpoint or a conditional template must not silently erase a
        // denied dataset. Keep a durable, named surface for unmatched notices.
        const unmatched = permissions.filter(permission => !covered.has(permission.tool));
        if (unmatched.length) {
          let supplement = document.getElementById('ftshare-permission-supplement');
          if (!supplement) {
            supplement = document.createElement('section');
            supplement.id = 'ftshare-permission-supplement';
            supplement.className = 'ftshare-permission-supplement';
            const heading = document.createElement('h2');
            heading.textContent = '受限数据模块';
            supplement.append(heading);
            (document.querySelector('main') || document.body).append(supplement);
          }
          for (const permission of unmatched) {
            if (Array.from(supplement.children).some(child => child.dataset?.ftshareTool === permission.tool)) continue;
            const surface = document.createElement('div');
            surface.className = 'ftshare-mask-host ftshare-mask-host-horizontal ftshare-partial-surface';
            surface.dataset.ftshareTool = permission.tool;
            surface.dataset.ftshareMaskEmpty = 'true';
            const names = [
              [/supply_chain/, '产业链数据'], [/announcement/, '公告数据'], [/report|brief/, '研报与事件数据'],
              [/flow/, '资金流数据'], [/limit/, '涨停数据'], [/etf/, 'ETF 数据'],
              [/realtime|company_list/, '实时行情数据'], [/candlestick|kline/, '历史行情数据'],
              [/finance/, '财务数据'], [/valuation/, '估值数据'], [/beta|risk/, '风险数据'],
              [/board|industry/, '板块数据'], [/hot|news/, '市场资讯'],
            ];
            const label = names.find(([pattern]) => pattern.test(permission.tool))?.[1] || '扩展数据';
            surface.append(createMask({ label }, [permission]));
            supplement.append(surface);
          }
        }
      }

      // Some report modules render their rows on DOMContentLoaded. Re-apply
      // the mask after those rows arrive so the protected content never
      // flashes unblurred and the unlock card is not removed by innerHTML.
      applyMasks();
      let applyScheduled = false;
      const scheduleApply = () => {
        if (applyScheduled) return;
        applyScheduled = true;
        queueMicrotask(() => {
          applyScheduled = false;
          applyMasks();
        });
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
      }
      if (typeof MutationObserver !== 'undefined' && document.body) {
        const observer = new MutationObserver(scheduleApply);
        observer.observe(document.body, { childList: true, subtree: true });

      }
    })();
  </script>`
}

function reportPrintBaseline(): string {
  return `<style id="ftai-report-print-baseline">
    .report-brand { width: 100%; margin: 0 auto 12px; padding: 0 0 4px; color: #2354E6; font-size: 16px; font-weight: 700; line-height: 24px; text-align: center; }
    @page { size: A4 portrait; margin: 12mm 10mm 14mm; }
    @media print {
      html, body { background: #fff !important; }
      body { min-width: 0 !important; font-size: 12px; line-height: 1.6; }
      body::before { display: none !important; }
      .report-shell, main, .container { width: auto !important; max-width: none !important; }
      .report-shell { padding: 0 !important; }
      .report-brand { margin: 0 0 8px; padding: 0 0 2px; font-size: 14px; }
      .report-header, .report-summary, .report-shell > section, section { box-shadow: none !important; }
      .report-header { break-inside: avoid; page-break-inside: avoid; }
      .report-brand, h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
      .grid { min-width: 0; }
      [class~="grid-cols-1"][class~="md:grid-cols-2"],
      [class~="grid-cols-1"][class~="lg:grid-cols-2"],
      [class~="grid-cols-1"][class~="xl:grid-cols-2"],
      [class~="grid-cols-1"][class~="md:grid-cols-3"],
      [class~="grid-cols-1"][class~="xl:grid-cols-3"] {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .grid > *, .card, [class*="card"], table, figure { break-inside: avoid; page-break-inside: avoid; min-width: 0; }
      .overflow-x-auto { overflow-x: visible !important; }
      canvas, svg, img { max-width: 100%; }
    }
    @media (max-width: 640px) { .report-brand { font-size: 14px; } }
  </style>`
}

/**
 * Fallback builders keep precise data-gap diagnostics for machine-readable
 * results and permission matching. Those diagnostics are not suitable as
 * report prose: they expose implementation details (tool names, LLM state)
 * and drown out the facts that are available. Sanitize only the template
 * context at the final rendering boundary so the internal result remains
 * lossless while every report type gets the same calm, user-facing wording.
 */
function sanitizeReportText(value: string): string {
  return value
    .replace(/\bmain_net\b/g, '主力净额').replace(/\bmain_pct\b/g, '主力净占比').replace(/\bnet_amount\b/g, '资金净额').replace(/\binflow\b/g, '流入').replace(/\boutflow\b/g, '流出')
    .replaceAll('数据不足，需继续跟踪；当前运行未获得结构化 LLM 内容。', '当前模块暂未生成解释，保留已接入事实。')
    .replaceAll('数据不足，需继续跟踪；FTShare 当前未提供足够事实。', '当前模块尚无可核验事实，待数据接入后更新。')
    .replaceAll('数据不足，需继续跟踪；FTShare当前未提供足够事实。', '当前模块尚无可核验事实，待数据接入后更新。')
    .replaceAll('LLM 未生成（仅 FTShare 数据）', '量化事实视图')
    .replaceAll('LLM 未返回可用结构化内容，已使用确定性 FTShare 数据上下文降级渲染', '解释层暂未生成，当前展示已接入量化事实')
    .replaceAll('结构化 LLM 报告生成失败，当前 HTML 仅包含 FTShare 数据和确定性指标', '解释层暂未生成，当前展示已接入量化事实')
    .replaceAll('FTShare 工具调用失败：', '扩展数据接口暂未返回该模块结果：')
    .replaceAll('FTShare 数据为空：', '该数据模块暂未返回内容：')
    .replaceAll('FTShare 未提供行业字段', '行业字段未纳入本次快照')
    .replaceAll('FTShare 未提供 FY1 PE', 'FY1 PE 未纳入本次快照')
    .replaceAll('FTShare 未提供可核验的 T0 回测序列', '本次快照未包含可核验的 T0 回测序列')
    .replaceAll('FTShare 当前未提供足够事实', '本次快照尚无足够可核验事实')
    .replaceAll('FTShare未提供', '本次快照未包含')
    .replaceAll('FTShare 未提供', '本次快照未包含')
    .replaceAll('未获得结构化 LLM 内容', '解释层暂未生成')
    .replaceAll('数据暂不可用', '当前模块未接入')
    .replaceAll('数据缺失', '字段未覆盖')
    .replaceAll('数据不足', '未覆盖')
    // Keep ordinary non-permission gaps neutral; only the client-side mask
    // handles content tied to an explicit blocked permission.
    .replaceAll('当前模块尚无可核验事实，待数据接入后更新。', '数据已遮罩')
    .replaceAll('当前模块尚无可核验事实', '数据已遮罩')
    .replaceAll('当前模块未接入', '数据已遮罩')
    .replaceAll('当前数据源未返回', '数据已遮罩')
    .replaceAll('待数据接入后更新', '数据已遮罩')
    .replaceAll('数据暂未返回', '数据已遮罩')
    .replaceAll('该数据模块暂未返回内容：', '数据已遮罩')
    .replaceAll('扩展数据接口暂未返回该模块结果：', '数据已遮罩')
    // This is ordinary template/fallback copy, not an access decision. Keep
    // it neutral so only an explicit blocked permission receives the visual
    // subscription veil and upgrade CTA.
    .replaceAll('数据已遮罩', '暂无数据')
}

function sanitizeTemplateContextValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    // URLs, tool identifiers and permission keys are consumed by scripts;
    // leave their exact values intact. Human-facing text is sanitized above.
    if (/^(?:url|href|src|tool|requiredPlan|upgradeUrl|url_hash)$/i.test(key)) return value
    return sanitizeReportText(value)
  }
  if (Array.isArray(value)) return value.map(item => sanitizeTemplateContextValue(item, key))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = sanitizeTemplateContextValue(childValue, childKey)
    }
    return output
  }
  return value
}

function sanitizeTemplateContext(context: TemplateContext): TemplateContext {
  return sanitizeTemplateContextValue(context) as TemplateContext
}

function prepareSectorCards(context: TemplateContext): TemplateContext {
  const copy = structuredClone(context) as any
  const report = copy.report
  if (!report) return copy
  const readableDate = (value: unknown) => String(value ?? '').replace(/\b(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/g, '$1-$2-$3')
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
  const tone = (value: number) => value > 0 ? 'up' : value < 0 ? 'down' : 'neutral'
  const trend = report.capital_flow?.trend
  if (trend && Array.isArray(trend.values) && Array.isArray(trend.dates)) {
    const valid = trend.values.every((value: unknown) => typeof value === 'number' && Number.isFinite(value)) && trend.values.length === trend.dates.length
    if (valid && trend.values.length) {
      const values = trend.values as number[]
      const lastDate = readableDate(trend.dates.at(-1))
      const horizons = [1, 5, 20].map(period => {
        const available = values.length >= period
        const value = available ? values.slice(-period).reduce((sum, n) => sum + n, 0) : null
        return { label: period === 1 ? '最新净额' : `近${period}期累计`, value: value === null ? '样本不足' : signed(value), tone: value === null ? 'neutral' : tone(value) }
      })
      trend.summary_metrics = [{ label: '历史样本', value: `${values.length} 个交易日`, tone: 'neutral' }, { label: '资金数据截止', value: lastDate, tone: 'neutral' }]
      if (report.capital_flow.joint_reading) {
        report.capital_flow.joint_reading.horizons = horizons
        if (!report.analysis_meta) report.capital_flow.joint_reading.title = '资金流向与持续性'
        if (!report.analysis_meta) report.capital_flow.joint_reading.description = `资金数据截至 ${lastDate}；累计净额按同一来源最近 5 期、20 期已发布日记录计算。`
      }
    }
  }
  const metrics = report.key_metrics ?? []
  const close = metrics.find((item: any) => item.label === '板块指数收盘')
  const change = metrics.find((item: any) => item.label === '单日涨跌幅')
  const capital = metrics.find((item: any) => item.label === '最新资金净额')
  const breadth = report.structure?.breadth
  if (!report.analysis_meta && report.summary && close && change && capital) {
    report.summary.headline = `${report.meta?.sector_name ?? '板块'}：行情、资金与成员结构`
    report.summary.body = `截至 ${readableDate(report.meta?.data_as_of)}，板块指数收盘 ${close.value}，单日涨跌 ${change.value}。最新资金净额 ${capital.value}（${readableDate(capital.note)}）。${readableDate(breadth?.caption ?? '')}。`
  }
  const coverage = String(breadth?.caption ?? '').match(/(\d+)\/(\d+)/)?.[0]
  for (const metric of report.conclusion?.metrics ?? []) if (metric.label === '成员样本' && coverage) { metric.label = '同日行情覆盖'; metric.value = coverage }
  for (const risk of report.events?.risks ?? []) if (!report.analysis_meta && risk.title === '资金持续性' && trend?.values?.length > 1) risk.description = `已有 ${trend.values.length} 期资金记录，需结合累计净额与行情验证持续性。`
  if (report.conclusion?.observations) report.conclusion.observations = report.conclusion.observations.map((text: string) => text.replace('成交额变化', '成交量变化'))
  for (const metric of metrics) metric.note = readableDate(metric.note)
  if (breadth) {
    breadth.caption = readableDate(breadth.caption)
    for (const stat of breadth.stats ?? []) stat.label = readableDate(stat.label)
  }
  if (report.structure) report.structure.subsector_subtitle = readableDate(report.structure.subsector_subtitle)
  if (report.performance?.phase) {
    report.performance.phase.description = readableDate(report.performance.phase.description)
    for (const step of report.performance.phase.steps ?? []) if (step.label === '同日行情覆盖') step.label = '行情覆盖'
  }
  for (const driver of report.drivers ?? []) {
    const evidence = Array.isArray(driver.evidence) ? driver.evidence : []
    const text = [driver.title, driver.summary, ...evidence.map((row: any) => `${row.label ?? ''} ${row.text ?? ''}`)].join(' ')
    const kind = /产业链|供应链|上下游/.test(text) ? 'chain' : /净额|净流|资金|主力/.test(text) ? 'capital' : /估值|市盈|市净|PE|PB/.test(text) ? 'valuation' : 'price'
    driver.source_kind = kind
    if (!report.analysis_meta && !String(driver.title ?? '').trim()) driver.title = ({ chain: '产业链传导', capital: '资金流向', valuation: '估值变化', price: '价格走势' })[kind]
    if (!report.analysis_meta && !String(driver.summary ?? '').trim()) driver.summary = evidence.length ? (kind === 'capital' && report.capital_flow?.snapshot?.metrics?.[0]?.value ? `最新资金净额 ${report.capital_flow.snapshot.metrics[0].value}。结合历史记录观察资金方向与持续性。` : evidence.map((row: any) => `${row.label ? row.label + '：' : ''}${row.text ?? ''}`).join('；')) : '当前缺少可核验的驱动证据。'
  }
  const order = report.capital_flow?.order_structure
  if (order && Array.isArray(order.items)) {
    const numeric = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))
    order.has_gross = order.items.some((item: any) => numeric(item.buy) || numeric(item.sell))
    const maximum = Math.max(0, ...order.items.filter((item: any) => numeric(item.net)).map((item: any) => Math.abs(Number(item.net))))
    for (const item of order.items) {
      const net = numeric(item.net) ? Number(item.net) : null
      item.net_tone = net === null || net === 0 ? 'neutral' : net > 0 ? 'up' : 'down'
      if (!order.has_gross) {
        item.buy_width_pct = net !== null && net > 0 && maximum ? net / maximum * 50 : 0
        item.sell_width_pct = net !== null && net < 0 && maximum ? -net / maximum * 50 : 0
      }
    }
    if (!order.has_gross) order.subtitle = '按订单规模观察净流入与净流出'
  }
  return copy
}

export async function renderReportTemplate(reportType: keyof typeof TEMPLATE_FILES, context: TemplateContext, permissions: PermissionNotice[] = [], dataGaps: string[] = []): Promise<string> {
  const file = TEMPLATE_FILES[reportType]
  if (!file) throw new Error(`不支持的报告类型：${reportType}`)
  const template = prepareTemplate(await readFile(new URL(`../resources/templates/${file}`, import.meta.url), 'utf8'))
  const html = createEnvironment().renderString(template, sanitizeTemplateContext(reportType === 'sector_analysis' ? prepareSectorCards(context) : context))
  const effectiveDataGaps = ['deep_read', 'portfolio_stocks', 'portfolio_etfs', 'review'].includes(reportType)
    ? [...dataGaps, '本次快照未纳入 T0 回测序列']
    : dataGaps
  const maskScript = permissionMaskScript(reportType, permissions, [...new Set(effectiveDataGaps)])
  const maskStyle = maskScript ? permissionMaskStyle() : ''
  let novaStyle = ''
  if (reportType === 'sector_analysis') {
    const [theme, banner] = await Promise.all([
      readFile(new URL('../resources/templates/sector-nova.css', import.meta.url), 'utf8'),
      readFile(new URL('../resources/assets/sector-banner.jpg', import.meta.url)),
    ])
    // Embed the banner so downloaded reports do not depend on a local asset path.
    const bannerUrl = `data:image/jpeg;base64,${banner.toString('base64')}`
    novaStyle = `<style id="nova-sector-theme">${theme.replace('__NOVA_BANNER__', bannerUrl)}</style>`
  }
  const baselineStyle = reportPrintBaseline()
  const withStyle = html.replace(/<\/head>/i, `${baselineStyle}\n${maskStyle}\n${novaStyle}\n</head>`)
  const withBrand = /class=["'][^"']*report-brand/.test(withStyle)
    ? withStyle
    : withStyle.replace(/<body([^>]*)>/i, '<body$1><div class="report-brand" aria-label="报告品牌">FtAi：股票投研报告</div>')
  return withBrand.replace('</body>', `${maskScript}\n<!-- Generated by FT 投研舱; data source: FTShare; LLM content is grounded in retrieved facts. -->\n</body>`)
}

export async function renderReportHtml(model: ReportViewModel, permissions: PermissionNotice[] = []): Promise<string> {
  const permissionMessages = new Set(permissions.map(permission => permission.message))
  const visibleGaps = model.data_gaps.filter(gap => !permissionMessages.has(gap))
  const legacy = legacyContext({ ...model, data_gaps: visibleGaps })
  const quant = legacy.quant_data as Record<string, unknown>
  const reportGaps = [...visibleGaps]
  if (!quant.financial_indicator) reportGaps.push('缺少 FTShare PIT 财务指标数据')
  if (!quant.capital_flow) reportGaps.push('缺少 FTShare 资金流数据')
  reportGaps.push('本次快照未纳入 T0 回测序列')
  return renderReportTemplate('deep_read', legacy, permissions, [...new Set(reportGaps)])
}
