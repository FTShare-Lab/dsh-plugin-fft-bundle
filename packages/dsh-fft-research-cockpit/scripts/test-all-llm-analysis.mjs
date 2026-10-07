import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateTemplateReport, generateStructuredReport } from '../lib/llm-report.js'
import { calculateTechnicalSignals } from '../lib/indicators.js'
import { renderReportTemplate, renderReportHtml } from '../lib/html-renderer.js'
import { ANALYSIS_UNAVAILABLE } from '../lib/analysis-contract.js'

const base = { asOf:'2026-09-08', request:{}, snapshots:[], market:[], indices:[], sectors:[], constituents:[], flows:[], limits:[], announcements:[], news:[], raw:{}, provenance:[], permissions:[], blockedPermissions:[], dataGaps:[], warnings:[] }
const config = {provider:'fixture', model:'fixture', maxAttempts:2}
const signal = new AbortController().signal
const fill = value => Array.isArray(value) ? value.map(fill) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fill(v)])) : typeof value === 'number' ? value : '模型分析原文：现有证据支持短期结构判断，后续需验证持续性。'
function shapeFromPrompt(prompt) {
  const line = prompt.split('\n').find(line => line.startsWith('{') && line.endsWith('}') && line.includes('"..."'))
  assert.ok(line, 'A complete analysis contract must be sent to the real LLM interface')
  return JSON.parse(line)
}
function model(respond) {
  return {async *stream(options) {
    assert.equal(options.provider,'fixture'); assert.equal(options.model,'fixture')
    const output = await respond(options.messages[0].content[0].text)
    const text = JSON.stringify(output)
    yield {type:'block-start',index:0,blockType:'text'}
    yield {type:'text-delta',index:0,text}
    yield {type:'block-end',index:0,block:{type:'text',text}}
    yield {type:'finish',reason:{kind:'stop'}}
  }}
}
const overview = Object.fromEntries(['core_logic','major_risks'].map(key=>[key,Array.from({length:2},()=>({title:'模型判断',description:'价格结构仍需验证。',watch:'观察价格趋势能否延续。',evidence_ids:['price']}))]))
const complete = model(prompt=> {
  if(prompt.includes('这是独立任务')) return overview
  const patch = {...fill(shapeFromPrompt(prompt)), injected_quote:{close:999999}}
  if(patch.view?.cases) patch.view.cases[0].stock_code = '600900'
  return patch
})
const directory = new URL('../reports/all-llm-qa/',import.meta.url)
await mkdir(directory,{recursive:true})
const types = ['holding_analysis','limit_up_attribution','market_commentary','portfolio_stocks','portfolio_etfs','review','sector_analysis']
for (const reportType of types) {
  const facts = {...base,reportType,request:{reportType,sectorName:'电力'},limits:reportType === 'limit_up_attribution' ? [{stock_code:'600900',stock_name:'长江电力',close:28.5,pct_change:10,status:'limit_up'}] : []}
  const result = await generateTemplateReport(complete,reportType,facts,config,signal)
  assert.equal(result.context.analysis_meta.status,'generated',`${reportType}: ${result.error}`)
  assert.equal(result.context.injected_quote,undefined)
  const html = await renderReportTemplate(reportType,result.context,[])
  assert.ok(html.includes('模型分析原文'), `${reportType} did not render model output`)
  await writeFile(new URL(`${reportType}-fixture.html`,directory),html)
  const failure = await generateTemplateReport(model(()=>({})),reportType,facts,config,signal)
  assert.equal(failure.used,false)
  assert.equal(failure.context.analysis_meta.status,'unavailable')
  const failedHtml = await renderReportTemplate(reportType,failure.context,[])
  assert.ok(failedHtml.includes(ANALYSIS_UNAVAILABLE))
  if(reportType === 'limit_up_attribution') {
    assert.equal(failure.context.view.cases[0].close,'28.5')
    assert.equal(failure.context.view.cases[0].stock_code,'600900')
    assert.equal(failure.context.view.cases[0].core_reason,ANALYSIS_UNAVAILABLE)
  }
  console.log(`${reportType}: full contract, genuine output propagation, unavailable state, factual isolation passed`)
}

let calls = 0
const partial = await generateTemplateReport(model(prompt=>{
  calls++
  if(calls === 1) return {report:{summary_text:'第一轮已成功的真实分析'}}
  const patch=fill(shapeFromPrompt(prompt)); delete patch.report.summary_text
  return patch
}),'holding_analysis',{...base,reportType:'holding_analysis',request:{reportType:'holding_analysis'}},config,signal)
assert.equal(calls,2)
assert.equal(partial.context.report.summary_text,'第一轮已成功的真实分析')
assert.equal(partial.context.analysis_meta.status,'generated')

const snapshot = {symbol:'600900',name:'长江电力',asOf:base.asOf,quote:{close:28.5},ohlcv:[],financial:{income:[],cashflow:[]},valuation:{},announcements:[],research:[],permissions:[],blockedPermissions:[],provenance:[],dataGaps:[],warnings:[]}
const technical = calculateTechnicalSignals(snapshot.ohlcv)
const deep = await generateStructuredReport(complete,snapshot,technical,config,signal)
assert.equal(deep.analysis_meta.status,'generated')
const deepPartial = await generateStructuredReport(model(prompt=>prompt.includes('【当前生成轮次】技术面分析') ? {} : fill(shapeFromPrompt(prompt))),snapshot,technical,config,signal)
assert.equal(deepPartial.analysis_meta.status,'partial')
assert.equal(deepPartial.technical_analysis.trend,ANALYSIS_UNAVAILABLE)
assert.ok(deepPartial.investment_thesis.includes('模型分析原文'))
await writeFile(new URL('deep_read-fixture.html',directory),await renderReportHtml({base_data:{date:base.asOf,stock:{name:snapshot.name,symbol_id:snapshot.symbol,price:28.5}},llm_content:deep,quant_data:{financial:snapshot.financial,valuation:snapshot.valuation,announcements:[],research:[]},kline_data:[],kline_indicator_data:technical,t0_data:null,data_gaps:[],provenance:[]}))

const sector = await readFile(new URL('../resources/templates/sector_analysis_report.html',import.meta.url),'utf8')
const ribbons=[...sector.matchAll(/<strong>AI 解读<\/strong><p>\{\{ ([^}]+) \}\}<\/p>/g)].map(match=>match[1])
assert.equal(ribbons.length,8)
assert.ok(ribbons.every(path=>path.startsWith('report.section_analysis.')))
console.log('deep_read: five real-call contracts, partial chapter status; all eight sector AI ribbons use dedicated model fields; repair preserves prior successes')
const marketFacts={...base,reportType:'market_commentary',request:{reportType:'market_commentary'}}
const validMarketText='指数上涨2.3%，股票表现分化，成交额为1200亿元。'
const marketMixed = await generateTemplateReport(model(prompt=>({...fill(shapeFromPrompt(prompt)),desc:validMarketText,conclusion:'全市场上涨999999家。'})),'market_commentary',marketFacts,config,signal)
assert.equal(marketMixed.context.desc,validMarketText,'Prices and percentages near stock words must not be mistaken for market counts')
assert.equal(marketMixed.context.conclusion,ANALYSIS_UNAVAILABLE,'Unverified actual market counts must still be rejected')
console.log('Market guard distinguishes percentages/amounts from unsupported counts')
let syntaxCalls=0, syntaxPayload
const syntaxModel={async *stream({messages}) {
  syntaxCalls++
  const prompt=messages[0].content[0].text
  if(syntaxCalls===1) syntaxPayload=fill(shapeFromPrompt(prompt))
  else assert.ok(prompt.includes('仅修复下面 JSON 的语法错误'))
  const full=JSON.stringify(syntaxPayload)
  const text=syntaxCalls===1 ? full.slice(0,-1) : full
  yield {type:'block-start',index:0,blockType:'text'}
  yield {type:'text-delta',index:0,text}
  yield {type:'block-end',index:0,block:{type:'text',text}}
  yield {type:'finish',reason:{kind:'stop'}}
}}
const syntaxRecovered=await generateTemplateReport(syntaxModel,'review',{...base,reportType:'review',request:{reportType:'review'}},config,signal)
assert.equal(syntaxCalls,2)
assert.equal(syntaxRecovered.context.analysis_meta.status,'generated')
assert.equal(syntaxRecovered.context.report.llm.summary,syntaxPayload.report.llm.summary)
console.log('Malformed JSON receives one bounded real-model syntax repair without fixed commentary')
