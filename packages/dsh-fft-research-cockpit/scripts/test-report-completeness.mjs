import { fallbackContext, generateTemplateReport } from '../lib/llm-report.js'
import { renderReportHtml, renderReportTemplate } from '../lib/html-renderer.js'

const unavailable = '数据不足，需继续跟踪；FTShare 当前未提供足够事实。'
const base = {
  asOf: '2026-09-03', request: {}, snapshots: [], market: [], indices: [], sectors: [], constituents: [], flows: [], limits: [], announcements: [], news: [], raw: {}, provenance: [], permissions: [], blockedPermissions: [], dataGaps: [], warnings: [],
}

const facts = {
  ...base,
  reportType: 'sector_analysis',
  request: { reportType: 'sector_analysis', sectorName: '半导体', sectorCode: 'BK1036' },
  sectors: [
    { board_code: '881121', date: '20260902', open: 100, high: 110, low: 95, close: 108, volume: 1000 },
    { name: '半导体', industry_name: '半导体', pe: 30, pb: 3 },
  ],
  constituents: [{ code: '300750', name: '宁德时代' }],
  flows: [{ trade_date: '20260902', sector_name: '半导体', main_net: 100000000, super_large_net: 50000000 }],
  announcements: [{ title: '公告标题', published_at: '2026-09-02', url: 'https://example.com' }],
  // Batch member quotes are grouped by symbol on some FTShare gateways.
  // The child quote must inherit the parent symbol before breadth/leader joins.
  raw: { sector_member_quotes: { data: [{ symbol: '300750', items: [{ date: '20260902', pct_change: 2.1, industry: '电池' }] }] } },
}

const context = fallbackContext(facts)
const sector = context.report
if (sector.validation.items.length < 3) throw new Error('sector validation fallback is incomplete')
if (sector.valuation.panels.length < 2) throw new Error('sector valuation fallback is incomplete')
if (sector.leaders.items.length < 1) throw new Error('sector leaders fallback is incomplete')
if (sector.events.catalysts.length < 1 || sector.events.risks.length < 1) throw new Error('sector event/risk fallback is incomplete')
if (sector.drivers.length < 3) throw new Error('sector drivers fallback is incomplete')
if (sector.capital_flow.trend.dates.length !== 1 || sector.capital_flow.trend.values[0] !== 100000000) throw new Error('sector fund-flow chart must receive verified dated series')
if (sector.capital_flow.snapshot.metrics.length < 1) throw new Error('sector capital fallback is incomplete')
if (sector.structure.breadth.up_count !== 1 || sector.leaders.items[0].return_1d !== '+2.10%') throw new Error('grouped sector member quote was not inherited/joined')

const rendered = await renderReportTemplate('sector_analysis', context, [], [])
if (rendered.includes('{{')) throw new Error('rendered sector report still contains template markers')
for (const marker of ['板块逻辑与验证情况', '价格体系 / 盈利与财务 / 估值与预期', '关键样本（核心股票）', '板块新闻与公告']) {
  if (!rendered.includes(marker)) throw new Error(`missing rendered section: ${marker}`)
}

// Missing analysis stays explicit while factual modules retain their data.
const emptyLlm = {
  async *stream() {
    const text = JSON.stringify({ report: { summary: { headline: 'AI', body: 'AI' }, performance: { initial_caption: 'AI' }, industry_chain: { thesis: 'AI' }, conclusion: { body: 'AI' }, drivers: [], events: [] } })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const merged = await generateTemplateReport(emptyLlm, 'sector_analysis', facts, { provider: 'fake', model: 'fake', maxAttempts: 1 }, new AbortController().signal)
if (!merged.used || merged.context.report.overview_analysis.status !== 'unavailable' || !merged.context.report.validation.items[0].description.includes('AI 分析未生成') || merged.context.report.leaders.items.length < 1) throw new Error('LLM patch erased deterministic sector modules')

const holding = fallbackContext({ ...base, reportType: 'holding_analysis', request: { reportType: 'holding_analysis', holdings: [{ symbol: '300750', name: '宁德时代', quantity: 10, costPrice: 100 }] }, snapshots: [{ symbol: '300750', name: '宁德时代', quote: { close: 120, industry: '电池' }, ohlcv: [{ date: '2026-09-01', close: 105 }, { date: '2026-09-02', close: 120 }], financial: null, valuation: null, announcements: [], research: [], provenance: [], dataGaps: [], warnings: [], permissions: [] }] }).report
for (const key of ['treemap', 'performance_attribution', 'exposure_sections', 'risk_bubbles', 'risks', 'top_focus', 'watchlist']) if (!Array.isArray(holding[key]) || holding[key].length === 0) throw new Error(`holding fallback missing ${key}`)
if (holding.risk_bubbles.some(item => Number(item.x) > 1 || Number(item.y) > 1)) throw new Error('holding risk bubbles must use normalized coordinates')

const market = fallbackContext({ ...base, reportType: 'market_commentary', request: { reportType: 'market_commentary', phase: 'midday' }, market: [{ up_count: 10, down_count: 8, flat_count: 2, limit_up_count: 2, limit_down_count: 1 }, { etf_code: '510300', etf_name: '沪深300ETF', change_rate: 1.2 }], sectors: [{ name: '半导体', change_rate: 2.5 }], flows: [{ stock_code: '300750', stock_name: '宁德时代', main_net: 100000000 }] })
const sectorChart = JSON.parse(market.sector_chart_json)
const capitalChart = JSON.parse(market.capital_chart_json)
if (!Array.isArray(sectorChart.names) || !Array.isArray(sectorChart.values)) throw new Error('market sector chart contract is incomplete')
if (!Array.isArray(capitalChart.names) || !Array.isArray(capitalChart.values)) throw new Error('market capital chart contract is incomplete')

const missingNumericMarket = fallbackContext({ ...base, reportType: 'market_commentary', request: { reportType: 'market_commentary' }, market: [{ etf_code: '510300', etf_name: '缺少日涨跌' }], sectors: [{ name: '缺少涨跌幅' }], flows: [{ stock_code: '000001', stock_name: '缺少资金字段' }] })
if (missingNumericMarket.etf_chart_json.includes('"day":0') || missingNumericMarket.capital_chart_json.includes('"value":0') || missingNumericMarket.sector_chart_json.includes('"values":[0]')) throw new Error('missing market numerics were coerced to zero')

const missingNumericPortfolio = fallbackContext({ ...base, reportType: 'portfolio_stocks', request: { reportType: 'portfolio_stocks', holdings: [{ symbol: '000001', name: '缺少行情' }] } })
const missingPortfolioRow = missingNumericPortfolio.portfolio?.[0]
if (missingPortfolioRow?.fundamental?.price !== null || missingPortfolioRow?.fundamental?.turnover_rate !== null || missingPortfolioRow?.fundamental?.float_a_market_cap !== null) throw new Error('missing portfolio numerics were coerced to zero')

const limit = fallbackContext({ ...base, reportType: 'limit_up_attribution', request: { reportType: 'limit_up_attribution' }, limits: [{ stock_code: '300750', stock_name: '宁德时代', status: 'limit_up', change_rate: 10 }] }).view
if (!Array.isArray(limit.cases) || limit.cases.length !== 1 || !limit.cases[0].core_reason) throw new Error('limit-up fallback is incomplete')

const review = fallbackContext({ ...base, reportType: 'review', request: { reportType: 'review', itemType: 'stock', holdings: [{ symbol: '300750', name: '宁德时代' }] }, snapshots: [{ symbol: '300750', name: '宁德时代', ohlcv: [{ date: '2026-09-01', close: 100 }, { date: '2026-09-02', close: 110 }], quote: null, financial: null, valuation: null, announcements: [], research: [], provenance: [], dataGaps: [], warnings: [], permissions: [] }] }).report
if (!Array.isArray(review.items) || review.items.length !== 1 || !review.llm.summary) throw new Error('review fallback is incomplete')

// Every report surface must keep implementation diagnostics out of the HTML,
// including when an older caller still passes the legacy wording verbatim.
const legacyMarkers = ['数据不足', 'LLM 未生成', '工具调用失败', '未获得结构化', '数据暂不可用', 'FTShare 未提供']
const deepHtml = await renderReportHtml({
  base_data: { date: base.asOf, stock: { name: '测试标的', symbol_id: '000001', price: null } },
  llm_content: null,
  quant_data: { financial: null, valuation: null, announcements: [], research: [] },
  kline_data: [],
  kline_indicator_data: { latestClose: null, ema5: null, ema10: null, ema20: null, boll: { upper: null, middle: null, lower: null }, macd: { dif: null, dea: null, histogram: null }, rsi14: null, kdj: { k: null, d: null, j: null }, volumeRatio5To20: null, coverage: { requestedPoints: 0, receivedPoints: 0, complete: false }, methodology: 'test' },
  t0_data: null,
  data_gaps: ['FTShare 工具调用失败：ft_v2_stock_list_filter', 'FTShare 未提供行业字段', 'LLM 未生成（仅 FTShare 数据）'],
  provenance: [],
  llm_meta: { attempted: true, used: false, rounds: 0, provider: 'test', model: 'test' },
}, [])
const renderedSurfaces = { deep_read: deepHtml }
for (const reportType of ['holding_analysis', 'limit_up_attribution', 'market_commentary', 'portfolio_etfs', 'portfolio_stocks', 'review', 'sector_analysis']) {
  renderedSurfaces[reportType] = await renderReportTemplate(reportType, fallbackContext({ ...base, reportType, request: { reportType }, dataGaps: ['FTShare 工具调用失败：ft_test', 'FTShare 未提供行业字段', '数据不足'] }), [], ['FTShare 工具调用失败：ft_test', 'FTShare 未提供行业字段', '数据不足'])
}
for (const [reportType, html] of Object.entries(renderedSurfaces)) {
  for (const marker of legacyMarkers) if (html.includes(marker)) throw new Error(`${reportType} rendered legacy marker: ${marker}`)
}

console.log('report-completeness: ok')

// A later new high must not move the peak date of an earlier maximum drawdown.
const regressionFacts = { ...base, reportType: 'holding_analysis', request: { reportType: 'holding_analysis', holdings: [{symbol:'TEST',weight:1}] }, snapshots: [{symbol:'TEST',name:'Test',quote:null,ohlcv:[100,120,90,150,140].map((close,i)=>({date:`2026-09-0${i+1}`,close})),financial:null,valuation:null,announcements:[],research:[],provenance:[],dataGaps:[],warnings:[],permissions:[]}] }
const regressionHolding = fallbackContext(regressionFacts).report
if (regressionHolding.drawdown.peak_date !== '2026-09-02' || regressionHolding.drawdown.trough_date !== '2026-09-03' || Math.abs(regressionHolding.drawdown.portfolio_drawdown + 0.25) > 1e-9) throw new Error('maximum drawdown interval or peak-relative return is incorrect')
const regressionHtml = await renderReportTemplate('holding_analysis', {report:regressionHolding})
if (/沪深基准[\s\S]{0,150}>0%/.test(regressionHtml)) throw new Error('missing benchmark was displayed as zero')
const boundedReview = fallbackContext({...regressionFacts,reportType:'review',request:{reportType:'review',startDate:'2026-09-02',endDate:'2026-09-03'}}).report.items[0]
if (boundedReview.cumulative_returns.dates.length !== 2 || Math.abs(boundedReview.metrics.total_return + 0.25) > 1e-9) throw new Error('review ignored requested date range')
console.log('live-web regressions: ok')

const precisionHtml = await renderReportTemplate('holding_analysis', {report:{...regressionHolding, return_curve:{...regressionHolding.return_curve, portfolio_return:0.125}}})
if (!precisionHtml.includes('+12.5%')) throw new Error('named precision argument was ignored by round filter')
console.log('numeric display precision: ok')

// The mini charts must distinguish a genuine zero from an unavailable field.
const { readFile } = await import('node:fs/promises')
const { runInNewContext } = await import('node:vm')
const deepTemplate = await readFile(new URL('../resources/templates/deep_read_report.html', import.meta.url), 'utf8')
const betaNumberSource = deepTemplate.match(/function betaNumber\(value\) \{[\s\S]*?\n        \}/)?.[0]
if (!betaNumberSource) throw new Error('mini chart numeric parser missing')
const parseMiniNumber = runInNewContext('(' + betaNumberSource + ')')
for (const value of [null, undefined, '', ' ', 'invalid', Infinity]) if (parseMiniNumber(value) !== null) throw new Error('mini chart missing value was coerced to zero')
if (parseMiniNumber(0) !== 0 || parseMiniNumber('1.25') !== 1.25) throw new Error('mini chart numeric facts lost')
console.log('mini chart missing values: ok')

// Child directions use explicit SW membership and same-date member returns.
const dates = Array.from({length:21},(_,i)=>`202608${String(i+1).padStart(2,'0')}`)
const detailed = fallbackContext({...facts,asOf:'2026-08-21',sectors:dates.map((date,i)=>({date,open:100+i,high:102+i,low:99+i,close:100+i,volume:100})),constituents:[{code:'688001',name:'A'},{code:'688002',name:'B'},{code:'688003',name:'C'}],raw:{sector_classifications:[{stockCode:'688001',swLevel3Code:'850811.SI',swLevel3Name:'设计'},{stockCode:'688002',swLevel3Code:'850811.SI',swLevel3Name:'设计'}],sector_member_history:dates.flatMap((date,i)=>[{symbol:'688001.SH',date,close:100+i,volume:100},{symbol:'688002.SH',date,close:100-i,volume:100}]),sector_member_quotes:{data:[{symbol:'688003',date:'20260820',pct_change:15}]}}}).report
if(detailed.structure.subsectors.length!==2 || detailed.structure.subsectors[0].name!=='设计' || detailed.structure.subsectors[0].return_20d!=='+0.00%' || detailed.structure.subsectors[0].median_return!=='+0.00%') throw Error('Subdirection classification or 20-day aggregation failed')
if(detailed.structure.breadth.up_count!==1 || detailed.structure.breadth.down_count!==1 || !detailed.structure.breadth.caption.includes('2/3') || !detailed.structure.breadth.judgement.includes('不代表全板块')) throw Error('Partial or stale breadth was presented as whole-sector breadth')
if(typeof detailed.structure.breadth.limit_up_count==='number' || detailed.performance.phase.steps.some(x=>x.label==='数据接入')) throw Error('Fabricated limit counts or progress placeholder')
console.log('sector child directions, common date, coverage and phase evidence: ok')

const flowReport=structuredClone(context)
flowReport.report.capital_flow.trend={dates:Array.from({length:20},(_,i)=>20260801+i),values:Array.from({length:20},(_,i)=>i+1),summary_metrics:[]}
flowReport.report.capital_flow.joint_reading.horizons=[{label:'错误模型数值',value:999}]
const flowHtml=await renderReportTemplate('sector_analysis',flowReport,[])
if(!flowHtml.includes('近5期累计') || !flowHtml.includes('+90') || !flowHtml.includes('近20期累计') || !flowHtml.includes('+210') || flowHtml.includes('错误模型数值')) throw Error('Fund-flow period totals must derive from chart series')
console.log('fund-flow period totals and model-value isolation: ok')

// A positive daily return alone is not a confirmed limit-up event.
const positiveEvent = fallbackContext({...base, reportType:'limit_up_attribution', limits:[{stock_code:'000001',change_rate:2,turnover:123456}]}).view.cases[0]
if (positiveEvent.status_label === '涨停' || positiveEvent.turnover_rate === '123456') throw new Error('limit event status or turnover unit inferred incorrectly')
const mixedReview = fallbackContext({...base,reportType:'review',request:{holdings:[{symbol:'000001'},{symbol:'000002'},{symbol:'000003'}]},snapshots:[{symbol:'000001',ohlcv:[{date:'20260901',close:100},{date:'20260902',close:90}]},{symbol:'000002',ohlcv:[{date:'20260901',close:100},{date:'20260902',close:100}]}]}).report.summary
if (mixedReview.success_count !== 2 || mixedReview.fail_count !== 1 || mixedReview.win_rate !== 0) throw new Error('losses, flat returns and missing data must be counted separately')

// A resolved numeric board code must not discard a name-only sector request.
const powerByName = fallbackContext({ ...base, reportType: 'sector_analysis', asOf: '2026-09-08',
  request: { reportType: 'sector_analysis', sectorName: '电力' },
  sectors: [
    { board_code: '881145', board_name: '电力', date: '20260904', open: 100, high: 110, low: 95, close: 100, volume: 1000 },
    { board_code: '881145', board_name: '电力', date: '20260907', open: 100, high: 110, low: 95, close: 105, volume: 1200 },
    { board_code: '999999', board_name: '电力设备', date: '20260908', open: 999, high: 999, low: 999, close: 999, volume: 999 },
  ],
}).report
if (powerByName.performance.sector_kline.trade_date.length !== 2 || powerByName.performance.sector_kline.ohlc[1][3] !== 105) throw new Error('Name-only sector discarded resolved candles or included a different sector')
console.log('name-only power sector resolution: ok')

if (!sector.events.risks.find(item => item.title === '成分行情').description.includes('1/1')) throw new Error('Member risk text must use actual coverage rather than a fixed incomplete warning')
