import assert from 'node:assert/strict'
import {loadReportFacts} from '../lib/report-data.js'
import {available, fakeFtshare} from './fake-ftshare.mjs'
const members=Array.from({length:65},(_,i)=>({con_code:String(600000+i),con_name:`成员${i}`}))
const calls=[]
const unexpected=[]
const service=fakeFtshare((tool,args)=>{
 calls.push({tool,args})
 if(tool==='ft_v1_ths_board_list')return available([{code:'881121',name:'半导体',module:'industry'}])
 if(tool==='ft_v1_sw_industry_overview')return available([{industryName:'半导体',industryCode:'801081.SI',ttmPe:20}])
 if(tool==='ft_v1_ths_board_kline')return available([{date:'20260904',open:100,high:101,low:99,close:100}])
 if(tool==='ft_v1_tdx_board_members')return available(members)
 // 底座只回明细行，不再带回上游分页元数据；65 行 < page_size 100 即最后一页。
 if(tool==='ft_v1_sw_industry_constituent_history')return available(members.map(m=>({stockCode:m.con_code,swLevel3Code:'850816.SI',swLevel3Name:'集成电路制造',inDate:'2020-01-01',outDate:null})))
 if(tool==='ft_v1_stock_candlesticks')return available([{date:'20260904',close:100,open:100,high:101,low:99,volume:50}])
 // 这些接口在本用例里不产出事实（板块流水、产业链、成员实时行情、住宅名录兜底）。
 if(['ft_v3_supply_chain_subindustry_supply_chain','ft_v1_ths_industry_daily_flow','ft_v1_eastmoney_sector_flow','ft_v4_stock_realtime_day_kline','ft_v1_company_list'].includes(tool))return available([])
 unexpected.push(tool)
 return available([])
})
const request={reportType:'sector_analysis',sectorName:'半导体',sectorCode:'BK1036'}
const config={maxKlineDays:120,announcementLookbackDays:30}
const facts=await loadReportFacts(service,request,'2026-09-07',config,new AbortController().signal)
assert.deepEqual(unexpected,[],`unexpected interfaces: ${unexpected.join(', ')}`)
assert.equal(new Set(calls.filter(x=>x.tool==='ft_v1_stock_candlesticks').map(x=>x.args.symbol)).size,65)
assert.equal(facts.raw.sector_classifications.length,65)
assert.equal(facts.raw.sector_classifications_complete,true)
assert(!calls.some(x=>x.tool==='ft_v1_company_list'&&x.args.symbols))
facts.raw.sector_member_history.pop()
calls.length=0
await loadReportFacts(service,request,'2026-09-07',config,new AbortController().signal,facts)
assert.equal(calls.filter(x=>x.tool==='ft_v1_stock_candlesticks').length,1)
assert.equal(calls.filter(x=>x.tool==='ft_v1_sw_industry_constituent_history').length,0)
console.log('full-member requests and retry only missing symbols: ok')
