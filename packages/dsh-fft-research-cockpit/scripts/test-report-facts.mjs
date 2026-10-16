/**
 * 报告取数回归：`loadReportFacts` 对每种报告类型都要把上游明细折成事实。
 *
 * 取数经 `ctx.ftshareData`（这里用假服务），结局读四态：`denied` 如实记成权限提示、
 * `empty` 记成「数据为空」、可重试的 `failed` 重试。旧用例里的候选降级与
 * `callWithSubscriptionFallback` 已随候选链删除，本用例反向守住「不再降级」。
 */
import assert from 'node:assert/strict'

import { loadReportFacts } from '../lib/report-data.js'
import { loadSnapshot } from '../lib/ftshare-data.js'
import { available, denied, empty, failed, fakeFtshare } from './fake-ftshare.mjs'

const asOf = '2026-09-03'
const signal = new AbortController().signal
const config = { maxKlineDays: 120, announcementLookbackDays: 30 }

const klineRows = [
  { trade_date: '20260902', open: 100, high: 110, low: 95, close: 108, volume: 1000 },
  { trade_date: '20260903', open: 108, high: 112, low: 106, close: 111, volume: 1200 },
]

/** 一条能力一个接口：这张表就是投研舱会碰到的全部接口。 */
const table = {
  ft_v1_ths_board_list: [{ name: '第三代半导体', code: '885908', module: 'concept' }, { name: '半导体', code: '881121', module: 'industry' }],
  ft_v1_ths_board_kline: [{ symbol: '881121', items: klineRows }],
  ft_v1_sw_industry_overview: [{ name: '半导体', code: 'BK1036', pe: 31, pb: 3.2 }],
  ft_v1_ths_industry_daily_flow: [{ trade_date: '20260903', sector_name: '半导体', sector_code: 'BK1036', main_net: 100000000, super_large_net: 50000000 }],
  ft_v1_eastmoney_sector_flow: [{ trade_date: '20260903', sector_name: '半导体', sector_code: 'BK1036', main_net: 100000000, super_large_net: 50000000 }],
  ft_v1_tdx_board_members: [{ con_code: '300750', con_name: '宁德时代' }, { con_code: '688981', con_name: '中芯国际' }],
  ft_v3_supply_chain_subindustry_supply_chain: [{ name: '硅片', description: '产业链关系线索' }],
  ft_v4_stock_realtime_day_kline: [{ symbol: '300750.SZ', items: [{ pct_change: 2.1, close: 120 }] }, { symbol: '688981.SH', items: [{ pct_change: -1.2, close: 80 }] }],
  ft_v2_etf_description_all: [{ etf_code: 510300, etf_name: '沪深300ETF' }, { etf_code: '159915', etf_name: '创业板ETF' }],
  ft_v4_etf_realtime_day_kline: [{ symbol: '510300.SH', items: klineRows }, { symbol: '159915.SZ', items: klineRows }],
  ft_v1_etf_candlesticks: klineRows,
  ft_v1_daec_stocks: [{ symbol: '300750', change_rate: 1.2 }],
  ft_v1_daec_market_snapshot: [{ up_count: 2500, down_count: 1800, flat_count: 300, limit_up_count: 60, limit_down_count: 12 }],
  ft_v1_eastmoney_market_valuation: [{ name: '上证指数', close: 3388, change_rate: 0.8 }],
  ft_v1_stock_capital_flows: [{ stock_code: '300750', stock_name: '宁德时代', main_net: 100000000 }],
  ft_v1_eastmoney_dapan_flow: [{ stock_code: '300750', stock_name: '宁德时代', main_net: 100000000 }],
  ft_v1_limit_list: [{ stock_code: '300750', stock_name: '宁德时代', status: 'limit_up', change_rate: 10 }],
  ft_v2_limit_event_timeline_3s: [{ stock_code: '300750', stock_name: '宁德时代', status: 'limit_up', change_rate: 10 }],
  ft_v3_limit_up_reports_briefs: [{ stock_code: '300750', title: '涨停简报', summary: '事件摘要' }],
  ft_v1_ths_hot_list: [{ stock_code: '300750', title: '热榜', summary: '热度摘要' }],
  ft_v2_announcements_stock_announcements: [{ stock_code: '300750', title: '公告', published_at: '2026-09-03', url: 'https://example.com' }],
  ft_v1_company_list: [{ stock_code: '300750', stock_name: '宁德时代', close: 120, pct_change: 2.1, industry: '电池' }],
  ft_v1_stock_candlesticks: klineRows,
  ft_v1_finance_income: [{ report_date: '20260630', revenue: 1000000000, net_profit: 100000000 }],
  ft_v1_finance_cashflow: [{ report_date: '20260630', operating_cashflow: 120000000 }],
  ft_v1_finance_balance: [{ report_date: '20260630', t_equity: 600 }],
  ft_v1_eastmoney_stock_valuation: [{ trade_date: '20260903', pe_ttm: 30, pb_mrq: 3.2 }],
  ft_v2_report_stock_reports: [{ title: '研报', published_at: '2026-09-02', summary: '观点摘要' }],
  ft_v1_eastmoney_stock_flow: [{ trade_date: '20260903', main_net: 100 }],
  ft_v1_margin_trading_details: [{ date: '2026-09-03', symbol: '300750.SZ', margin_trading_balance: 1000, total_balance: 1200, margin_trading_buying_amount: 100, securities_lending_selling_volume: 10 }],
  ft_v1_sw_industry_constituent_history: [{ stockCode: '300750', inDate: '2020-01-01', outDate: null }],
}

const unexpected = []
/** 主假服务：表里有的返回明细，表外的记为「意外接口」（用例末尾统一断言）。 */
function makeService(overrides = {}) {
  const service = fakeFtshare(tool => {
    if (tool in overrides) return overrides[tool]
    if (tool in table) return available(table[tool])
    unexpected.push(tool)
    return empty()
  })
  return service
}

const service = makeService()

const sector = await loadReportFacts(service, { reportType: 'sector_analysis', sectorName: '半导体', sectorCode: 'BK1036' }, asOf, config, signal)
if (sector.sectors.filter(row => row.trade_date).length !== 2) throw new Error(`sector K-line history collapsed: ${JSON.stringify(sector.sectors)}`)
if (sector.constituents.length !== 2 || !sector.raw.sector_member_quotes) throw new Error('sector members/quotes were not loaded')
const boardCall = service.calls.find(item => item.tool === 'ft_v1_ths_board_kline')
if (boardCall?.args.board_code !== '881121' || Object.keys(boardCall.args).some(key => !['board_code', 'page', 'page_size'].includes(key))) throw new Error('sector K-line must use exact industry identity and documented single-board arguments')
if (service.calls.some(item => item.tool === 'ft_v1_ths_all_board_kline')) throw new Error('all-board endpoint is not an alias for single-board history')
const flowCall = service.calls.find(item => item.tool === 'ft_v1_ths_industry_daily_flow')
if (!(flowCall.args.start_date < '20260901')) throw new Error('sector flow must request history, not only today/weekend')

const etf = await loadReportFacts(service, { reportType: 'portfolio_etfs', symbols: ['510300', '159915'] }, asOf, config, signal)
if (etf.market.filter(row => row.asset_type === 'etf').length < 2) throw new Error('ETF descriptions were not loaded')
if (etf.indices.filter(row => row.asset_type === 'etf').length < 4) throw new Error(`ETF K-line history collapsed: ${JSON.stringify(etf.indices)}`)

const reportTypes = [
  ['holding_analysis', { holdings: [{ symbol: '300750', name: '宁德时代', quantity: 10 }] }],
  ['portfolio_stocks', { holdings: [{ symbol: '300750', name: '宁德时代' }] }],
  ['market_commentary', { phase: 'after_close' }],
  ['limit_up_attribution', {}],
  ['review', { holdings: [{ symbol: '300750', name: '宁德时代' }] }],
]
for (const [reportType, request] of reportTypes) {
  const facts = await loadReportFacts(service, { reportType, ...request }, asOf, config, signal)
  const hasFacts = facts.snapshots.length || facts.market.length || facts.indices.length || facts.limits.length
  if (!hasFacts) throw new Error(`${reportType} did not load any core FTShare facts`)
}
assert.deepEqual(unexpected, [], `unexpected interfaces: ${unexpected.join(', ')}`)
console.log(`report-facts: ok (${service.calls.length} mocked FTShare calls)`)

// 上游把门禁藏在成功信封里时，底座会归一成 denied；投研舱必须原样保留成权限提示。
const restricted = await loadReportFacts(makeService({
  ft_v3_supply_chain_subindustry_supply_chain: denied('订阅权限不足', { code: 'capability_limited', requiredPlan: 'Advanced' }),
}), { reportType: 'sector_analysis', sectorName: '半导体', sectorCode: 'BK1036' }, asOf, config, signal)
if (!restricted.blockedPermissions.some(item => item.tool === 'ft_v3_supply_chain_subindustry_supply_chain')) throw new Error('structured restriction was discarded')
if (!restricted.blockedPermissions.every(item => item.upgradeUrl)) throw new Error('permission notice must carry an upgrade entry')
console.log('structured permission from the base service: ok')

// 候选链已删除：高优先接口 denied 时不再回落到同名族接口，如实上报。
const noFallback = makeService({ ft_v4_stock_realtime_day_kline: denied('当前套餐未开通该接口', { requiredPlan: 'Pro' }) })
const today = new Date().toISOString().slice(0, 10)
const realtimeSnapshot = await loadSnapshot(noFallback, '300750', today, 120, signal, 30, { includeExtendedFacts: false })
if (noFallback.calls.some(item => item.tool === 'ft_v1_company_list')) throw new Error('realtime denial must not fall back to the free snapshot endpoint')
if (!realtimeSnapshot.blockedPermissions.some(item => item.tool === 'ft_v4_stock_realtime_day_kline')) throw new Error('realtime denial was dropped')
if (realtimeSnapshot.quote !== null) throw new Error('a denied realtime call must not fabricate a quote')
console.log('candidate chains removed: denied is reported as-is')

// A Monday request must recover Friday's data, without requesting unsupported
// single-board filters or incorporating a future candle.
const { fallbackContext } = await import('../lib/llm-report.js')
let boardAttempts = 0
const mondayCalls = []
const mondayService = fakeFtshare((tool, args) => {
  mondayCalls.push({ tool, args })
  if (tool === 'ft_v1_ths_board_list' && boardAttempts++ === 0) return failed('上游服务暂时不可用', { code: 'UPSTREAM_UNAVAILABLE', retryable: true })
  if (tool === 'ft_v1_sw_industry_overview') return available(args.date === '20260904' ? [{ industryName: '半导体', industryCode: '801081.SI', ttmPe: '59.5', pb: '10.46' }] : [])
  if (tool === 'ft_v1_ths_board_kline') return available([{ date: '20260908', open: 999, high: 999, low: 999, close: 999, volume: 999 }, { date: '20260904', open: 100, high: 110, low: 99, close: 108, volume: 1000 }])
  return tool in table ? available(table[tool]) : empty()
})
const mondayFacts = await loadReportFacts(mondayService, { reportType: 'sector_analysis', sectorName: '半导体', sectorCode: 'BK1036' }, '2026-09-07', config, signal)
const mondayReport = fallbackContext(mondayFacts).report
if (boardAttempts !== 2 || mondayReport.performance.sector_kline.trade_date.join(',') !== '20260904') throw new Error('retry/date filtering failed')
if (!mondayCalls.some(call => call.tool === 'ft_v1_sw_industry_overview' && call.args.date === '20260904')) throw new Error('Monday valuation fallback did not reach Friday')
if (mondayReport.valuation.panels[0].metrics[0].value !== '59.5') throw new Error('camelCase valuation fields were lost')
if (mondayReport.capital_flow.trend.dates.length !== 1) throw new Error('providers produced duplicated daily flow points')
console.log('sector schema, retry, weekend, valuation and flow series: ok')
