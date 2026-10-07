import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Mount the host bridge with an iframe stand-in: messages from other frames
// must never initiate exports, and child-supplied document content is ignored.
const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    const ReportDocumentFrame =')
const end = source.indexOf('    function FullReportFrame', start)
const listeners = new Map()
const exports = []
let cleanup
const context = vm.createContext({
  React: {
    forwardRef: component => component,
    useRef: () => ({ current: null }),
    useEffect: effect => { cleanup = effect() },
    createElement: (tag, props) => ({ tag, props }),
  },
  window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
  downloadReport: report => exports.push(['html', report]),
  downloadPdfReport: report => exports.push(['pdf', report]),
})
const mount = vm.runInContext(source.slice(start, end) + '\nReportDocumentFrame', context)
const report = { html: '<p>trusted report</p>', filename: 'sector.html', pdfBase64: 'trusted-pdf' }
const forwarded = { current: null }
const node = mount({ report, srcDoc: report.html, sandbox: 'allow-scripts allow-popups' }, forwarded)
const frame = { contentWindow: {} }
node.props.ref(frame)
assert.equal(forwarded.current, frame)
assert.equal(node.props.sandbox, 'allow-scripts allow-popups')
assert.equal(node.props.report, undefined)
const send = (source, format, type = 'ftai-report-export') => listeners.get('message')({ source, data: { type, format, html: 'untrusted replacement' } })
send({}, 'pdf')
send(frame.contentWindow, 'javascript')
send(frame.contentWindow, 'pdf', 'unrelated-message')
assert.equal(exports.length, 0)
send(frame.contentWindow, 'html')
send(frame.contentWindow, 'pdf')
assert.deepEqual(exports, [['html', report], ['pdf', report]])
cleanup()
assert.equal(listeners.size, 0)
console.log('Report export bridge: source isolation, format allowlist, trusted payload and cleanup passed')
