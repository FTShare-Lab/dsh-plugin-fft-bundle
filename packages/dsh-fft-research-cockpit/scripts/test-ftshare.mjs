/**
 * FTShare 取数契约回归（离线）。
 *
 * 投研舱不自建客户端、不连网关：所有取数经 `ctx.ftshareData`，结局读四态。本用例
 * 用假服务覆盖四条路径，并守住那条最容易被写坏的语义 —— **`denied` 与 `empty`
 * 不可混同**：
 *
 *   * `available`：明细进快照；
 *   * `denied`  ：渲染出无权访问 + 升级入口（遮罩），且文案说明「这不代表没有数据」；
 *   * `empty`   ：才是「没有数据」，只落数据缺口，绝不出现升级入口；
 *   * `failed`  ：如实记成取数失败，可重试的失败会重试。
 */
import assert from 'node:assert/strict'

import { calculateTechnicalSignals } from '../lib/indicators.js'
import { loadSnapshot } from '../lib/ftshare-data.js'
import { loadReportFacts } from '../lib/report-data.js'
import { fallbackContext } from '../lib/llm-report.js'
import { renderReportTemplate } from '../lib/html-renderer.js'
import { available, denied, empty, failed, fakeFtshare, UPGRADE_URL } from './fake-ftshare.mjs'

const symbol = process.argv[2] || '300750'
const asOf = process.argv[3] || '2026-09-03'
const signal = new AbortController().signal
const config = { maxKlineDays: 120, announcementLookbackDays: 30 }

const kline = [
  { trade_date: '20260902', open: 100, high: 110, low: 95, close: 108, volume: 1000 },
  { trade_date: '20260903', open: 108, high: 112, low: 106, close: 111, volume: 1200 },
]

/** 一条能力一个接口：这里就是 `loadSnapshot` 会碰到的全部接口。 */
const table = {
  ft_v1_company_list: [{ stock_code: '300750', stock_name: '宁德时代', close: 120, pct_change: 2.1, industry: '电池' }],
  ft_v4_stock_realtime_day_kline: [{ symbol: '300750.SZ', items: [{ close: 120, open: 118, high: 121, low: 117, volume: 1000, trade_date: '20260903', pct_change: 2.1 }] }],
  ft_v1_stock_candlesticks: kline,
  ft_v1_finance_income: [{ year: 2026, report_type: 'q2', report_date: '20260630', revenue: 1_000_000_000, net_profit: 100_000_000 }],
  ft_v1_finance_cashflow: [{ year: 2026, report_type: 'q2', report_date: '20260630', operating_cashflow: 120_000_000 }],
  ft_v1_finance_balance: [{ year: 2026, report_type: 'q2', t_equity: 600 }],
  ft_v1_eastmoney_stock_valuation: [{ trade_date: '20260903', pe_ttm: 30, pb_mrq: 3.2 }],
  ft_v2_announcements_stock_announcements: [{ stock_code: '300750', title: '公告', published_at: '2026-09-03' }],
  ft_v2_report_stock_reports: [{ title: '研报', published_at: '2026-09-02' }],
  ft_v1_eastmoney_stock_flow: [{ trade_date: '20260903', main_net: 100, super_large_net: 0, large_net: -100 }],
  ft_v1_margin_trading_details: [{ date: '2026-09-03', symbol: '300750.SZ', margin_trading_balance: 1000, total_balance: 1200, margin_trading_buying_amount: 100, securities_lending_selling_volume: 10 }],
}

/** 一张表一个假服务；`overrides` 用来把某个接口改成 denied / empty / failed。 */
function serviceOf(overrides = {}) {
  return fakeFtshare(tool => {
    if (tool in overrides) return overrides[tool]
    return tool in table ? available(table[tool]) : empty()
  })
}

const loadOptions = { includeExtendedFacts: true }

// 1) available：明细进快照，一个缺口都没有。
const full = serviceOf()
const snapshot = await loadSnapshot(full, symbol, asOf, 120, signal, 30, loadOptions)
assert.equal(snapshot.name, '宁德时代')
assert.equal(snapshot.quote.close, 120)
assert.equal(snapshot.ohlcv.length, 2)
assert.equal(snapshot.financial.income.length, 1)
assert.equal(snapshot.financial.cashflow.length, 1)
assert.equal(snapshot.financial.balance.length, 1)
assert.equal(snapshot.valuation.pe_ttm, 30)
assert.equal(snapshot.announcements.length, 1)
assert.equal(snapshot.research.length, 1)
assert.equal(snapshot.capitalFlow.main_net_val, 100)
assert.equal(snapshot.marginDetail.mtss_bal, 1200)
assert.deepEqual(snapshot.dataGaps, [])
assert.deepEqual(snapshot.permissions, [])
assert.deepEqual(snapshot.blockedPermissions, [])
assert.equal(calculateTechnicalSignals(snapshot.ohlcv, 120).latestClose, 111)
assert(full.calls.some(call => call.tool === 'ft_v1_stock_candlesticks'))
assert(!full.calls.some(call => call.tool.includes('beta')), '风险暴露在上游没有可指接口，不得再发这样的请求')
console.log(`available: ${full.calls.length} 次取数，快照字段齐备`)

// 2) 当天取实时日线，历史取公司名录：一条能力一个接口，不再互为候选。
const today = new Date().toISOString().slice(0, 10)
const realtime = serviceOf()
await loadSnapshot(realtime, symbol, today, 120, signal, 30, loadOptions)
assert(realtime.calls.some(call => call.tool === 'ft_v4_stock_realtime_day_kline'))
assert(!realtime.calls.some(call => call.tool === 'ft_v1_company_list'))
console.log('one interface per capability: 当天只用实时日线，没有降级候选')

// 3) denied：如实上报权限，带升级入口，且说明「不是没有数据」。
const deniedService = serviceOf({ ft_v1_finance_income: denied('FTShare 无权访问 ft_v1_finance_income：当前套餐未开通该数据能力。这不代表「没有数据」。', { code: 'route_not_allowed', requiredPlan: 'Basic' }) })
const deniedSnapshot = await loadSnapshot(deniedService, symbol, asOf, 120, signal, 30, loadOptions)
assert.equal(deniedSnapshot.permissions.length, 1)
assert.equal(deniedSnapshot.blockedPermissions.length, 1)
assert.equal(deniedSnapshot.permissions[0].tool, 'ft_v1_finance_income')
assert.equal(deniedSnapshot.permissions[0].requiredPlan, 'Basic')
assert.equal(deniedSnapshot.permissions[0].upgradeUrl, UPGRADE_URL)
assert(/无权访问/.test(deniedSnapshot.permissions[0].message))
assert(deniedSnapshot.dataGaps.some(gap => gap.includes('无权访问')))
assert(!deniedSnapshot.dataGaps.some(gap => gap.includes('数据为空')), 'denied 不得被写成「没有数据」')

const deniedFacts = await loadReportFacts(serviceOf({
  ft_v1_finance_income: denied('FTShare 无权访问 ft_v1_finance_income：当前套餐未开通该数据能力。这不代表「没有数据」。', { code: 'route_not_allowed', requiredPlan: 'Basic' }),
}), { reportType: 'holding_analysis', holdings: [{ symbol }] }, asOf, config, signal)
const deniedHtml = await renderReportTemplate('holding_analysis', fallbackContext(deniedFacts), deniedFacts.blockedPermissions, deniedFacts.dataGaps)
assert(deniedHtml.includes('ftshare-module-mask-script'), 'denied 必须渲染权限遮罩')
assert(deniedHtml.includes('升级 FtShare 订阅'), 'denied 必须渲染升级入口')
assert(deniedHtml.includes(UPGRADE_URL), '遮罩必须带升级地址')
console.log('denied: 渲染出无权访问 + 升级入口')

// 4) empty：才是「没有数据」，不产生任何权限提示，也不渲染升级入口。
const emptyService = serviceOf({ ft_v1_finance_income: empty() })
const emptySnapshot = await loadSnapshot(emptyService, symbol, asOf, 120, signal, 30, loadOptions)
assert.deepEqual(emptySnapshot.permissions, [])
assert.deepEqual(emptySnapshot.blockedPermissions, [])
assert(emptySnapshot.dataGaps.includes('FTShare 数据为空：ft_v1_finance_income'))
assert(emptySnapshot.dataGaps.includes('缺少 FTShare 财务收入数据'))
assert(!emptySnapshot.dataGaps.some(gap => gap.includes('无权访问')))

const emptyFacts = await loadReportFacts(serviceOf({ ft_v1_finance_income: empty() }), { reportType: 'holding_analysis', holdings: [{ symbol }] }, asOf, config, signal)
assert.deepEqual(emptyFacts.blockedPermissions, [])
const emptyHtml = await renderReportTemplate('holding_analysis', fallbackContext(emptyFacts), emptyFacts.blockedPermissions, emptyFacts.dataGaps)
assert(!emptyHtml.includes('ftshare-module-mask-script'), 'empty 不得渲染升级遮罩')
assert(!emptyHtml.includes('升级 FtShare 订阅'), 'empty 不得出现升级入口')
console.log('empty: 只落「没有数据」缺口，没有升级入口')

// 5) failed：记成取数失败；可重试的失败按底座 notice.retryable 重试。
const failing = serviceOf({ ft_v1_finance_income: failed('FTShare ft_v1_finance_income 调用失败（upstream_error）：上游 500') })
const failedSnapshot = await loadSnapshot(failing, symbol, asOf, 120, signal, 30, loadOptions)
assert(failedSnapshot.dataGaps.includes('FTShare 工具调用失败：ft_v1_finance_income'))
assert.deepEqual(failedSnapshot.permissions, [])
assert(failedSnapshot.warnings.some(warning => warning.includes('上游 500')))

let attempts = 0
const retrying = fakeFtshare(tool => {
  if (tool !== 'ft_v1_finance_income') return tool in table ? available(table[tool]) : empty()
  attempts += 1
  return attempts === 1 ? failed('上游服务暂时不可用', { code: 'UPSTREAM_UNAVAILABLE', retryable: true }) : available(table[tool])
})
const retried = await loadSnapshot(retrying, symbol, asOf, 120, signal, 30, loadOptions)
assert.equal(attempts, 2, '可重试的失败必须重试一次并成功')
assert.equal(retried.financial.income.length, 1)
assert(!retried.dataGaps.includes('FTShare 工具调用失败：ft_v1_finance_income'))
console.log('failed: 如实上报，可重试的失败重试后成功')

console.log(`ftshare contract: ok (${symbol} @ ${asOf})`)
