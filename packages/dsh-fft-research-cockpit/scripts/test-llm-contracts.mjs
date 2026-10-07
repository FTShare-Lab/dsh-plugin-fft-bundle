import { generateTemplateReport } from '../lib/llm-report.js'

const patches = {
  holding_analysis: { report: { summary_text: 'AI 持仓总结', overall_diagnosis: { conclusion: '中性' }, exposure_analysis: { conclusion: '中性' }, drawdown_analysis: { conclusion: '数据不足' }, trade_analysis: { conclusion: '数据不足' } } },
  limit_up_attribution: { view: { hero_summary: 'AI 涨停归因摘要' } },
  market_commentary: { title: 'AI 市场点评', desc: '基于 FTShare 数据', conclusion: '中性', sector_insight: '板块观察', capital_insight: '资金观察', etf_insight: 'ETF 观察' },
  portfolio_etfs: { llm: { report_title: 'ETF 深度组合报告', theme_analysis: { text: '主题分析' }, portfolio_advantages: { highlight: '组合优势' }, risks: [{ title: '风险', description: '风险提示' }] } },
  portfolio_stocks: { llm: { report_title: '股票深度组合报告', industry_analysis: { text: '行业分析' }, portfolio_advantages: { highlight: '组合优势' }, risks: [{ title: '风险', description: '风险提示' }] } },
  review: { report: { llm: { headline: '复盘分析', summary: 'AI 复盘摘要', insights: [{ title: '洞察', detail: '依据输入事实' }], data_boundary: '数据边界' } } },
  sector_analysis: { report: { summary: { headline: '行业分析', body: 'AI 板块摘要' }, performance: { initial_caption: 'AI 行情说明' }, industry_chain: { thesis: 'AI 产业链判断' }, conclusion: { body: 'AI 综合结论' } } },
}

const overview = {
  core_logic: [
    {title:'趋势逻辑',description:'价格与均线结构影响趋势延续性。',watch:'观察价格是否站稳均线。',evidence_ids:['price']},
    {title:'参与结构',description:'上涨参与程度决定反弹是否集中。',watch:'观察上涨比例变化。',evidence_ids:['breadth']},
  ],
  major_risks: [
    {title:'资金反复',description:'资金连续性不足可能削弱价格修复。',watch:'观察后续资金方向。',evidence_ids:['flows']},
    {title:'分化风险',description:'细分板块分化可能降低行情持续性。',watch:'观察弱势子行业能否改善。',evidence_ids:['subsectors']},
  ],
}
patches.sector_analysis.report.overview_analysis = structuredClone(overview)

const llm = {
  async *stream({ messages }) {
    const prompt = messages?.[0]?.content?.[0]?.text ?? ''
    const reportType = Object.keys(patches).find(type => prompt.includes(`为 ${type} 报告`))
    const text = JSON.stringify(prompt.includes('这是独立任务') ? patches.sector_analysis.report.overview_analysis : patches[reportType])
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const base = { asOf: '2026-09-03', request: {}, snapshots: [], market: [], indices: [], sectors: [], constituents: [], flows: [], limits: [], announcements: [], news: [], raw: {}, provenance: [], permissions: [], dataGaps: [], warnings: [] }
for (const reportType of Object.keys(patches)) {
  const result = await generateTemplateReport(llm, reportType, { ...base, reportType, request: { reportType } }, { provider: 'fake', model: 'fake', maxAttempts: 1 }, new AbortController().signal)
  if (!result.used) throw new Error(`${reportType} LLM contract failed: ${result.error ?? 'unknown error'}`)
  console.log(`${reportType}: ok`)
}

patches.sector_analysis.report.summary.body = '主力净流出12亿元，散户承接'
patches.sector_analysis.report.key_metrics = [{label:'伪造价格',value:'999'}]
patches.sector_analysis.report.performance.kline_summary = {ma20_distance:'估算上涨999%'}
patches.sector_analysis.report.performance.sector_kline = {trade_date:[20260903],ohlc:[[999,999,999,999]],amount:[999]}
patches.sector_analysis.report.capital_flow = {trend:{dates:[20260903],values:[999]}}
const guardedSector = await generateTemplateReport(llm, 'sector_analysis', {...base,reportType:'sector_analysis',request:{reportType:'sector_analysis',sectorName:'半导体'},sectors:[{date:'20260903',open:100,high:110,low:99,close:108,volume:1000}],flows:[{trade_date:'20260903',main_net:-12}]}, {provider:'fake',model:'fake',maxAttempts:1}, new AbortController().signal)
if(guardedSector.context.report.performance.sector_kline.ohlc[0][3] !== 108 || guardedSector.context.report.capital_flow.trend.values[0] !== -12 || guardedSector.context.report.key_metrics[0].value !== '108.000') throw new Error('LLM overwrote factual sector data')
console.log('sector numeric facts resist LLM replacement: ok')

if (/亿元|散户/.test(guardedSector.context.report.summary.body)) throw new Error('Unverified units or investor identities leaked into commentary')
console.log('sector commentary rejects undocumented units and investor identities: ok')

if (guardedSector.context.report.performance.kline_summary.ma20_distance.includes('999')) throw new Error('LLM overwrote computed MA20 distance')

if (guardedSector.context.report.overview_analysis.status !== 'generated') throw new Error('Real LLM overview was not propagated')
if (!guardedSector.context.report.overview_analysis.core_logic[0].evidence[0].includes('108.000')) throw new Error('Overview evidence was not hydrated from trusted facts')
patches.sector_analysis.report.overview_analysis.core_logic[0].evidence_ids = ['invented_source']
const invalidOverview = await generateTemplateReport(llm, 'sector_analysis', {...base,reportType:'sector_analysis',request:{reportType:'sector_analysis'}}, {provider:'fake',model:'fake',maxAttempts:1}, new AbortController().signal)
if(invalidOverview.context.report.overview_analysis.status !== 'unavailable' || invalidOverview.context.report.overview_analysis.core_logic.length) throw new Error('Invalid overview silently became generated analysis')
patches.sector_analysis.report.overview_analysis = structuredClone(overview)
patches.sector_analysis.report.overview_analysis.core_logic[0].description = '机构资金流入12亿元'
const strippedOverview = await generateTemplateReport(llm, 'sector_analysis', {...base,reportType:'sector_analysis',request:{reportType:'sector_analysis'}}, {provider:'fake',model:'fake',maxAttempts:1}, new AbortController().signal)
if(strippedOverview.context.report.overview_analysis.status === 'generated') throw new Error('Post-sanitization missing analysis must be retried, not merged with fallback')
console.log('LLM overview propagation, evidence binding and explicit failure: ok')
const { renderReportTemplate } = await import('../lib/html-renderer.js')
const generatedHtml = await renderReportTemplate('sector_analysis', guardedSector.context, [])
const overviewHtml = generatedHtml.split('<div class="nova-insights"')[1]?.split('<div class="nova-ai">')[0] || ''
if (!overviewHtml.includes('趋势逻辑') || !overviewHtml.includes('事实依据与验证条件') || overviewHtml.includes('继续观察板块趋势与成交量变化')) throw new Error('Overview template still uses deterministic placeholder lists')
const unavailableHtml = await renderReportTemplate('sector_analysis', invalidOverview.context, [])
const unavailableOverview = unavailableHtml.split('<div class="nova-insights"')[1]?.split('<div class="nova-ai">')[0] || ''
if (!unavailableOverview.includes('本次 AI 分析未生成') || unavailableOverview.includes('数据覆盖边界')) throw new Error('Failed LLM analysis must not display data diagnostics as investment risks')
console.log('Overview rendering uses model output and explicit missing-analysis state: ok')
let independentCalls = 0
const independentLlm = { async *stream({messages}) {
  const prompt = messages[0].content[0].text
  const independent = prompt.includes('这是独立任务')
  independentCalls += independent ? 1 : 0
  const text = JSON.stringify(independent ? overview : {})
  yield {type:'block-start',index:0,blockType:'text'}
  yield {type:'text-delta',index:0,text}
  yield {type:'block-end',index:0,block:{type:'text',text}}
  yield {type:'finish',reason:{kind:'stop'}}
} }
const recovered = await generateTemplateReport(independentLlm,'sector_analysis',{...base,reportType:'sector_analysis',request:{reportType:'sector_analysis',sectorName:'电力'}},{provider:'fake',model:'fake',maxAttempts:1},new AbortController().signal)
if(independentCalls !== 1 || !recovered.used || recovered.context.report.overview_analysis.status !== 'generated') throw new Error('Independent overview must survive full-report generation failure')
console.log('Independent LLM homepage recovery: ok')
patches.sector_analysis.report.overview_analysis = structuredClone(overview)
patches.sector_analysis.report.overview_analysis.core_logic[0].description = '板块价格涨至987654.32。'
const inventedNumber = await generateTemplateReport(llm, 'sector_analysis', {...base,reportType:'sector_analysis',request:{reportType:'sector_analysis',sectorName:'电力'}}, {provider:'fake',model:'fake',maxAttempts:1}, new AbortController().signal)
if(inventedNumber.context.report.overview_analysis.status !== 'unavailable' || !inventedNumber.error.includes('987654.32')) throw new Error('Unsupported numbers must be rejected with actionable repair feedback')
console.log('Overview rejects unsupported numbers with repair feedback: ok')
patches.sector_analysis.report.overview_analysis = structuredClone(overview)
for (const key of ['core_logic','major_risks']) patches.sector_analysis.report.overview_analysis[key].push({title:'无依据持仓判断',description:'订单流出说明已经减仓。',watch:'观察资金变化',evidence_ids:['flows']})
const partialOverview = await generateTemplateReport(llm, 'sector_analysis', {...base,reportType:'sector_analysis',request:{reportType:'sector_analysis',sectorName:'电力'}}, {provider:'fake',model:'fake',maxAttempts:1}, new AbortController().signal)
if(partialOverview.context.report.overview_analysis.status !== 'generated' || partialOverview.context.report.overview_analysis.core_logic.length !== 2 || partialOverview.context.report.overview_analysis.major_risks.length !== 2 || partialOverview.context.report.overview_analysis.core_logic[0].description !== overview.core_logic[0].description) throw new Error('Valid model items must survive independently, without rewriting or filling invalid claims')
console.log('Overview preserves valid model items without inventing replacements: ok')
