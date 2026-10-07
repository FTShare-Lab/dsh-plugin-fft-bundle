import { readFile, writeFile } from 'node:fs/promises'
import { renderReportHtml } from '../lib/html-renderer.js'

const source = await readFile('reports/300750-2026-09-02-deep-read-data-only.html', 'utf8')
const match = source.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)
if (!match) throw new Error('未找到 data-only 报告数据')
function normalize(value) {
  if (typeof value === 'string') return value.replaceAll('经营现金流 TTM 为', '最新经营现金流为')
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
  return value
}
await writeFile('reports/300750-2026-09-02-deep-read.html', await renderReportHtml(normalize(JSON.parse(match[1])), []), 'utf8')
