import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    function ReportResultCard(')
const end = source.indexOf('    function ReportView(', start)
let states = [], cursor = 0
const opened = []
const context = vm.createContext({
  React: {
    useState: initial => {
      const slot = cursor++
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
    },
    useEffect: () => {},
    createElement: (tag, props, ...children) => ({ tag, props, children: children.flat() }),
  },
  toolNameOf: block => block.name,
  FullReportFrame: 'FullReportFrame', ReportDocumentFrame: 'ReportDocumentFrame',
  IconCloseOutline16: 'Close', IconFullscreenOutline16: 'Fullscreen',
  REPORT_TYPE_LABELS: {},
})
const mount = vm.runInContext(source.slice(start, end) + '\nReportResultCard', context)
const reports = [
  { callId: 'a', block: { name: 'sector' }, report: { html: '<p>A</p>' } },
  { callId: 'b', block: { name: 'deep_read' }, report: { html: '<p>B</p>' } },
]
context.reportEntryLabel = entry => entry.callId
const render = openDetails => { cursor = 0; return mount({ reports, openDetails }) }
const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : []
const button = (tree, label) => all(tree).find(node => node.tag === 'button' && node.children.includes(label))
const openDetails = (...args) => opened.push(args)
let tree = render(openDetails)
button(tree, '右侧展开').props.onClick()
assert.deepEqual(opened, [['b', 'deep_read']])
assert.equal(all(render(openDetails)).some(node => node.props?.role === 'dialog'), false)
all(tree).find(node => node.props?.['aria-label'] === '选择报告预览').props.onChange({ target: { value: 'a' } })
tree = render(openDetails)
button(tree, '右侧展开').props.onClick()
assert.deepEqual(opened[1], ['a', 'sector'])
button(tree, '独立放大').props.onClick()
assert.equal(all(render(openDetails)).some(node => node.props?.role === 'dialog'), true)
states = []
assert.equal(button(render(undefined), '右侧展开').props.disabled, true)
console.log('Host sidebar: selected report routed to host; no sidebar overlay; independent enlargement and unsupported-host state passed')

// Native DSH details must never substitute for the FFT Sidebar child-plugin contract.
context.reportEntriesOf = () => reports
const renderResult = vm.runInContext(source.slice(source.indexOf('    function ReportResult(props)'), end) + '\nReportResult', context)
const nativeOpen = () => { throw new Error('Native sidebar must not be used') }
const fftOpen = () => {}
const props = { turn: {turn:1}, useChat: select => select({locations:{getTurn:()=>[]},nodes:new Map()}), openDetails:nativeOpen }
assert.equal(renderResult(props).props.openDetails,undefined)
assert.equal(renderResult({...props,openReportSidebar:fftOpen}).props.openDetails,fftOpen)
assert.ok(source.includes("const inject = ['slots', 'layout', 'betterSidebar', 'uiConversation']"))
console.log('FFT-only routing and required client dependency passed')
