import { loadReportFacts } from '../lib/report-data.js'
import { callWithSubscriptionFallback } from '../lib/ftshare-client.js'

const asOf = '2026-09-03'
const signal = new AbortController().signal
const calls = []

const klineRows = [
  { trade_date: '20260902', open: 100, high: 110, low: 95, close: 108, volume: 1000 },
  { trade_date: '20260903', open: 108, high: 112, low: 106, close: 111, volume: 1200 },
]

const session = {
  async call(tool, args) {
    calls.push({ tool, args })
    if (tool === 'ft_v1_ths_board_list') return { data: [{ name: '第三代半导体', code: '885908', module: 'concept' }, { name: '半导体', code: '881121', module: 'industry' }] }
    if (tool === 'ft_v1_ths_all_board_kline') throw new Error('tool not found: ft_v1_ths_all_board_kline')
    if (tool === 'ft_v1_ths_board_kline') return { data: [{ symbol: '881121', items: klineRows }] }
    if (tool === 'ft_v1_sw_industry_overview') return { data: [{ name: '半导体', code: 'BK1036', pe: 31, pb: 3.2 }] }
    if (tool === 'ft_v1_ths_industry_daily_flow' || tool === 'ft_v1_eastmoney_sector_flow') return { data: [{ trade_date: '20260903', sector_name: '半导体', sector_code: 'BK1036', main_net: 100000000, super_large_net: 50000000 }] }
    if (tool === 'ft_v1_tdx_board_members') return { data: [{ con_code: '300750', con_name: '宁德时代' }, { con_code: '688981', con_name: '中芯国际' }] }
    if (tool === 'ft_v3_supply_chain_subindustry_supply_chain') return { data: [{ name: '硅片', direction: args.direction, description: '产业链关系线索' }] }
    if (tool === 'ft_v4_stock_realtime_day_kline') return { data: [{ symbol: '300750.SZ', items: [{ pct_change: 2.1, close: 120 }] }, { symbol: '688981.SH', items: [{ pct_change: -1.2, close: 80 }] }] }

    if (tool === 'ft_v2_etf_description_all') return { data: [{ etf_code: 510300, etf_name: '沪深300ETF' }, { etf_code: '159915', etf_name: '创业板ETF' }] }
    if (tool === 'ft_v4_etf_realtime_day_kline') return { data: [{ symbol: '510300.SH', items: klineRows }, { symbol: '159915.SZ', items: klineRows }] }
    if (tool === 'ft_v1_etf_candlesticks') return { data: klineRows }

    if (tool === 'ft_v1_daec_stocks') return { data: [{ symbol: '300750', change_rate: 1.2 }] }
    if (tool === 'ft_v1_daec_market_snapshot') return { data: [{ up_count: 2500, down_count: 1800, flat_count: 300, limit_up_count: 60, limit_down_count: 12 }] }
    if (tool === 'ft_v1_eastmoney_market_valuation') return { data: [{ name: '上证指数', close: 3388, change_rate: 0.8 }] }
    if (tool === 'ft_v1_stock_capital_flows' || tool === 'ft_v2_eastmoney_dapan_flow') return { data: [{ stock_code: '300750', stock_name: '宁德时代', main_net: 100000000 }] }
    if (tool === 'ft_v1_limit_list' || tool === 'ft_v2_limit_event_timeline_3s') return { data: [{ stock_code: '300750', stock_name: '宁德时代', status: 'limit_up', change_rate: 10 }] }
    if (tool === 'ft_v3_limit_up_reports_briefs') return { data: [{ stock_code: '300750', title: '涨停简报', summary: '事件摘要' }] }
    if (tool === 'ft_v2_ths_hot_list') return { data: [{ stock_code: '300750', title: '热榜', summary: '热度摘要' }] }
    if (tool === 'ft_v3_announcements_stock_announcements' || tool === 'ft_v1_report_announcements_list' || tool === 'ft_v1_report_announcement_list') return { data: [{ stock_code: '300750', title: '公告', published_at: '2026-09-03', url: 'https://example.com' }] }

    if (tool === 'ft_v4_stock_realtime_day_kline') return { data: [{ symbol: '300750.SZ', items: [{ close: 120, pct_change: 2.1 }] }] }
    if (tool === 'ft_v1_company_list') return { data: [{ stock_code: '300750', stock_name: '宁德时代', close: 120, pct_change: 2.1, industry: '电池' }] }
    if (tool === 'ft_v1_stock_candlesticks') return { data: klineRows }
    if (tool === 'ft_v1_finance_income') return { data: [{ report_date: '20260630', revenue: 1000000000, net_profit: 100000000 }] }
    if (tool === 'ft_v1_finance_cashflow') return { data: [{ report_date: '20260630', operating_cashflow: 120000000 }] }
    if (tool === 'ft_v1_eastmoney_stock_valuation') return { data: [{ trade_date: '20260903', pe_ttm: 30, pb_mrq: 3.2 }] }
    if (tool === 'ft_v3_report_stock_reports') return { data: [{ title: '研报', published_at: '2026-09-02', summary: '观点摘要' }] }
    throw new Error(`unexpected mock tool: ${tool}`)
  },
}

const config = { maxKlineDays: 120, announcementLookbackDays: 30 }

// Alias fallback must follow the subscription-sorted order, not the caller's
// input order.  This guards callers that list a Free compatibility endpoint
// before the preferred Pro endpoint.
const aliasCalls = []
const aliasSession = {
  async call(tool) {
    aliasCalls.push(tool)
    if (tool === 'ft_v4_stock_realtime_day_kline') throw new Error('tool not found: ft_v4_stock_realtime_day_kline')
    if (tool === 'ft_v1_company_list') return { data: [{ symbol: '300750', close: 120 }] }
    throw new Error(`unexpected alias tool: ${tool}`)
  },
}
const aliasResult = await callWithSubscriptionFallback(aliasSession, [
  { tool: 'ft_v1_company_list', plan: 'Free', arguments_: { stock_code: '300750' } },
  { tool: 'ft_v4_stock_realtime_day_kline', plan: 'Pro', arguments_: { symbols: ['300750.SZ'] } },
], signal)
if (aliasResult.tool !== 'ft_v1_company_list' || aliasCalls.join(',') !== 'ft_v4_stock_realtime_day_kline,ft_v1_company_list') throw new Error(`subscription-sorted alias fallback failed: ${aliasCalls.join(',')}`)

const sector = await loadReportFacts(session, { reportType: 'sector_analysis', sectorName: '半导体', sectorCode: 'BK1036' }, asOf, config, signal)
if (sector.sectors.filter(row => row.trade_date).length !== 2) throw new Error(`sector K-line history collapsed: ${JSON.stringify(sector.sectors)}`)
if (sector.constituents.length !== 2 || !sector.raw.sector_member_quotes) throw new Error('sector members/quotes were not loaded')
const boardCall = calls.find(item => item.tool === 'ft_v1_ths_board_kline')
if (boardCall?.args.board_code !== '881121' || Object.keys(boardCall.args).some(key => !['board_code', 'page', 'page_size'].includes(key))) throw new Error('sector K-line must use exact industry identity and documented single-board arguments')
if (calls.some(item => item.tool === 'ft_v1_ths_all_board_kline')) throw new Error('all-board endpoint is not an alias for single-board history')
const flowCall = calls.find(item => item.tool === 'ft_v1_ths_industry_daily_flow')
if (!(flowCall.args.start_date < '20260901')) throw new Error('sector flow must request history, not only today/weekend')

const etf = await loadReportFacts(session, { reportType: 'portfolio_etfs', symbols: ['510300', '159915'] }, asOf, config, signal)
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
  const facts = await loadReportFacts(session, { reportType, ...request }, asOf, config, signal)
  const hasFacts = facts.snapshots.length || facts.market.length || facts.indices.length || facts.limits.length
  if (!hasFacts) throw new Error(`${reportType} did not load any core FTShare facts`)
}

console.log(`report-facts: ok (${calls.length} mocked FTShare calls)`)

// Gateways can return restrictions inside successful structured responses.
// They must survive both optional report calls and usable fallback results.
const restricted = await loadReportFacts({ async call(tool) {
  return { data: [], metadata: tool.includes('supply_chain') ? { permission_denied: true, required_plan: 'Advanced', message: '订阅权限不足' } : {} }
} }, { reportType: 'sector_analysis', sectorName: '半导体', sectorCode: 'BK1036' }, asOf, config, signal)
if (!restricted.blockedPermissions.some(item => item.tool === 'ft_v3_supply_chain_subindustry_supply_chain')) throw new Error('structured metadata restriction was discarded')
const downgradeCalls = []
const downgraded = await callWithSubscriptionFallback({ async call(tool) {
  downgradeCalls.push(tool)
  return tool.startsWith('ft_v4')
    ? { data: [], metadata: { access: 'restricted', required_plan: 'Pro' } }
    : { data: [{ close: 123 }] }
} }, [
  { tool: 'ft_v1_company_list', plan: 'Free', arguments_: {} },
  { tool: 'ft_v4_stock_realtime_day_kline', plan: 'Pro', arguments_: {} },
], signal)
if (downgradeCalls[0] !== 'ft_v4_stock_realtime_day_kline' || !downgraded.permissions[0]?.partial || downgraded.value.data[0].close !== 123) throw new Error('downgrade must preserve facts and restricted high-tier surface')
console.log('structured permissions and partial downgrade: ok')

// A Monday request must recover Friday's data, without requesting unsupported
// single-board filters or incorporating a future candle.
const { FtShareError } = await import('../lib/ftshare-client.js')
const { fallbackContext } = await import('../lib/llm-report.js')
let boardAttempts = 0
const mondayCalls = []
const mondayFacts = await loadReportFacts({ async call(tool, args) {
  mondayCalls.push({tool,args})
  if (tool === 'ft_v1_ths_board_list' && boardAttempts++ === 0) throw new FtShareError('上游服务暂时不可用', {code:'UPSTREAM_UNAVAILABLE'})
  if (tool === 'ft_v1_sw_industry_overview') return {data: args.date === '20260904' ? [{industryName:'半导体',industryCode:'801081.SI',ttmPe:'59.5',pb:'10.46'}] : []}
  if (tool === 'ft_v1_ths_board_kline') return {data:[{date:'20260908',open:999,high:999,low:999,close:999,volume:999},{date:'20260904',open:100,high:110,low:99,close:108,volume:1000}]}
  return session.call(tool,args)
}}, {reportType:'sector_analysis',sectorName:'半导体',sectorCode:'BK1036'}, '2026-09-07', config, signal)
const mondayReport = fallbackContext(mondayFacts).report
if (boardAttempts !== 2 || mondayReport.performance.sector_kline.trade_date.join(',') !== '20260904') throw new Error('retry/date filtering failed')
if (!mondayCalls.some(call=>call.tool==='ft_v1_sw_industry_overview' && call.args.date==='20260904')) throw new Error('Monday valuation fallback did not reach Friday')
if (mondayReport.valuation.panels[0].metrics[0].value !== '59.5') throw new Error('camelCase valuation fields were lost')
if (mondayReport.capital_flow.trend.dates.length !== 1) throw new Error('providers produced duplicated daily flow points')
console.log('sector schema, retry, weekend, valuation and flow series: ok')
