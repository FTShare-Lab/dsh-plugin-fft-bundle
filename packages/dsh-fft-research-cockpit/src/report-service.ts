import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FtshareSettingsService } from '@ft/dsh-fft-settings/contract'

import { calculateTechnicalSignals } from './indicators.js'
import { FtShareClient } from './ftshare-client.js'
import { loadSnapshot } from './ftshare-data.js'
import { loadReportFacts, type ReportFacts } from './report-data.js'
import { renderReportHtml, renderReportTemplate, type ReportViewModel, type TemplateContext } from './html-renderer.js'
import { emptyDeepReadReport, generateStructuredReport, generateTemplateReport } from './llm-report.js'
import type { Config } from './config.js'
import type { PermissionNotice, ReportRequest, ReportToolResult, ReportType } from './types.js'

async function runChromeUntilFile(executable: string, args: string[], output: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(executable, args, { stdio: 'ignore', detached: false })
    const started = Date.now()
    const poll = () => {
      readFile(output).then(() => {
        child.kill('SIGKILL')
        resolve()
      }).catch(() => {
        if (Date.now() - started >= timeoutMs) {
          child.kill('SIGKILL')
          resolve()
        } else setTimeout(poll, 250)
      })
    }
    child.once('error', () => resolve())
    poll()
  })
}

async function measureChromeHeight(executable: string, inputUrl: string, profile: string, timeoutMs: number): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const child = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=3000', '--window-size=1440,900', `--user-data-dir=${profile}`, '--dump-dom', inputUrl], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    const started = Date.now()
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve(value)
    }
    child.once('error', () => finish(null))
    child.stdout.on('data', chunk => {
      output += String(chunk)
      const marker = 'FTAI_HEIGHT_'
      const index = output.indexOf(marker)
      if (index >= 0) {
        const digits = output.slice(index + marker.length).match(/[0-9]+/)?.[0]
        if (digits) finish(Number(digits))
      }
    })
    setTimeout(() => {
      const marker = 'FTAI_HEIGHT_'
      const index = output.indexOf(marker)
      const digits = index >= 0 ? output.slice(index + marker.length).match(/[0-9]+/)?.[0] : undefined
      finish(digits ? Number(digits) : null)
    }, Math.max(timeoutMs, Date.now() - started))
  })
}

function chromeCandidates(): string[] {
  return process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
      : ['google-chrome', 'chromium', 'chromium-browser']
}

async function renderExportArtifacts(html: string): Promise<{ pdf?: string; png?: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ftai-report-'))
  const input = join(root, 'report.html')
  const measureInput = join(root, 'measure.html')
  const pdf = join(root, 'report.pdf')
  const png = join(root, 'report.png')
  const profile = join(root, 'profile')
  await writeFile(input, html, 'utf8')
  // Tooltips are interaction-only overlays. They can be positioned outside the
  // visible report and inflate scrollHeight in headless Chrome, so exports hide
  // them while preserving the live web report unchanged.
  const exportHead = `<style id="ftai-export-chrome-overlays">.kline-chart-tooltip,.echarts-tooltip{display:none!important}@media print{[_echarts_instance_] > div{max-width:100%!important}[_echarts_instance_] canvas{max-width:100%!important}}</style>
<script id="ftai-export-print-charts">
(function () {
  function resizeCharts() {
    if (!window.echarts) return;
    document.querySelectorAll('div').forEach(function (node) {
      var chart = window.echarts.getInstanceByDom(node);
      if (chart) {
        chart.resize({ width: node.clientWidth, height: node.clientHeight, silent: true });
        chart.getZr().flush();
      }
    });
  }
  window.addEventListener('beforeprint', resizeCharts);
  // This document is export-only: keep the print-sized canvas until capture finishes.
})();
</script>`
  const exportHtml = html.replace(/<\/head>/i, exportHead + '</head>')
  await writeFile(input, exportHtml, 'utf8')
  // Keep the marker independent of FontFaceSet readiness: a remote or stalled
  // font promise must never make measurement fall back to the old 12,000px
  // canvas. Chrome lays out the local report synchronously; the short delay
  // lets charts and mutation-driven masks settle before reading the height.
  const measureScript = '<script>setTimeout(()=>{document.title="FTAI_HEIGHT_" + Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)},900)</script>'
  await writeFile(measureInput, exportHtml.replace(/<\/body>/i, `${measureScript}</body>`), 'utf8')
  const inputUrl = `file://${input.replaceAll('\\', '/')}`
  try {
    for (const executable of chromeCandidates()) {
      try {
        const common = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=3000', `--user-data-dir=${profile}`]
        await runChromeUntilFile(executable, [...common, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, inputUrl], pdf, 60_000)
        const measured = await measureChromeHeight(executable, `file://${measureInput.replaceAll('\\', '/')}`, `${profile}-measure`, 20_000)
        const screenshotHeight = Math.min(24000, Math.max(900, (measured ?? 12000) + 32))
        await runChromeUntilFile(executable, [...common, `--window-size=1440,${screenshotHeight}`, `--screenshot=${png}`, inputUrl], png, 60_000)
        const [pdfBytes, pngBytes] = await Promise.all([readFile(pdf), readFile(png)])
        return { pdf: pdfBytes.toString('base64'), png: pngBytes.toString('base64') }
      } catch {
        // Try the next installed browser candidate. Export remains optional.
      }
    }
    return {}
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

interface FtshareSettingsContext extends Context {
  ftshareSettings: FtshareSettingsService
}

function normalizeAsOf(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('asOf 必须是 YYYY-MM-DD')
  return value
}

function safeSymbol(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 48) || 'report'
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function renderableDataGaps(
  dataGaps: string[],
  permissions: PermissionNotice[],
  blockedPermissions: PermissionNotice[],
): string[] {
  const permissionKey = (item: PermissionNotice) => `${item.tool}:${item.requiredPlan}:${item.message}`
  const blockedKeys = new Set(blockedPermissions.map(permissionKey))
  const resolvedMessages = new Set(permissions.filter(item => !blockedKeys.has(permissionKey(item))).map(item => item.message))
  return dataGaps.filter(gap => !resolvedMessages.has(gap))
}

/** DSH tool outputs must be lossless JSON: omit undefined values and normalize
 * non-finite numbers / negative zero before they cross the tool boundary. */
function losslessJson(value: unknown): unknown {
  if (value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(item => losslessJson(item) ?? null)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const normalized = losslessJson(item)
      if (normalized !== undefined) output[key] = normalized
    }
    return output
  }
  return value
}

async function ftshareClient(ctx: Context, config: Config): Promise<FtShareClient> {
  const credential = await (ctx as FtshareSettingsContext).ftshareSettings.apiKey.resolve()
  return new FtShareClient(config.ftshareUrl, credential)
}

function uniqueStrings(values: string[]): string[] { return [...new Set(values.map(value => value.trim()).filter(Boolean))] }

export interface DeepReadArgs { symbol: string; asOf?: string }

export async function generateDeepReadReport(ctx: Context, args: DeepReadArgs, signal: AbortSignal, config: Config): Promise<ReportToolResult> {
  const symbol = args.symbol.trim()
  if (!symbol) throw new Error('symbol 不能为空')
  const asOf = normalizeAsOf(args.asOf)
  const client = await ftshareClient(ctx, config)
  const snapshot = await client.withSession(signal, session => loadSnapshot(
    session,
    symbol,
    asOf,
    config.maxKlineDays,
    signal,
    config.announcementLookbackDays,
    { includeExtendedFacts: true, includeRiskFacts: false },
  ))
  const technical = calculateTechnicalSignals(snapshot.ohlcv, config.maxKlineDays)
  let structuredReport = null
  let llmUsed = false
  const warnings = [...snapshot.warnings]
  const dataGaps = [...snapshot.dataGaps]
  try {
    structuredReport = await generateStructuredReport(ctx.llm, snapshot, technical, { provider: config.llmProvider, model: config.llmModel, maxAttempts: config.llmMaxAttempts }, signal)
    llmUsed = true
    if (structuredReport.analysis_meta && (structuredReport.analysis_meta as Record<string, unknown>).status !== 'generated') {
      dataGaps.push('部分 AI 分析未生成，已保留成功生成的章节')
    }
  } catch (error) {
    // Keep the report useful even when the optional LLM layer is unavailable.
    // The deterministic fallback is built from the same FTShare snapshot and
    // technical signals, so it never fabricates missing prices or events.
    structuredReport = emptyDeepReadReport()
    dataGaps.push('结构化 LLM 报告生成失败，当前 HTML 仅包含 FTShare 数据和确定性指标')
    warnings.push(error instanceof Error ? error.message : String(error))
  }
  const viewModel: ReportViewModel = {
    base_data: { date: asOf, stock: { name: snapshot.name, symbol_id: snapshot.symbol, price: finiteNumber(snapshot.quote?.close ?? snapshot.quote?.price) } },
    llm_content: structuredReport, quant_data: { marginDetail: snapshot.marginDetail, capitalFlow: snapshot.capitalFlow, financial: snapshot.financial, valuation: snapshot.valuation, announcements: snapshot.announcements, research: snapshot.research },
    kline_data: snapshot.ohlcv, kline_indicator_data: technical, t0_data: null, data_gaps: dataGaps, provenance: snapshot.provenance,
    llm_meta: { attempted: true, used: llmUsed, rounds: 5, provider: config.llmProvider, model: config.llmModel },
  }
  const blockedPermissions = snapshot.blockedPermissions ?? []
  const renderDataGaps = renderableDataGaps(dataGaps, snapshot.permissions, blockedPermissions)
  // Only pass permissions whose call produced no usable payload. A denied
  // higher-tier attempt may still have succeeded through a lower-tier
  // fallback; that notice is retained in warnings/provenance, but must not
  // hide data that the current subscription actually returned.
  const html = await renderReportHtml({ ...viewModel, data_gaps: renderDataGaps }, blockedPermissions)
  const exports = await renderExportArtifacts(html)
  if (!exports.pdf || !exports.png) warnings.push('PDF/PNG 导出资产未能在服务端预渲染；网页端将提供打印或兼容降级路径')
  const reportFilename = `FtAi-${safeSymbol(symbol)}-${asOf}-deep-read.html`
  const permissions = snapshot.permissions
  const result: ReportToolResult = {
    // A report remains renderable even when every requested source is blocked.
    // Keep the permission notices for field-level veils, but never turn a
    // valid report shell into a tool-level permission failure.
    status: llmUsed && dataGaps.length === 0 ? 'complete' : 'degraded',
    reportType: 'deep_read', symbol, asOf, reportFilename, reportHtml: html,
    reportPdfBase64: exports.pdf, reportPngBase64: exports.png,
    structuredReport,
    evidence: { technical, dataRows: { ohlcv: snapshot.ohlcv.length, income: snapshot.financial?.income.length ?? 0, cashflow: snapshot.financial?.cashflow.length ?? 0, announcements: snapshot.announcements.length, research: snapshot.research.length } },
    provenance: snapshot.provenance, freshness: { asOf, retrievedAt: new Date().toISOString(), provider: 'ftshare' }, dataGaps, warnings, permissions,
    llm: { attempted: true, used: llmUsed, rounds: 5, provider: config.llmProvider, model: config.llmModel },
  }
  return losslessJson(result) as ReportToolResult
}

function symbolsFor(request: ReportRequest): string[] {
  return uniqueStrings([...(request.symbol ? [request.symbol] : []), ...(request.symbols ?? []), ...(request.holdings ?? []).map(item => item.symbol)])
}

function reportTitle(type: ReportType): string {
  return ({ deep_read: '深度研读', holding_analysis: '持仓分析', limit_up_attribution: '跌后涨停归因', market_commentary: '市场点评', portfolio_etfs: 'ETF 深度组合', portfolio_stocks: '股票深度组合', review: '复盘报告', sector_analysis: '板块分析' } as Record<ReportType, string>)[type]
}

function coreAvailable(facts: ReportFacts): boolean {
  switch (facts.reportType) {
    case 'holding_analysis': case 'portfolio_stocks': case 'review':
      return facts.snapshots.some(snapshot => Boolean(snapshot.quote) || snapshot.ohlcv.length > 0 || Boolean(snapshot.financial?.income.length) || Boolean(snapshot.financial?.cashflow.length) || Boolean(snapshot.valuation) || snapshot.announcements.length > 0 || snapshot.research.length > 0)
    case 'portfolio_etfs': return facts.indices.length > 0 || facts.market.length > 0
    case 'market_commentary': return facts.market.length > 0 || facts.indices.length > 0 || facts.limits.length > 0
    case 'limit_up_attribution': return facts.limits.length > 0
    case 'sector_analysis': return facts.sectors.length > 0 || facts.flows.length > 0
    default: return facts.snapshots.length > 0
  }
}

function contextReport(context: TemplateContext): unknown { return context.report ?? context.llm ?? context }

export interface InvestmentReportArgs extends ReportRequest {}

export async function generateInvestmentReport(ctx: Context, args: InvestmentReportArgs, signal: AbortSignal, config: Config): Promise<ReportToolResult> {
  const reportType = args.reportType
  if (!reportType) throw new Error('reportType 不能为空')
  const asOf = normalizeAsOf(args.asOf)
  if (reportType === 'deep_read') {
    if (!args.symbol) throw new Error('deep_read 报告需要 symbol')
    return generateDeepReadReport(ctx, { symbol: args.symbol, asOf }, signal, config)
  }
  if (!args.symbol && !(args.symbols?.length) && !(args.holdings?.length) && !args.sectorCode && !args.sectorName && reportType !== 'market_commentary' && reportType !== 'limit_up_attribution') {
    throw new Error(`${reportType} 报告需要 symbol、symbols、holdings 或 sectorCode/sectorName`)
  }
  const request: ReportRequest = { ...args, reportType, symbols: args.symbols, holdings: args.holdings }
  const client = await ftshareClient(ctx, config)
  let facts = await client.withSession(signal, session => loadReportFacts(session, request, asOf, config, signal))
  // Retry an incomplete sector snapshot on a new gateway session and retain
  // successful facts from both attempts; one failing source must not erase another.
  for (let retry = 0; retry < 3 && reportType === 'sector_analysis' && (!facts.sectors.some(row => row.close != null) || !facts.flows.length || !facts.constituents.length || !Array.isArray(facts.raw.sector_classifications) || !facts.raw.sector_classifications.length || facts.raw.sector_classifications_complete !== true || (Array.isArray(facts.raw.sector_member_history) && new Set(facts.raw.sector_member_history.map(row => String(row.symbol))).size < facts.constituents.length))
      && facts.warnings.some(message => message.includes('上游服务暂时不可用')); retry++) {
    const refreshed = await client.withSession(signal, session => loadReportFacts(session, request, asOf, config, signal, facts))
    const distinct = <T>(items: T[], key: (item: T) => string): T[] => [...new Map(items.map(item => [key(item), item])).values()]
    facts = {
      ...facts,
      sectors: distinct([...facts.sectors, ...refreshed.sectors], item => JSON.stringify(item)),
      flows: distinct([...facts.flows, ...refreshed.flows], item => JSON.stringify(item)),
      constituents: distinct([...facts.constituents, ...refreshed.constituents], item => item.code),
      news: distinct([...facts.news, ...refreshed.news], item => JSON.stringify(item)),
      raw: { ...facts.raw, ...refreshed.raw, sector_member_history: distinct([...(Array.isArray(facts.raw.sector_member_history) ? facts.raw.sector_member_history : []), ...(Array.isArray(refreshed.raw.sector_member_history) ? refreshed.raw.sector_member_history : [])], row => JSON.stringify(row)), sector_classifications: distinct([...(Array.isArray(facts.raw.sector_classifications) ? facts.raw.sector_classifications : []), ...(Array.isArray(refreshed.raw.sector_classifications) ? refreshed.raw.sector_classifications : [])], row => JSON.stringify(row)) },
      provenance: [...facts.provenance, ...refreshed.provenance],
      permissions: distinct([...facts.permissions, ...refreshed.permissions], item => `${item.tool}:${item.requiredPlan}`),
      blockedPermissions: distinct([...facts.blockedPermissions, ...refreshed.blockedPermissions], item => `${item.tool}:${item.requiredPlan}`),
      dataGaps: uniqueStrings([...facts.dataGaps, ...refreshed.dataGaps]),
      warnings: uniqueStrings([...facts.warnings, ...refreshed.warnings]),
    }
    facts.dataGaps = facts.dataGaps.filter(gap => !facts.provenance.some(source => gap === `FTShare 工具调用失败：${source.tool}` || gap === `FTShare 数据为空：${source.tool}`))
  }
  const generated = await generateTemplateReport(ctx.llm, reportType, facts, { provider: config.llmProvider, model: config.llmModel, maxAttempts: config.llmMaxAttempts }, signal)
  const context = generated.context
  const reportPathName = `FtAi-${safeSymbol(args.symbol ?? args.sectorCode ?? args.sectorName ?? symbolsFor(request)[0] ?? reportType)}-${asOf}-${reportType}.html`
  const renderDataGaps = renderableDataGaps(facts.dataGaps, facts.permissions, facts.blockedPermissions)
  // Render subscription veils only for calls that ended without usable data.
  // Successful lower-tier fallbacks remain visible; their permission notices
  // stay available in the result metadata and warnings for transparency.
  const html = await renderReportTemplate(reportType, context, facts.blockedPermissions, renderDataGaps)
  const exports = await renderExportArtifacts(html)
  const warnings = [...facts.warnings]
  if (!exports.pdf || !exports.png) warnings.push('PDF/PNG 导出资产未能在服务端预渲染；网页端将提供打印或兼容降级路径')
  if (!generated.used) warnings.push('LLM 未返回可用结构化内容，已使用确定性 FTShare 数据上下文降级渲染')
  if (generated.error) warnings.push(generated.error)
  const dataGaps = [...facts.dataGaps]
  if (!coreAvailable(facts)) dataGaps.push(`${reportTitle(reportType)}缺少核心 FTShare 数据`)
  const dedupe = (items: string[]) => [...new Set(items)]
  const permissions = facts.permissions
  // Permission-denied fields are rendered as subscription veils inside the
  // report. The tool itself must still return the report HTML so the result
  // card, preview and exports remain available when core data is restricted.
  const status = generated.used && !generated.error && dataGaps.length === 0 ? 'complete' : 'degraded'
  const result: ReportToolResult = {
    status, reportType, symbol: args.symbol, asOf, reportFilename: reportPathName, reportHtml: html,
    reportPdfBase64: exports.pdf, reportPngBase64: exports.png,
    structuredReport: (contextReport(context) as Record<string, unknown> | null) ?? null,
    evidence: { snapshots: facts.snapshots.length, marketRows: facts.market.length, indexRows: facts.indices.length, sectorRows: facts.sectors.length, flowRows: facts.flows.length, limitRows: facts.limits.length, announcementRows: facts.announcements.length, newsRows: facts.news.length, request },
    provenance: facts.provenance, freshness: { asOf, retrievedAt: new Date().toISOString(), provider: 'ftshare' }, dataGaps: dedupe(dataGaps), warnings: dedupe(warnings), permissions,
    llm: { attempted: generated.attempted, used: generated.used, rounds: generated.rounds, provider: config.llmProvider, model: config.llmModel },
  }
  return losslessJson(result) as ReportToolResult
}
