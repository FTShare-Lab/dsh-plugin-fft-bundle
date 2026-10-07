import assert from 'node:assert/strict'
import { renderReportHtml } from '../lib/html-renderer.js'
import { calculateTechnicalSignals } from '../lib/indicators.js'
const period = { year: 2026, report_type: 'q2', report_form_type: '合并未调整' }
const model = {
 base_data: {date:'2026-09-09',stock:{name:'测试',symbol_id:'000001',price:10}}, llm_content:null,
 quant_data: {
  financial: {income:[{...period,t_revenue:1000,cost:600,n_profit:100,parcomp_n_profit:80,parcomp_n_profit_yoy:20,n_profit_yoy:30}],
   cashflow:[{year:2026,report_type:'q2',detail_report_type:'合并未调整',net_oper_cash_flow:120}],
   balance:[{...period,t_equity:600},{...period,year:2025,report_type:'annual',t_equity:400}]},
  valuation:{trade_date:'2026-09-08',free_shares_a:10000},capitalFlow:{trade_date:'2026-09-08',main_net_val:-100,huge_net_val:0,large_net_val:-100,medium_net_val:50,small_net_val:50},announcements:[],research:[]
 },kline_data:[{date:'2026-09-08',volume:100,close:10,open:10,high:10,low:10}],kline_indicator_data:calculateTechnicalSignals([],120),t0_data:null,data_gaps:[],provenance:[]
}
const quant = async m => JSON.parse((await renderReportHtml(m)).match(/var quantData = (.*);/)[1])
const q = await quant(model)
assert.equal(q.financial_indicator.net_profit_ttm,80)
assert.equal(q.financial_indicator.yoy_net_profit,20)
assert.equal(q.financial_indicator.cfo_ttm,120)
assert.equal(q.financial_indicator.gross_profit_margin_ttm,40)
assert.equal(q.financial_indicator.net_profit_margin_ttm,10)
assert.equal(q.financial_indicator.roe_ttm,20)
assert.equal(q.valuation.turnover,1)
assert.equal(q.valuation.free_turnover,null)
assert.equal(q.capital_flow.main_net_val,-100)
assert.equal(q.capital_flow.huge_net_val,0)
const mismatch = structuredClone(model)
mismatch.kline_data[0].date='2026-09-07'
mismatch.quant_data.financial.balance[1].year=2024
mismatch.quant_data.financial.income[0].t_revenue=0
const missing = await quant(mismatch)
assert.equal(missing.valuation.turnover,null)
assert.equal(missing.financial_indicator.roe_ttm,null)
assert.equal(missing.financial_indicator.gross_profit_margin_ttm,null)
assert.equal(missing.financial_indicator.net_profit_margin_ttm,null)
console.log('Deep-read data: ratios, reporting periods, zero denominators, same-day turnover and capital flow passed')

// Exercise the actual collector-to-template path against the gateway's schemas.
const {loadSnapshot} = await import('../lib/ftshare-data.js')
const called=[]
const session={async call(tool,args){
 called.push(tool)
 if(tool==='ft_v1_company_list')return {data:[{stock_code:'000001',stock_name:'测试'}]}
 if(tool==='ft_v1_stock_candlesticks')return {data:[{ts_millis:Date.parse('2026-09-08T07:00:00Z'),open:10,high:10,low:10,close:10,volume:100}]}
 if(tool==='ft_v1_finance_income')return {data:[{...period,year:2027,publish_date:'2027-08-01',t_revenue:99999},...model.quant_data.financial.income]}
 if(tool==='ft_v1_finance_cashflow')return {data:model.quant_data.financial.cashflow}
 if(tool==='ft_v1_finance_balance')return {data:model.quant_data.financial.balance}
 if(tool==='ft_v1_eastmoney_stock_valuation')return {data:[model.quant_data.valuation]}
 if(tool==='ft_v1_eastmoney_stock_flow'){
  assert.equal(args.symbol,'000001.SZ')
  assert.ok(!('stock_code' in args))
  return {data:[{trade_date:'2026-09-08',main_net:-100,super_large_net:0,large_net:-100,medium_net:50,small_net:50}]}
 }
 if(tool==='ft_v1_margin_trading_details'){
  assert.equal(args.date,'20260908')
  return {data:[{date:'2026-09-08',symbol:'000001.SZ',margin_trading_balance:1000,total_balance:1200,margin_trading_buying_amount:100,securities_lending_selling_volume:10}]}
 }
 throw new Error(`Unexpected tool ${tool}`)
}}
const collected=await loadSnapshot(session,'000001','2026-09-08',120,new AbortController().signal,30,{includeExtendedFacts:true,includeRiskFacts:false,includeAnnouncements:false,includeResearch:false})
assert.equal(collected.financial.income[0].year,2026)
assert.equal(collected.capitalFlow.main_net_val,-100)
assert.equal(collected.marginDetail.sloan_bal,200)
assert.ok(!called.some(t=>t.includes('beta')))
const rendered=await quant({...model,quant_data:{...collected}})
assert.equal(rendered.capital_flow.main_net_val,-100)
assert.equal(rendered.margin_detail.mtss_bal,1200)
assert.equal(rendered.financial_indicator.cfo_ttm,120)
const html=await renderReportHtml(model)
assert.ok(html.includes('缺少自由流通股本'))
assert.ok(!html.includes('[object Object]'), 'Missing valuation notes must render text, not an object')
assert.ok(!html.includes('1年日 Beta'), 'Removed risk exposure must not return in new reports')
console.log('Collector-to-renderer: live schemas, disclosure cutoff, flow and margin propagation passed')
