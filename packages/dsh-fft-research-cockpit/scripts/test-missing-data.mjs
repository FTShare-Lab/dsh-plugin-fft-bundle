import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fallbackContext } from '../lib/llm-report.js'
import { renderReportHtml, renderReportTemplate } from '../lib/html-renderer.js'
import { permissionNoticesFromPayload } from '../lib/ftshare-client.js'

const base = {
  asOf: '2026-09-03', request: { reportType: 'portfolio_stocks', holdings: [{ symbol: '300750', name: '有数据股票' }, { symbol: '000001', name: '缺数据股票' }] },
  snapshots: [{ symbol: '300750', name: '有数据股票', quote: { name: '有数据股票', close: 100, turnover: 1 }, ohlcv: [{ date: '2026-09-02', open: 99, high: 101, low: 98, close: 100, volume: 1000 }], financial: null, valuation: null, announcements: [], research: [], provenance: [], dataGaps: [], warnings: [], permissions: [], blockedPermissions: [] }],
  market: [], indices: [], sectors: [], constituents: [], flows: [], limits: [], announcements: [], news: [], raw: {}, provenance: [], permissions: [], blockedPermissions: [{ tool: 'ft_v1_stock_candlesticks', requiredPlan: 'Free', message: 'blocked', upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription' }], dataGaps: ['缺少 FTShare 日线 OHLCV 数据'], warnings: [],
}

function assertMaskContract(reportType, reportHtml, selectors) {
  const selectorHtml = reportHtml.replaceAll('\\u003e', '>')
  if (!reportHtml.includes('background: rgba(78, 89, 105, 0.5)')) throw new Error(`${reportType}: 订阅遮罩未使用 50% 透明灰色背景`)
  if (!reportHtml.includes("link.textContent = '升级 FtShare 订阅'")) throw new Error(`${reportType}: 遮罩未提供统一升级入口`)
  if (!reportHtml.includes('ftshareMaskReason')) throw new Error(`${reportType}: 遮罩未统一为访问状态`)
  if (reportHtml.includes("data-gap'") || reportHtml.includes('当前数据模块暂无可核验内容') || reportHtml.includes('当前数据源未返回可核验内容')) throw new Error(`${reportType}: 遮罩仍包含数据不足分支`)
  for (const selector of selectors) {
    // A target can intentionally select a child surface (for example
    // `.metric-grid .metric`) or promote a matched child to a host card via
    // `hostSelector`. Match the selector prefix instead of requiring an
    // exact string so both forms remain covered by this contract test.
    if (!selectorHtml.includes(`"selector":"${selector}`) && !selectorHtml.includes(`"hostSelector":"${selector}`)) throw new Error(`${reportType}: 缺少数据面遮罩 ${selector}`)
  }
}

function assertNoPermissionMask(reportType, reportHtml) {
  const leaked = ['当前模块尚无可核验事实', '当前模块未接入', '当前数据源未返回', '待数据接入后更新', '数据暂未返回']
  const visibleHtml = reportHtml.replace(/<script[\s\S]*?<\/script>/gi, '')
  if (leaked.some(text => visibleHtml.includes(text))) throw new Error(`${reportType}: 不可用占位文案仍泄漏`)
}

const permission = (tool, requiredPlan = 'Basic') => ({
  tool,
  requiredPlan,
  message: `${tool} permission denied`,
  upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription',
})

const marketBase = {
  ...base,
  reportType: 'market_commentary',
  request: { reportType: 'market_commentary', phase: 'midday' },
  snapshots: [],
  market: [],
  blockedPermissions: [],
  dataGaps: [
    'FTShare 数据为空：ft_v1_daec_market_snapshot',
    'FTShare 数据为空：ft_v1_stock_capital_flows',
  ],
}
const marketHtml = await renderReportTemplate('market_commentary', fallbackContext(marketBase), [], marketBase.dataGaps)
assertNoPermissionMask('market_commentary', marketHtml)
await writeFile(join(tmpdir(), 'ftshare-data-gap-market-commentary.html'), marketHtml)

const sectorBase = {
  ...base,
  reportType: 'sector_analysis',
  request: { reportType: 'sector_analysis', sectorCode: 'BK1036', sectorName: '半导体' },
  snapshots: [],
  sectors: [],
  blockedPermissions: [],
  dataGaps: ['板块部分字段待解锁'],
}
const sectorHtml = await renderReportTemplate('sector_analysis', fallbackContext(sectorBase), [], sectorBase.dataGaps)
assertNoPermissionMask('sector_analysis', sectorHtml)
if (sectorHtml.includes('<span>成分股：数据不足') || sectorHtml.includes('<p class="industry-chain-boundary"><strong>数据说明：</strong>数据不足')) throw new Error('板块报告仍直接渲染缺失元数据文案')
await writeFile(join(tmpdir(), 'ftshare-data-gap-sector-analysis.html'), sectorHtml)

const emptyBase = { ...base, snapshots: [], blockedPermissions: [], dataGaps: ['部分字段待解锁'] }
const reportCases = [
  ['holding_analysis', { reportType: 'holding_analysis', holdings: [{ symbol: '300750', name: '宁德时代', quantity: 10, costPrice: 100 }] }],
  ['limit_up_attribution', { reportType: 'limit_up_attribution' }],
  ['portfolio_etfs', { reportType: 'portfolio_etfs', holdings: [{ symbol: '510300', name: '沪深300ETF' }] }],
  ['portfolio_stocks', { reportType: 'portfolio_stocks', holdings: [{ symbol: '300750', name: '宁德时代' }] }],
  ['review', { reportType: 'review', itemType: 'stock', holdings: [{ symbol: '300750', name: '宁德时代' }] }],
]
for (const [reportType, request] of reportCases) {
  const facts = { ...emptyBase, reportType, request }
  const reportHtml = await renderReportTemplate(reportType, fallbackContext(facts), [], facts.dataGaps)
  assertNoPermissionMask(reportType, reportHtml)
  await writeFile(join(tmpdir(), `ftshare-data-gap-${reportType}.html`), reportHtml)
}

const emptyTechnical = {
  latestClose: null,
  ema5: null,
  ema10: null,
  ema20: null,
  boll: { upper: null, middle: null, lower: null },
  macd: { dif: null, dea: null, histogram: null },
  rsi14: null,
  kdj: { k: null, d: null, j: null },
  volumeRatio5To20: null,
  coverage: { requestedPoints: 0, receivedPoints: 0, complete: false },
  methodology: '',
}
const deepReadModel = {
  base_data: { date: '2026-09-03', stock: { name: '宁德时代', symbol_id: '300750', price: null } },
  llm_content: null,
  quant_data: { financial: null, valuation: null, announcements: [], research: [] },
  kline_data: [],
  kline_indicator_data: emptyTechnical,
  t0_data: null,
  data_gaps: ['部分字段待解锁'],
  provenance: [],
}
const deepReadHtml = await renderReportHtml(deepReadModel)
assertNoPermissionMask('deep_read', deepReadHtml)
if (deepReadHtml.includes('ftshare-module-mask-script')) throw new Error('deep_read: 普通数据缺口不应注入订阅遮罩脚本')
if (deepReadHtml.includes('T0等级: 未覆盖')) throw new Error('deep_read: 页头仍直接显示未覆盖的 T0 元数据')
await writeFile(join(tmpdir(), 'ftshare-data-gap-deep-read.html'), deepReadHtml)

const permissionCases = [
  ['holding_analysis', reportCases[0][1], permission('ft_v1_stock_candlesticks', 'Free'), '.return-curve'],
  ['limit_up_attribution', reportCases[1][1], permission('ft_v1_limit_list', 'Free'), '.metrics-panel'],
  ['market_commentary', marketBase.request, permission('ft_v1_daec_market_snapshot', 'Free'), '.dashboard-grid > article.card:first-child'],
  ['portfolio_etfs', reportCases[2][1], permission('ft_v2_etf_description_all'), '#summaryStocks'],
  ['portfolio_stocks', reportCases[3][1], permission('ft_v4_stock_realtime_day_kline', 'Pro'), '#summaryStocks'],
  ['review', reportCases[4][1], permission('ft_v1_stock_candlesticks', 'Free'), '#returnsChart'],
  ['sector_analysis', sectorBase.request, permission('ft_v1_ths_all_board_kline', 'Free'), '#performance .chart-grid'],
]
for (const [reportType, request, blocked, selector] of permissionCases) {
  const facts = { ...emptyBase, reportType, request, blockedPermissions: [blocked] }
  const reportHtml = await renderReportTemplate(reportType, fallbackContext(facts), [blocked], facts.dataGaps)
  assertMaskContract(reportType, reportHtml, [selector])
  await writeFile(join(tmpdir(), `ftshare-permission-${reportType}.html`), reportHtml)
}

const deepReadPermission = permission('ft_v1_stock_candlesticks', 'Free')
const deepReadPermissionHtml = await renderReportHtml(deepReadModel, [deepReadPermission])
assertMaskContract('deep_read', deepReadPermissionHtml, ['#kline-chart'])
if (deepReadPermissionHtml.includes('ftshareMaskGeneric')) throw new Error('deep_read: 不应启用通用最近卡片遮罩')
await writeFile(join(tmpdir(), 'ftshare-permission-deep-read.html'), deepReadPermissionHtml)

const deepReadRealtimeOnlyHtml = await renderReportHtml({
  ...deepReadModel,
  kline_data: [{ date: '2026-09-03', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }],
}, [permission('ft_v4_stock_realtime_day_kline', 'Pro')])
if (!deepReadRealtimeOnlyHtml.includes('ftshare-module-mask-script')) {
  throw new Error('deep_read: 实时行情限制必须保留在实时行情模块')
}

// The subscription surface must not participate in the price column layout.
if (!deepReadRealtimeOnlyHtml.includes('selector":"#report-quote-access"') ||
    !deepReadRealtimeOnlyHtml.includes('<div id="report-quote-access"></div>') ||
    deepReadRealtimeOnlyHtml.includes('grid-template-columns: minmax(0, 1fr) 280px') ||
    !deepReadRealtimeOnlyHtml.includes('最近可用报价') ||
    !deepReadRealtimeOnlyHtml.includes('总市值:')) {
  throw new Error('deep_read: 行情遮罩应使用独立横条，价格和市值必须标明正确口径')
}

const flowMetadataPayload = {
  data: [],
  metadata: {
    access: 'restricted',
    required_plan: 'Basic',
    message: 'subscription required for this endpoint',
  },
}
const flowMetadataPermissions = permissionNoticesFromPayload('ft_v1_stock_capital_flows', flowMetadataPayload)
if (flowMetadataPermissions.length !== 1 || flowMetadataPermissions[0].requiredPlan !== 'Basic') {
  throw new Error('deep_read: 空结果中的结构化权限元数据未被识别')
}
const ordinaryEmptyPayload = { data: [], metadata: { access: 'public', warnings: ['暂时无数据'] } }
if (permissionNoticesFromPayload('ft_v1_beta_snapshot', ordinaryEmptyPayload).length !== 0) {
  throw new Error('deep_read: 普通空结果被误判为订阅权限限制')
}

console.log('permission-only masks: ok')

for (const payload of [{ code: 403, message: 'Forbidden', data: [] }, { status: 'restricted', data: [] }, { permissions: [{ code: 'PERMISSION_DENIED', requiredPlan: 'Pro' }], data: [] }]) {
  if (!permissionNoticesFromPayload('ft_v4_stock_realtime_day_kline', payload).length) throw new Error('顶层权限响应未识别')
}
if (permissionNoticesFromPayload('ft_v1_beta_snapshot', { code: 'UPSTREAM_REJECTED', message: 'invalid date', data: [] }).length) throw new Error('参数错误不应触发订阅遮罩')

// Empty optional deep-read modules disappear, while zero-valued facts survive.
const optionalContext = {
  base_data: { date: '2026-09-08', stock: { name: '渲染回归样本', symbol_id: 'TEST', price: 0 } },
  llm_content: {
    industry_position: { industry_overview: '主营业务为电池制造。', market_share: '输入数据未提供市场份额数据，该字段暂无数据。', competitors: [{title:'竞争格局',description:'输入数据未提供竞争对手名单。'}] },
    valuation: { current_valuation: 'PE为0倍。', historical_percentile: '输入数据未提供历史分位数据。', peer_comparison: '无法进行横向比较，该部分暂无数据。', conclusion: '保留已返回的估值事实。' },
  },
  quant_data: { financial_indicator: {oper_revenue_ttm: 0}, valuation: {pe_ttm: 0, est_peg_fy1: 0}, beta: null, capital_flow: null, margin_detail: null },
  kline_data: {trade_dates:[],ohlc:[],volumes:[]}, kline_indicator_data: {latest:null}, t0_data: {trade_date:[],t0_po_total:[]},
}
const optionalHtml = await renderReportTemplate('deep_read', optionalContext)
const optionalBody = optionalHtml.replace(/<script[\s\S]*?<\/script>/gi, '')
for (const marker of ['T0 评估', 'T0等级', 'T0 与技术', 'id="t0-chart"', '>市场份额<', '>竞争格局<', '>历史分位<', '>同业比较<', '输入数据未提供历史分位数据', '无法进行横向比较', 'id="kline-chart"']) {
  if (optionalBody.includes(marker)) throw new Error(`empty deep-read module remains: ${marker}`)
}
if (!optionalBody.includes('data-format="yuan-to-yi">0</td>') || !optionalBody.includes('主营业务为电池制造。')) throw new Error('valid zero or analysis was removed')
const availableHtml = await renderReportTemplate('deep_read', {...optionalContext, llm_content: {...optionalContext.llm_content, industry_position: {industry_overview:'主营业务为电池制造。', market_share:'市场份额为20%。', competitors:[{title:'企业甲',description:'企业甲市场份额为10%。'}]}, valuation:{...optionalContext.llm_content.valuation, historical_percentile:'历史分位为30%。',peer_comparison:'同行PE为10倍。'}}})
for (const text of ['市场份额为20%', '企业甲市场份额为10%', '历史分位为30%', '同行PE为10倍']) if (!availableHtml.includes(text)) throw new Error(`available analysis removed: ${text}`)
console.log('deep-read optional modules and zero values: ok')

// Retained workpapers remain visible; the user removed the empty Beta table.
if (optionalBody.includes('id="quant-risk-table"')) throw new Error('removed Beta table reappeared')
for (const id of ['quant-financial-chart','quant-profitability-chart','quant-valuation-chart','quant-flow-chart','quant-risk-chart','quant-financial-table','quant-valuation-table','quant-flow-table']) {
  if (!optionalBody.includes(`id="${id}"`)) throw new Error(`quantitative workpaper removed: ${id}`)
}
const quantFactsHtml = await renderReportTemplate('deep_read', {...optionalContext, quant_data: {...optionalContext.quant_data, financial_indicator:{oper_revenue_ttm:276916580000,net_profit_ttm:47030638000,cfo_ttm:60216851000},valuation:{pe_ttm:18.95,pb:4.25,est_peg_fy1:0.396}}})
for (const value of ['276916580000','47030638000','60216851000','18.95','4.25','0.396']) if (!quantFactsHtml.replace(/<script[\s\S]*?<\/script>/gi,'').includes(value)) throw new Error(`quantitative fact missing: ${value}`)
console.log('complete quantitative workpaper and available facts: ok')
