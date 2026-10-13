/*
 * Browser half of FT 投研舱 (@ft/dsh-fft-research-cockpit).
 *
 * The report HTML stays in the durable tool-result presentation metadata. This
 * card only creates a browser Blob when the user clicks Download, so running a
 * report never writes a file into the workspace or the user's home directory.
 */
window.__ModuleLoader__.load({
  id: '@ft/dsh-fft-research-cockpit',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const {
      DisclosureRow,
      IconChevronDownOutline14,
      IconChevronLeftOutline14,
      IconCloseOutline16,
      IconDownloadOutline16,
      IconFullscreenOutline16,
      IconInspectOutline12,
      IconSparkle16,
      StateDot,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const css = `
.ftai-report-card { display: flex; flex-direction: column; min-width: 0; }
.ftai-report-row { position: relative; overflow: hidden; }
.ftai-report-row[data-state="running"]::after { content: ''; position: absolute; inset: 0 auto 0 0; width: 300px; background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%); animation: ftai-report-sweep 2.6s ease-out infinite; pointer-events: none; }
@keyframes ftai-report-sweep { 0% { left: -300px; } 90%, 100% { left: 100%; } }
.ftai-report-leading { flex: none; }
.ftai-report-title { flex: none; color: var(--dsw-alias-label-secondary); font-weight: 500; }
.ftai-report-separator { flex: none; width: 2px; height: 2px; margin: 0 8px; border-radius: 1px; background: var(--dsw-alias-label-caption); }
.ftai-report-summary { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); }
.ftai-report-body { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 6px 4px; min-width: 0; }
.ftai-report-inline-preview { display: block; box-sizing: border-box; width: 100%; max-width: 100%; min-height: 480px; height: min(72vh, 760px); border: .5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: #fff; overflow: hidden; }
.ftai-report-result-card { display: flex; flex-direction: column; gap: 10px; margin: 14px 0 8px; padding: 14px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.ftai-report-result-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.ftai-report-result-heading { display: inline-flex; align-items: center; gap: 8px; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
.ftai-report-result-heading::before { content: '报告预览'; color: var(--dsw-alias-state-business-primary); }
.ftai-report-result-select { min-width: 190px; max-width: 100%; height: 32px; padding: 0 28px 0 9px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; }
.ftai-report-result-actions { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.ftai-report-result-toggle { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border: .5px solid var(--dsw-alias-state-business-primary); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, var(--dsw-alias-bg-base)); color: var(--dsw-alias-state-business-primary); cursor: pointer; font: inherit; font-size: 12px; }
.ftai-report-result-export { height: 32px; padding: 0 28px 0 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; }
.ftai-report-result-preview { position: relative; max-height: 440px; overflow: hidden; border-radius: 12px; }
.ftai-report-result-preview:not([data-expanded])::after { content: ''; position: absolute; right: 0; bottom: 0; left: 0; height: 88px; background: linear-gradient(to bottom, transparent, var(--dsw-alias-bg-base)); pointer-events: none; }
.ftai-report-result-preview[data-expanded] { max-height: none; overflow: visible; }
.ftai-report-preview-tools { position: absolute; top: 10px; right: 10px; z-index: 2; display: inline-flex; gap: 6px; opacity: .88; transition: opacity .16s ease; }
.ftai-report-result-preview:hover .ftai-report-preview-tools, .ftai-report-preview-tools:focus-within { opacity: 1; }
.ftai-report-preview-tool { padding: 5px 9px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, transparent); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 12px; backdrop-filter: blur(8px); }
.ftai-report-preview-tool:hover { border-color: var(--dsw-alias-interactive-border-hover); color: var(--dsw-alias-label-primary); }
.ftai-report-side-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; justify-content: flex-end; background: rgba(29, 33, 41, .38); }
.ftai-report-side-backdrop { position: absolute; inset: 0; border: 0; background: transparent; cursor: default; }
.ftai-report-side-panel { position: relative; z-index: 1; display: flex; flex-direction: column; width: min(72vw, 1120px); min-width: min(620px, 94vw); height: 100%; background: var(--dsw-alias-bg-base); box-shadow: -12px 0 32px rgba(29, 33, 41, .16); }
.ftai-report-side-panel[data-focus="true"] { width: 100vw; min-width: 100vw; }
.ftai-report-side-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; min-height: 58px; padding: 10px 18px; border-bottom: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.ftai-report-side-title { color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 600; }
.ftai-report-side-actions { display: inline-flex; align-items: center; gap: 8px; }
.ftai-report-side-frame { display: block; width: 100%; height: 100%; flex: 1 1 auto; border: 0; background: #fff; }
.ftai-report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; padding: 0 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.ftai-report-toolbar-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; }
.ftai-report-download { display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 5px 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; }
.ftai-report-download:hover { border-color: var(--dsw-alias-interactive-border-hover); background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary); }
.ftai-report-details { display: flex; flex-direction: column; min-width: 0; min-height: 100%; gap: 0; }
/* The FFT tab owns scrolling; its report child keeps its natural height. */
div:has(> .ftai-fft-report-tab) { overflow-y: auto; overflow-x: hidden; }
.ftai-report-details-toolbar { position: sticky; top: -12px; z-index: 2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-height: 36px; padding: 4px 0 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.ftai-report-details-heading { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; }
.ftai-report-details-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
.ftai-report-details-status { color: var(--dsw-alias-label-tertiary); }
.ftai-report-details-preview { display: block; box-sizing: border-box; width: 100%; max-width: 100%; height: min(76vh, 820px); min-height: 480px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: #fff; overflow: hidden; }
.ftai-report-fallback { max-height: 360px; overflow: auto; margin: 0; padding: 12px 14px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-markdown-code-block); color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; font: var(--dsw-font-markdown-code-block-small); }
.ftai-report-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; }
.ftai-report-open-view { display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 4px 9px; border: .5px solid var(--dsw-alias-state-business-primary); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, var(--dsw-alias-bg-base)); color: var(--dsw-alias-state-business-primary); cursor: pointer; font: inherit; font-size: 12px; font-weight: 500; line-height: 18px; }
.ftai-report-open-view:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 15%, var(--dsw-alias-bg-base)); }
.ftai-report-open-details-compact { display: inline-flex; align-items: center; gap: 4px; flex: none; padding: 3px 8px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 11px; line-height: 18px; }
.ftai-report-open-details-compact:hover { border-color: var(--dsw-alias-interactive-border-hover); background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary); }
.ftai-report-open-details { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: .5px solid var(--dsw-alias-state-business-primary); border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); color: var(--dsw-alias-state-business-primary); cursor: pointer; font-size: 11px; line-height: 16px; }
.ftai-report-open-details:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 15%, transparent); }
.ftai-report-inspect { display: inline-flex; align-self: flex-start; align-items: center; gap: 4px; padding: 2px 8px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 999px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 11px; line-height: 16px; opacity: 0; }
.ftai-report-card:hover .ftai-report-inspect, .ftai-report-inspect:focus-visible { opacity: 1; }
.ftai-report-inspect:hover { background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary); }
.ftai-report-view { display: flex; flex: 1 1 0; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.ftai-report-view[data-focus-mode="true"] { position: fixed; inset: 0; z-index: 1000; width: 100vw; height: 100dvh; }
.ftai-report-view-toolbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; min-height: 52px; padding: 8px 16px; border-bottom: .5px solid var(--dsw-alias-border-l1); background: color-mix(in srgb, var(--dsw-alias-bg-base) 96%, transparent); }
.ftai-report-view-leading, .ftai-report-view-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ftai-report-view-actions { flex: none; }
.ftai-report-view-icon-button { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; padding: 0; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ftai-report-view-icon-button:hover { border-color: var(--dsw-alias-interactive-border-hover); background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary); }
.ftai-report-view-title-group { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.ftai-report-view-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; line-height: 20px; }
.ftai-report-view-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
.ftai-report-view-select { min-width: 150px; max-width: min(320px, 28vw); height: 32px; padding: 0 28px 0 9px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; }
.ftai-report-view-frame-wrap { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
.ftai-report-view-frame { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.ftai-report-view-empty { display: grid; flex: 1 1 0; min-height: 320px; place-items: center; padding: 24px; color: var(--dsw-alias-label-tertiary); font-size: 14px; text-align: center; }
[data-conversation-scroll]:has([data-ftai-report-view]) > [data-composer-seat] { display: none; }
@media (max-width: 760px) {
  .ftai-report-summary { display: none; }
  .ftai-report-view-toolbar { min-height: 48px; gap: 6px; padding: 7px 8px; flex-wrap: wrap; }
  .ftai-report-view-leading, .ftai-report-view-actions { gap: 4px; }
  .ftai-report-view-actions { flex-wrap: wrap; justify-content: flex-end; }
  .ftai-report-view-status { display: none; }
  .ftai-report-view-select { min-width: 0; max-width: 34vw; }
  .ftai-report-view-actions .ftai-report-download { width: 44px; height: 32px; justify-content: center; padding: 0 5px; font-size: 10px; gap: 3px; }
  /* Keep all three export formats discoverable on narrow screens. PNG used
     to be hidden here, which made the report view appear PDF-only. */
  .ftai-report-view-actions .ftai-report-download { display: inline-flex; }
}
@media (hover: none), (pointer: coarse) {
  /* Hover-only controls are invisible on touch devices. Keep preview actions
     visible and keyboard/touch reachable without changing desktop density. */
  .ftai-report-preview-tools { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) { .ftai-report-row[data-state="running"]::after { display: none; } }
`
    const styleId = 'ft-research-cockpit/report-card'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${styleId}"]`) === null) {
      const style = document.createElement('style')
      style.dataset.plugin = 'ft-research-cockpit'
      style.dataset.pluginCss = styleId
      style.textContent = css
      document.head.appendChild(style)
    }

    const REPORT_TOOL_NAMES = [
      'cockpit_investment_report',
      'cockpit_deep_read_report',
      'cockpit_holding_analysis_report',
      'cockpit_limit_up_attribution_report',
      'cockpit_market_commentary_report',
      'cockpit_portfolio_etfs_report',
      'cockpit_portfolio_stocks_report',
      'cockpit_review_report',
      'cockpit_sector_analysis_report',
      'cockpit_portfolio_recommendation',
    ]
    const REPORT_VIEW_ID = 'investment-report'
    const REPORT_SELECTION_KEY = 'ft-research-cockpit:last-report:'
    const REPORT_TYPE_LABELS = {
      deep_read: '深度研读',
      holding_analysis: '持仓分析',
      limit_up_attribution: '涨停归因',
      market_commentary: '市场点评',
      portfolio_etfs: 'ETF 组合',
      portfolio_stocks: '股票组合',
      review: '复盘报告',
      sector_analysis: '板块分析',
      portfolio_recommendation: '组合推荐',
    }

    function firstLine(value) {
      const text = String(value ?? '')
      const index = text.indexOf('\n')
      return index === -1 ? text : text.slice(0, index)
    }

    function resultText(block) {
      if (!block || !('kind' in block)) return null
      const parts = []
      for (const item of block.content ?? []) parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
      if (parts.length === 0 && block.error) parts.push(`${block.error.name}: ${block.error.code}`)
      return parts.join('\n') || null
    }

    function stateOf(block) {
      if (!block || !('kind' in block)) return 'running'
      if (block.error?.code === 'interrupted') return 'stopped'
      return block.isError ? 'error' : 'ok'
    }

    function toolNameOf(block) {
      if (!block || typeof block !== 'object') return ''
      if ('kind' in block) return typeof block.call?.name === 'string' ? block.call.name : ''
      return typeof block.name === 'string' ? block.name : ''
    }

    function argsOf(block) {
      const raw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
      try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function reportMetaOf(block) {
      if (!block || !('kind' in block) || !block.meta || typeof block.meta !== 'object') return null
      const meta = block.meta
      if (meta.kind !== 'investment-report' || typeof meta.reportHtml !== 'string' || meta.reportHtml === '') return null
      return {
        html: meta.reportHtml,
        filename: typeof meta.filename === 'string' && meta.filename !== '' ? meta.filename : 'FtAi-investment-report.html',
        pdfBase64: typeof meta.reportPdfBase64 === 'string' ? meta.reportPdfBase64 : '',
        pngBase64: typeof meta.reportPngBase64 === 'string' ? meta.reportPngBase64 : '',
        reportType: typeof meta.reportType === 'string' ? meta.reportType : '',
        symbol: typeof meta.symbol === 'string' ? meta.symbol : '',
        asOf: typeof meta.asOf === 'string' ? meta.asOf : '',
        status: typeof meta.status === 'string' ? meta.status : '',
      }
    }

    function reportEntriesOf(nodes) {
      const entries = []
      const seen = new Set()
      const visit = (block) => {
        if (!block || typeof block !== 'object' || seen.has(block.callId)) return
        seen.add(block.callId)
        const report = reportMetaOf(block)
        if (report !== null) {
          const args = argsOf(block)
          const symbol = report.symbol || (typeof args.symbol === 'string' ? firstLine(args.symbol) : '')
          const reportType = report.reportType || (typeof args.reportType === 'string' ? args.reportType : '')
          entries.push({
            callId: block.callId,
            block,
            report,
            reportType,
            symbol,
            time: typeof block.time === 'number' ? block.time : 0,
          })
        }
        for (const child of block.subCalls ?? []) visit(child)
      }
      for (const node of nodes) {
        if (node?.kind === 'tool-call') visit(node.data?.root)
      }
      return entries.sort((left, right) => left.time - right.time)
    }

    function reportEntryLabel(entry) {
      const type = REPORT_TYPE_LABELS[entry.reportType] || entry.reportType || '投研报告'
      return [entry.symbol, type, entry.report.asOf].filter(Boolean).join(' · ')
    }

    function readReportSelection(sessionId) {
      if (typeof window === 'undefined') return ''
      try {
        return window.localStorage.getItem(`${REPORT_SELECTION_KEY}${sessionId}`) || ''
      } catch {
        return ''
      }
    }

    function writeReportSelection(sessionId, callId) {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(`${REPORT_SELECTION_KEY}${sessionId}`, callId)
      } catch {
        // Private browsing or disabled storage does not affect this mounted view.
      }
    }

    // The details column owns the only vertical scroll for a report. The
    // report document posts its natural height so the iframe never becomes a
    // second, clipped scroll container inside the complete report panel.
    // The right-side details column is intentionally compact (about 320px at
    // the default desktop geometry).  Keep the report as one natural-height
    // document, but make the report's own layout converge to that width rather
    // than letting fixed desktop columns squeeze long data markers into one
    // character per line.
    const compactReportStyle = `<style id="ftai-report-details-compact">
html, body { min-width: 0 !important; width: 100% !important; overflow-x: hidden !important; }
body { font-size: 13px !important; }
.page { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 16px 12px 28px !important; }
.hero { grid-template-columns: 1fr !important; grid-template-areas: "identity" "title" "meta" "summary" !important; gap: 10px !important; padding: 20px 16px !important; }
.hero h1 { max-width: none !important; font-size: 20px !important; }
.hero-summary { padding: 42px 14px 14px !important; }
.date-block { max-width: none !important; justify-content: flex-start !important; }
.source-strip { padding: 10px 12px !important; }
.metric-grid { grid-template-columns: 1fr !important; }
.metric { padding: 12px !important; }
.metric-value { font-size: 18px !important; overflow-wrap: anywhere !important; }
.judgement-grid, .driver-grid, .event-grid, .dashboard-grid, .two-grid, .triple-grid { grid-template-columns: 1fr !important; }
.breadth-row { grid-template-columns: 64px minmax(40px, .42fr) minmax(0, 1fr) !important; gap: 8px !important; align-items: start !important; }
.breadth-row strong { min-width: 0 !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
.rank-row, .etf-row { grid-template-columns: 24px minmax(0, 1fr) auto !important; }
.rank-extra, .etf-return.week, .etf-return.month { display: none !important; }
.rank-name, .etf-name { white-space: normal !important; overflow-wrap: anywhere !important; }
.chart, .chart-sm { height: 240px !important; }
.report-chart { height: 420px !important; }
.beta-tech-chart { height: 180px !important; }
.conclusion { padding: 20px 18px 20px 58px !important; }
@media (max-width: 600px) {
  .quant-table { min-width: 0 !important; width: 100% !important; table-layout: fixed !important; }
  .quant-table th, .quant-table td { white-space: normal !important; overflow-wrap: anywhere !important; padding: 10px 6px !important; }
  .quant-table td:first-child { width: 42% !important; }
  .quant-table td:last-child { width: 58% !important; }
  .quant-value, .quant-value span { white-space: normal !important; overflow-wrap: anywhere !important; }
}
@media (max-width: 360px) {
  .page { padding-left: 8px !important; padding-right: 8px !important; }
  .hero { padding-left: 12px !important; padding-right: 12px !important; }
  .breadth-row { grid-template-columns: 58px minmax(32px, .32fr) minmax(0, 1fr) !important; gap: 6px !important; }
}
</style>`

    function reportSrcDoc(html) {
      const resizeScript = `<script>
(function () {
  function reportHeight() {
    var body = document.body;
    var root = document.documentElement;
    var height = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    );
    if (height > 0 && window.parent) {
      window.parent.postMessage({ type: 'ftai-report-height', height: height }, '*');
    }
  }
  window.addEventListener('load', reportHeight);
  window.addEventListener('resize', reportHeight);
  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(document.documentElement);
  }
  reportHeight();
  setTimeout(reportHeight, 100);
  setTimeout(reportHeight, 500);
      setTimeout(reportHeight, 1200);
})();
<\/script>`
      const withCompactStyle = /<\/head\s*>/i.test(html)
        ? html.replace(/<\/head\s*>/i, `${html.includes('id="nova-sector-theme"') ? '' : compactReportStyle}</head>`)
        : `${compactReportStyle}${html}`
      return /<\/body\s*>/i.test(withCompactStyle)
        ? withCompactStyle.replace(/<\/body\s*>/i, `${resizeScript}</body>`)
        : `${withCompactStyle}${resizeScript}`
    }

    // Keep exports in the trusted host while report documents remain sandboxed.
    const ReportDocumentFrame = React.forwardRef(function ReportDocumentFrame(props, forwardedRef) {
      const { report, ...frameProps } = props
      const frameRef = React.useRef(null)
      React.useEffect(() => {
        const onMessage = event => {
          if (event.source !== frameRef.current?.contentWindow || event.data?.type !== 'ftai-report-export') return
          if (!report) return
          if (event.data.format === 'html') downloadReport(report)
          if (event.data.format === 'pdf') downloadPdfReport(report)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [report])
      return React.createElement('iframe', { ...frameProps, ref: element => {
        frameRef.current = element
        if (typeof forwardedRef === 'function') forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      } })
    })

    function FullReportFrame(props) {
      const frameRef = React.useRef(null)
      const [height, setHeight] = React.useState(null)
      const frameHtml = React.useMemo(() => reportSrcDoc(props.html), [props.html])

      React.useEffect(() => {
        setHeight(null)
      }, [props.html])

      React.useEffect(() => {
        const onMessage = (event) => {
          const frame = frameRef.current
          if (!frame || event.source !== frame.contentWindow) return
          const next = Number(event.data?.height)
          if (!Number.isFinite(next) || next <= 0) return
          // Keep malformed or runaway documents from expanding the host page
          // without bound while still allowing a genuinely long report.
          setHeight(Math.min(Math.max(Math.ceil(next), 480), 50000))
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])

      // Expanding an iframe changes the scroll anchor of the host DetailsPanel
      // in Chromium.  Let the new height commit first, then return the outer
      // details column to the report's top so every report opens consistently.
      React.useEffect(() => {
        if (height === null || typeof props.onHeightSettled !== 'function') return undefined
        const frame = window.requestAnimationFrame(() => props.onHeightSettled())
        return () => window.cancelAnimationFrame(frame)
      }, [height, props.onHeightSettled])

      return React.createElement(ReportDocumentFrame, {
        report: props.report,
        ref: frameRef,
        className: props.className || 'ftai-report-details-preview',
        title: props.title,
        srcDoc: frameHtml,
        scrolling: 'no',
        onLoad: () => { if (typeof props.onHeightSettled === 'function') props.onHeightSettled() },
        style: height === null ? undefined : { height: `${height}px` },
        sandbox: 'allow-scripts allow-popups',
        referrerPolicy: 'no-referrer',
      })
    }

    function downloadReport(report) {
      const blob = new Blob([report.html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = report.filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    function downloadBase64(value, mime, filename) {
      const binary = atob(value)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    }

    // Browsers do not expose a portable direct-PDF download API. Open the
    // self-contained report in a print-ready tab and invoke the native print
    // dialog, where the user can choose “Save as PDF”.
    function downloadPdfReport(report) {
      if (report.pdfBase64) {
        downloadBase64(report.pdfBase64, 'application/pdf', report.filename.replace(/\.html?$/i, '.pdf'))
        return
      }
      const printable = /<\/body\s*>/i.test(report.html)
        ? report.html.replace(/<\/body\s*>/i, '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));<\\/script></body>')
        : `${report.html}<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));<\\/script>`
      const blob = new Blob([printable], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const popup = window.open(url, '_blank', 'noopener,noreferrer')
      if (!popup) window.alert('浏览器阻止了新窗口，请允许弹窗后重试。')
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    }

    function downloadPngReport(report) {
      if (report.pngBase64) {
        downloadBase64(report.pngBase64, 'image/png', report.filename.replace(/\.html?$/i, '.png'))
        return
      }
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1440px;height:1px;border:0;visibility:hidden;'
      frame.srcdoc = report.html
      document.body.appendChild(frame)
      const cleanup = () => window.setTimeout(() => frame.remove(), 1000)
      frame.addEventListener('load', () => {
        window.setTimeout(() => {
          try {
            const doc = frame.contentDocument
            if (!doc) throw new Error('报告文档未加载')
            const width = 1440
            const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0, 800)
            const styles = Array.from(doc.querySelectorAll('style')).map(node => node.textContent || '').join('\\n')
            const body = doc.body?.innerHTML || ''
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${styles}</style>${body}</div></foreignObject></svg>`
            const image = new Image()
            image.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = width * 2
              canvas.height = height * 2
              const context = canvas.getContext('2d')
              if (!context) throw new Error('PNG 画布初始化失败')
              context.scale(2, 2)
              context.fillStyle = '#ffffff'
              context.fillRect(0, 0, width, height)
              context.drawImage(image, 0, 0, width, height)
              canvas.toBlob(blob => {
                if (!blob) throw new Error('PNG 编码失败')
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = report.filename.replace(/\\.html?$/i, '.png')
                anchor.click()
                window.setTimeout(() => URL.revokeObjectURL(url), 10000)
                cleanup()
              }, 'image/png')
            }
            image.onerror = () => { window.alert('PNG 渲染失败，请重试。'); cleanup() }
            image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
          } catch {
            window.alert('PNG 渲染失败，请重试。')
            cleanup()
          }
        }, 700)
      }, { once: true })
    }

    function leading(state) {
      if (state === 'error') return React.createElement(StateDot, { state: 'error' })
      if (state === 'stopped') return React.createElement(StateDot, { state: 'warning' })
      return React.createElement(IconSparkle16, { size: 14 })
    }

    function ReportDetails(props) {
      const report = reportMetaOf(props.block)
      if (report === null) return null
      const args = argsOf(props.block)
      const symbol = report.symbol || (typeof args.symbol === 'string' ? firstLine(args.symbol) : '')
      const detailsRef = React.useRef(null)
      const resetScroll = React.useCallback(() => {
        const root = detailsRef.current
        if (!root) return
        const resetAncestorScroll = () => {
          let ancestor = root.parentElement
          while (ancestor) {
            const overflowY = window.getComputedStyle(ancestor).overflowY
            if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
              ancestor.scrollTop = 0
              break
            }
            ancestor = ancestor.parentElement
          }
        }
        resetAncestorScroll()
        window.requestAnimationFrame(resetAncestorScroll)
      }, [])
      React.useEffect(() => {
        resetScroll()
      }, [report.html, resetScroll])
      return React.createElement('div', { ref: detailsRef, className: 'ftai-report-details', 'data-report-details': 'investment-report' },
        React.createElement('div', { className: 'ftai-report-details-toolbar' },
          React.createElement('div', { className: 'ftai-report-details-heading' },
            React.createElement('span', { className: 'ftai-report-details-title' }, '完整报告'),
            React.createElement('span', { className: 'ftai-report-details-status' }, `${report.asOf ? `${report.asOf} · ` : ''}${report.status || '已生成'}`),
          ),
          React.createElement('select', {
            className: 'ftai-report-result-export',
            value: '',
            'aria-label': '导出为',
            onClick: event => event.stopPropagation(),
            onChange: event => {
              event.stopPropagation()
              const format = event.target.value
              if (format === 'html') downloadReport(report)
              if (format === 'pdf') downloadPdfReport(report)
              if (format === 'png') downloadPngReport(report)
            },
          },
            React.createElement('option', { value: '' }, '导出为'),
            React.createElement('option', { value: 'html' }, 'HTML'),
            React.createElement('option', { value: 'pdf' }, 'PDF'),
            React.createElement('option', { value: 'png' }, 'PNG'),
          ),
        ),
        React.createElement(FullReportFrame, {
          report,
          html: report.html,
          title: `${symbol || '投研'}完整报告`,
          onHeightSettled: resetScroll,
        }),
      )
    }

    function ReportResultCard(props) {
      const reports = props.reports
      const [selectedCallId, setSelectedCallId] = React.useState(() => reports[reports.length - 1]?.callId || '')
      const [expanded, setExpanded] = React.useState(false)
      const [focusOpen, setFocusOpen] = React.useState(false)
      React.useEffect(() => {
        if (!reports.some(entry => entry.callId === selectedCallId)) setSelectedCallId(reports[reports.length - 1]?.callId || '')
      }, [reports, selectedCallId])
      const selected = reports.find(entry => entry.callId === selectedCallId) || reports[reports.length - 1]
      if (!selected) return null
      React.useEffect(() => {
        if (!focusOpen) return undefined
        const onKeyDown = event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setFocusOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [focusOpen])
      return React.createElement('section', { className: 'ftai-report-result-card', 'data-report-result': 'investment-report' },
        React.createElement('div', { className: 'ftai-report-result-toolbar' },
          React.createElement('div', { className: 'ftai-report-result-heading' }, `${selected.symbol || '投研'} · ${selected.report.status || '已生成'}`),
          reports.length > 1 ? React.createElement('select', {
            className: 'ftai-report-result-select',
            value: selected.callId,
            'aria-label': '选择报告预览',
            onChange: event => setSelectedCallId(event.target.value),
          }, reports.map(entry => React.createElement('option', { key: entry.callId, value: entry.callId }, reportEntryLabel(entry)))) : null,
          React.createElement('div', { className: 'ftai-report-result-actions' },
            React.createElement('button', {
              type: 'button', className: 'ftai-report-result-toggle',
              'aria-expanded': expanded,
              onClick: () => setExpanded(value => !value),
            }, expanded ? '收起' : '展开'),
            React.createElement('select', {
              className: 'ftai-report-result-export',
              value: '',
              'aria-label': '导出为',
              onChange: event => {
                const format = event.target.value
                if (format === 'html') downloadReport(selected.report)
                if (format === 'pdf') downloadPdfReport(selected.report)
                if (format === 'png') downloadPngReport(selected.report)
              },
            },
              React.createElement('option', { value: '' }, '导出为'),
              React.createElement('option', { value: 'png' }, 'PNG'),
              React.createElement('option', { value: 'pdf' }, 'PDF'),
              React.createElement('option', { value: 'html' }, 'HTML'),
            ),
          ),
        ),
        React.createElement('div', {
          className: 'ftai-report-result-preview',
          'data-expanded': expanded || undefined,
        },
          React.createElement('div', { className: 'ftai-report-preview-tools' },
            React.createElement('button', {
              type: 'button', className: 'ftai-report-preview-tool',
              disabled: typeof props.openDetails !== 'function',
              title: typeof props.openDetails === 'function' ? '在 FFT Sidebar 中打开报告' : '请在已启用 FFT Sidebar 的宿主中打开报告',
              onClick: () => props.openDetails(selected.callId, toolNameOf(selected.block)),
            }, '右侧展开'),
            React.createElement('button', {
              type: 'button', className: 'ftai-report-preview-tool',
              onClick: () => setFocusOpen(true),
            }, '独立放大'),
          ),
          React.createElement(FullReportFrame, {
            report: selected.report,
            html: selected.report.html,
            title: `${selected.symbol || '投研'}报告预览`,
            className: 'ftai-report-inline-preview',
          }),
        ),
        focusOpen ? React.createElement('div', { className: 'ftai-report-side-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${selected.symbol || '投研'}报告` },
          React.createElement('button', { type: 'button', className: 'ftai-report-side-backdrop', 'aria-label': '关闭放大报告', onClick: () => setFocusOpen(false) }),
          React.createElement('aside', { className: 'ftai-report-side-panel', 'data-focus': focusOpen || undefined },
            React.createElement('header', { className: 'ftai-report-side-toolbar' },
              React.createElement('div', { className: 'ftai-report-side-title' }, `${selected.symbol || '投研'} · ${REPORT_TYPE_LABELS[selected.reportType] || '投研报告'}`),
              React.createElement('div', { className: 'ftai-report-side-actions' },
                React.createElement('select', {
                  className: 'ftai-report-result-export',
                  value: '',
                  'aria-label': '导出为',
                  onChange: event => {
                    const format = event.target.value
                    if (format === 'html') downloadReport(selected.report)
                    if (format === 'pdf') downloadPdfReport(selected.report)
                    if (format === 'png') downloadPngReport(selected.report)
                  },
                },
                  React.createElement('option', { value: '' }, '导出为'),
                  React.createElement('option', { value: 'png' }, 'PNG'),
                  React.createElement('option', { value: 'pdf' }, 'PDF'),
                  React.createElement('option', { value: 'html' }, 'HTML'),
                ),
                React.createElement('button', { type: 'button', className: 'ftai-report-view-icon-button', 'aria-label': focusOpen ? '退出独立放大' : '独立放大', title: focusOpen ? '退出独立放大' : '独立放大', onClick: () => setFocusOpen(value => !value) }, React.createElement(focusOpen ? IconCloseOutline16 : IconFullscreenOutline16, { size: 16 })),
                React.createElement('button', { type: 'button', className: 'ftai-report-view-icon-button', 'aria-label': '关闭报告', title: '关闭报告', onClick: () => setFocusOpen(false) }, React.createElement(IconCloseOutline16, { size: 16 })),
              ),
            ),
            React.createElement(ReportDocumentFrame, { report: selected.report, className: 'ftai-report-side-frame', title: `${selected.symbol || '投研'}完整报告`, srcDoc: selected.report.html, sandbox: 'allow-scripts allow-popups', referrerPolicy: 'no-referrer' }),
          ),
        ) : null,
      )
    }

    function ReportResult(props) {
      const reports = props.useChat(snapshot => reportEntriesOf(
        snapshot.locations.getTurn(props.turn.turn)
          .map(key => snapshot.nodes.get(key))
          .filter(Boolean),
      ))
      return reports.length > 0 ? React.createElement(ReportResultCard, { reports, openDetails: props.openReportSidebar }) : null
    }

    function ReportView(props) {
      const reports = props.useChat(snapshot => reportEntriesOf(snapshot.nodes.values()))
      const [selectedCallId, setSelectedCallId] = React.useState(() => readReportSelection(props.sessionId))
      const [focusMode, setFocusMode] = React.useState(false)
      const focusedCallId = props.viewRequest?.view === REPORT_VIEW_ID ? props.viewRequest.focus : ''
      const selected = reports.find(entry => entry.callId === focusedCallId)
        || reports.find(entry => entry.callId === selectedCallId)
        || reports.at(-1)

      // DSH 0.2 dropped the injectable details-panel close callback; the View
      // owns the conversation area now, so there is no side panel to dismiss
      // when the report view opens.
      React.useEffect(() => {
        setSelectedCallId(readReportSelection(props.sessionId))
        setFocusMode(false)
      }, [props.sessionId])

      React.useEffect(() => {
        if (props.viewRequest?.view !== REPORT_VIEW_ID) return
        const requested = reports.find(entry => entry.callId === props.viewRequest.focus)
        if (requested) {
          setSelectedCallId(requested.callId)
          writeReportSelection(props.sessionId, requested.callId)
        }
        props.completeViewRequest()
      }, [props.completeViewRequest, props.sessionId, props.viewRequest, reports])

      React.useEffect(() => {
        if (!selected) return
        writeReportSelection(props.sessionId, selected.callId)
      }, [props.sessionId, selected?.callId])

      React.useEffect(() => {
        if (!focusMode) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setFocusMode(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [focusMode])

      const openChat = () => props.openView('chat', selected?.callId || '')
      const selectReport = (event) => {
        const callId = event.target.value
        setSelectedCallId(callId)
        writeReportSelection(props.sessionId, callId)
      }
      const label = selected ? reportEntryLabel(selected) : '投研报告'

      return React.createElement('div', {
        className: 'ftai-report-view',
        'data-conversation-composer-overlay': '',
        'data-ftai-report-view': '',
        'data-focus-mode': focusMode ? 'true' : 'false',
      },
      React.createElement('div', { className: 'ftai-report-view-toolbar' },
        React.createElement('div', { className: 'ftai-report-view-leading' },
          React.createElement('button', {
            type: 'button',
            className: 'ftai-report-view-icon-button',
            title: '返回对话',
            'aria-label': '返回对话',
            onClick: openChat,
          }, React.createElement(IconChevronLeftOutline14, { size: 16 })),
          React.createElement('div', { className: 'ftai-report-view-title-group' },
            React.createElement('span', { className: 'ftai-report-view-title' }, label),
            selected ? React.createElement('span', { className: 'ftai-report-view-status' }, `${selected.report.status || '已生成'}${selected.report.asOf ? ` · ${selected.report.asOf}` : ''}`) : null,
          ),
        ),
        React.createElement('div', { className: 'ftai-report-view-actions' },
          reports.length > 1 ? React.createElement('select', {
            className: 'ftai-report-view-select',
            value: selected?.callId || '',
            'aria-label': '选择报告',
            onChange: selectReport,
          }, reports.map(entry => React.createElement('option', { key: entry.callId, value: entry.callId }, reportEntryLabel(entry)))) : null,
          selected ? React.createElement('select', {
            className: 'ftai-report-result-export',
            value: '',
            'aria-label': '导出为',
            onClick: event => event.stopPropagation(),
            onChange: event => {
              event.stopPropagation()
              const format = event.target.value
              if (format === 'html') downloadReport(selected.report)
              if (format === 'pdf') downloadPdfReport(selected.report)
              if (format === 'png') downloadPngReport(selected.report)
            },
          },
            React.createElement('option', { value: '' }, '导出为'),
            React.createElement('option', { value: 'html' }, 'HTML'),
            React.createElement('option', { value: 'pdf' }, 'PDF'),
            React.createElement('option', { value: 'png' }, 'PNG'),
          ) : null,
          React.createElement('button', {
            type: 'button',
            className: 'ftai-report-view-icon-button',
            title: focusMode ? '退出全屏阅读' : '进入全屏阅读',
            'aria-label': focusMode ? '退出全屏阅读' : '进入全屏阅读',
            'aria-pressed': focusMode,
            onClick: () => setFocusMode(value => !value),
          }, React.createElement(focusMode ? IconCloseOutline16 : IconFullscreenOutline16, { size: 16 })),
        ),
      ),
      selected
        ? React.createElement('div', { className: 'ftai-report-view-frame-wrap' },
          React.createElement(ReportDocumentFrame, {
            report: selected.report,
            key: selected.callId,
            className: 'ftai-report-view-frame',
            title: `${label}完整报告`,
            srcDoc: selected.report.html,
            sandbox: 'allow-scripts allow-popups',
            referrerPolicy: 'no-referrer',
          }),
        )
        : React.createElement('div', { className: 'ftai-report-view-empty', role: 'status' }, '当前会话中没有已加载的投研报告。'),
      )
    }

    function ReportRow(props) {
      const { block, inspect, openView } = props
      const openDetails = props.openReportSidebar
      const state = stateOf(block)
      const report = reportMetaOf(block)
      const args = argsOf(block)
      const text = resultText(block)
      // Older Client compositions did not always forward the standard owner
      // identity to custom views. The lifecycle block is authoritative, so
      // use it as a safe fallback instead of opening an unresolvable selection.
      const callId = typeof props.callId === 'string' && props.callId !== '' ? props.callId : block?.callId
      const callToolName = typeof props.toolName === 'string' && props.toolName !== '' ? props.toolName : toolNameOf(block)
      const symbol = report?.symbol || (typeof args.symbol === 'string' ? firstLine(args.symbol) : '')
      const reportType = report?.reportType || (typeof args.reportType === 'string' ? args.reportType : '')
      const summary = state === 'running'
        ? '正在生成…'
        : `${symbol || '报告'}${reportType ? ` · ${REPORT_TYPE_LABELS[reportType] || reportType}` : ''}`
      const [expanded, setExpanded] = React.useState(false)
      const expandable = report !== null || text !== null
      const open = expanded && expandable
      const body = report
        ? React.createElement('div', { className: 'ftai-report-body' },
          React.createElement('div', { className: 'ftai-report-toolbar' },
            React.createElement('span', null, `${report.asOf ? `${report.asOf} · ` : ''}${report.status || '已生成'}`),
            React.createElement('div', { className: 'ftai-report-toolbar-actions' },
              openDetails ? React.createElement('button', {
                type: 'button',
                className: 'ftai-report-open-details',
                onClick: (event) => {
                  event.stopPropagation()
                  if (typeof callId === 'string' && callId !== '') openDetails(callId, callToolName)
                },
              }, React.createElement(IconChevronDownOutline14, { size: 12 }), '在右侧打开') : null,
              React.createElement('select', {
                className: 'ftai-report-result-export',
                value: '',
                'aria-label': '导出为',
                onClick: event => event.stopPropagation(),
                onChange: event => {
                  event.stopPropagation()
                  const format = event.target.value
                  if (format === 'html') downloadReport(report)
                  if (format === 'pdf') downloadPdfReport(report)
                  if (format === 'png') downloadPngReport(report)
                },
              },
                React.createElement('option', { value: '' }, '导出为'),
                React.createElement('option', { value: 'html' }, 'HTML'),
                React.createElement('option', { value: 'pdf' }, 'PDF'),
                React.createElement('option', { value: 'png' }, 'PNG'),
              ),
            ),
          ),
          inspect ? React.createElement('div', { className: 'ftai-report-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'ftai-report-inspect',
              onClick: inspect,
            }, React.createElement(IconInspectOutline12), 'Inspect'),
          ) : null,
        )
        : text
          ? React.createElement('div', { className: 'ftai-report-body' }, React.createElement('pre', { className: 'ftai-report-fallback' }, text))
          : null
      return React.createElement('div', { className: 'ftai-report-card', 'data-state': state, 'data-tool': props.toolName },
        React.createElement(DisclosureRow, {
          icon: leading(state),
          title: '投研报告',
          open,
          expandable,
          keepContentWhenOpen: false,
          onToggle: () => setExpanded(value => !value),
          rowClassName: 'ftai-report-row',
          leadingClassName: 'ftai-report-leading',
          titleClassName: 'ftai-report-title',
          chevronClassName: 'ftai-report-chevron',
          collapsedContent: React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'ftai-report-separator', 'aria-hidden': true }),
            React.createElement('span', { className: 'ftai-report-summary' }, summary),
            report && typeof callId === 'string' && callId !== '' && (openView || openDetails) ? React.createElement('button', {
              type: 'button',
              className: 'ftai-report-open-view',
              onClick: (event) => {
                event.stopPropagation()
                // DSH 0.2 no longer hands custom tool views an `openView`
                // seat; the report View is reachable from the conversation
                // view tabs and the FFT Sidebar tab.
                if (typeof openView === 'function') openView(REPORT_VIEW_ID, callId)
                else if (typeof openDetails === 'function') openDetails(callId, callToolName)
              },
            }, React.createElement(IconFullscreenOutline16, { size: 14 }), '打开报告') : null,
            report && typeof callId === 'string' && callId !== '' && openDetails ? React.createElement('button', {
              type: 'button',
              className: 'ftai-report-open-details-compact',
              onClick: (event) => {
                event.stopPropagation()
                openDetails(callId, callToolName)
              },
            }, React.createElement(IconChevronDownOutline14, { size: 12 }), '在右侧打开') : null,
          ),
        }, body),
      )
    }

    const FFT_REPORT_TAB = 'ft-research-cockpit:report'

    function FFTReportTab({ source, tab, sessionId }) {
      const snapshot = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
      const entry = tab.meta?.sessionId === sessionId && snapshot
        ? reportEntriesOf(snapshot.nodes.values()).find(item => item.callId === tab.meta.callId)
        : undefined
      return React.createElement('div', { className: 'ftai-fft-report-tab', style: { minWidth: 0, padding: '12px', boxSizing: 'border-box' } },
        entry ? React.createElement(ReportDetails, { block: entry.block })
          : React.createElement('p', { role: 'status' }, '当前会话尚未加载这份报告，请打开对应报告消息。'),
      )
    }

    // FFT Sidebar (dsh-better-sidebar) is optional and may activate after this
    // plugin, so its handle is resolved through the service scope and read
    // lazily inside the callbacks instead of gating every registration on it.
    let sidebar = null
    let uiConversation = null

    function apply(ctx) {
      ctx.inject(['betterSidebar', 'uiConversation'], fft => {
        sidebar = fft.betterSidebar
        uiConversation = fft.uiConversation
        fft.effect(() => sidebar.registerTab({
          id: FFT_REPORT_TAB,
          title: '投研报告',
          hidden: true,
          dedupeKey: tab => tab.id,
          component: ({ scope, tab }) => React.createElement(FFTReportTab, {
            source: uiConversation.binding(scope.sessionId).target('chat'),
            sessionId: scope.sessionId,
            tab,
          }),
        }))
      })

      const injectSidebar = sessionId => ({
        openReportSidebar: callId => {
          if (sidebar === null || uiConversation === null) throw new Error('请先安装并启用 FFT Sidebar')
          const snapshot = uiConversation.binding(sessionId).target('chat').getSnapshot()
          const entry = snapshot && reportEntriesOf(snapshot.nodes.values()).find(item => item.callId === callId)
          if (!entry) throw new Error('当前会话未加载这份报告')
          if (!sidebar.isTabEnabled(FFT_REPORT_TAB)) throw new Error('请先在 FFT Sidebar 设置中启用投研报告')
          sidebar.openTab({
            type: FFT_REPORT_TAB,
            id: `${FFT_REPORT_TAB}:${callId}`,
            title: reportEntryLabel(entry),
            path: `ft-report://${encodeURIComponent(sessionId)}/${encodeURIComponent(callId)}`,
            meta: { sessionId, callId },
          }, { sessionId })
        },
      })

      for (const key of REPORT_TOOL_NAMES) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview', key, priority: -20, inject: injectSidebar,
        }, ReportRow))
      }
      // The full report reads inside the conversation: the view tabs own the
      // selection, so the entry needs no injected callbacks beyond the
      // framework's standard session kit.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: REPORT_VIEW_ID,
        order: 5,
        label: '报告',
      }, ReportView))
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: 'ft-research-cockpit:turn-tail',
        priority: -20,
        inject: injectSidebar,
      }, ReportResult))
    }

    const inject = ['slots']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
