import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
const entries = [{ callId: 'call-a', symbol: '电力', report: { html: 'private-report' }, block: {} }]
const registrations = [], opened = [], disposers = []
let descriptor, disposed = false
const sidebar = {
  registerTab: value => { descriptor = value; return () => { disposed = true } },
  isTabEnabled: () => true,
  openTab: (...args) => opened.push(args),
}
const ctx = {
  layout: { closeDetails() {} },
  inject: (_names, callback) => callback(ctx),
  effect: callback => disposers.push(callback()),
  betterSidebar: sidebar,
  uiConversation: { binding: sessionId => ({ target: () => ({getSnapshot: () => ({nodes:new Map([[sessionId, entries]])})}) }) },
  slots: { inject: (_key, callback) => callback(), register: (options, component) => { registrations.push({options,component}); return () => {} } },
}
const context = vm.createContext({
  React: { createElement: (...args) => args },
  reportEntriesOf: () => entries,
  reportEntryLabel: entry => entry.symbol,
  REPORT_TOOL_NAMES: ['generate_sector_analysis_report'], REPORT_VIEW_ID: 'reports',
  ReportRow: 'ReportRow', ReportResult: 'ReportResult', ReportView: 'ReportView', ReportDetails: 'ReportDetails',
})
const start = source.indexOf('    const FFT_REPORT_TAB =')
const end = source.indexOf('    const inject =',start)
vm.runInContext(source.slice(start,end)+'\napply',context)(ctx)
assert.equal(descriptor.id,'ft-research-cockpit:report')
const row = registrations.find(r=>r.options.name==='tool.call.toolview' && r.options.inject)
row.options.inject('session-a').openReportSidebar('call-a')
assert.equal(opened[0][0].type,descriptor.id)
assert.equal(opened[0][1].sessionId,'session-a')
assert.equal(opened[0][0].meta.callId,'call-a')
assert.equal(JSON.stringify(opened).includes('private-report'),false)
assert.equal(descriptor.dedupeKey(opened[0][0]),opened[0][0].id)
assert.throws(()=>row.options.inject('session-a').openReportSidebar('missing'),/未加载/)
sidebar.isTabEnabled=()=>false
assert.throws(()=>row.options.inject('session-a').openReportSidebar('call-a'),/启用/)
disposers.forEach(dispose=>dispose())
assert.equal(disposed,true)
console.log('FFT Better Sidebar registration, scoped openTab, reference-only metadata, disabled-tab handling and disposal passed')

context.React.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
const renderTab = vm.runInContext('FFTReportTab', context)
const tabNode = renderTab({source:{subscribe(){},getSnapshot:()=>({nodes:new Map()})},tab:{meta:{sessionId:'session-a',callId:'call-a'}},sessionId:'session-a'})
assert.equal(tabNode[1].style.overflow, undefined, 'Report child must not create a second scrollbar')
assert.equal(tabNode[1].style.height, undefined, 'Report child must expand with its content')
console.log('FFT report child uses natural height without a nested scroll container: passed')
