import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { renderReportHtml, renderReportTemplate } from '../lib/html-renderer.js'
import { calculateTechnicalSignals } from '../lib/indicators.js'
import { fallbackContext } from '../lib/llm-report.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = resolve(process.env.PERMISSION_QA_DIR || join(tmpdir(), 'ft-permission-qa'))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const cases = ['deep_read', 'holding_analysis', 'limit_up_attribution', 'market_commentary', 'portfolio_etfs', 'portfolio_stocks', 'review', 'sector_analysis'].filter(name => !process.env.QA_REPORTS || process.env.QA_REPORTS.split(',').includes(name))
const notice = tool => ({ tool, requiredPlan: 'Pro', message: '权限不足', upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription' })
const base = { asOf: '2026-09-07', snapshots: [], market: [], indices: [], sectors: [], constituents: [], flows: [], limits: [], announcements: [], news: [], raw: {}, provenance: [], permissions: [], blockedPermissions: [], dataGaps: [], warnings: [] }
const deep = { base_data: { date: base.asOf, stock: { name: '验收样本', symbol_id: '300750', price: null } }, llm_content: null, quant_data: { financial: null, valuation: null, announcements: [], research: [] }, kline_data: [], kline_indicator_data: { boll: {}, macd: {}, kdj: {}, coverage: {} }, t0_data: null, data_gaps: [], provenance: [] }
const points = [
  { date: '2026-09-04', open: 100, high: 110, low: 98, close: 108, volume: 1000 },
  { date: '2026-09-07', open: 109, high: 125, low: 107, close: 123, volume: 1500 },
]
const snapshot = { symbol: '300750', name: '验收样本', asOf: base.asOf, quote: { close: 123, industry: '半导体' }, ohlcv: points, financial: { income: [{ revenue: 100000000, net_profit: 10000000 }], cashflow: [{ operating_cashflow: 12000000 }] }, valuation: { pe_ttm: 20, pb: 3 }, announcements: [], research: [], provenance: [], permissions: [], blockedPermissions: [], dataGaps: [], warnings: [] }
const populated = { ...base, snapshots: [snapshot], market: [{ up_count: 2500, down_count: 1500, flat_count: 100, limit_up_count: 60, limit_down_count: 5 }, { etf_code: '510300', etf_name: '验收ETF', change_rate: 1.2 }], indices: points.map(p => ({ ...p, symbol: '510300', asset_type: 'etf' })), sectors: [{ name: '半导体', industry_name: '半导体', change_rate: 2.5, pe: 30 }], flows: [{ stock_code: '300750', stock_name: '验收样本', main_net: 100000000 }], constituents: [{ code: '300750', name: '验收样本' }] }
const results = []
try {
  for (const reportType of cases) {
    const request = { reportType, symbol: '300750', symbols: [reportType === 'portfolio_etfs' ? '510300' : '300750'], holdings: [{ symbol: reportType === 'portfolio_etfs' ? '510300' : '300750', name: '验收样本', quantity: 10, costPrice: 100 }], sectorCode: 'BK1036', sectorName: '半导体', phase: 'after_close', itemType: 'stock' }
    const render = (permissions, withData = false) => reportType === 'deep_read'
      ? renderReportHtml(withData ? { ...deep, base_data: { ...deep.base_data, stock: { ...deep.base_data.stock, price: 123 } }, kline_data: points, kline_indicator_data: calculateTechnicalSignals(points) } : deep, permissions)
      : renderReportTemplate(reportType, fallbackContext({ ...(withData ? populated : base), reportType, request }), permissions)
    const seed = await render([notice('test')])
    const payload = JSON.parse(seed.match(/const payload = (.*);/)[1])
    const tools = [...new Set(payload.targets.flatMap(target => target.tools))]
    // denied 与 empty 不可混同：凭据/套餐被拒才出现升级入口；上游「没有数据」只是
    // 数据缺口，绝不能渲染成升级提示。这里对同一张报告直接把两种输入并排断言。
    const deniedHtml = await render(tools.map(tool => notice(tool)))
    if (!deniedHtml.includes('ftshare-module-mask-script') || !deniedHtml.includes('升级 FtShare 订阅')) {
      throw new Error(`${reportType}: denied 必须渲染无权访问 + 升级入口`)
    }
    const emptyGap = 'FTShare 数据为空：ft_v1_daec_market_snapshot'
    const emptyHtml = reportType === 'deep_read'
      ? await renderReportHtml({ ...deep, data_gaps: [emptyGap] })
      : await renderReportTemplate(reportType, fallbackContext({ ...base, reportType, request, dataGaps: [emptyGap] }), [], [emptyGap])
    if (emptyHtml.includes('ftshare-module-mask-script') || emptyHtml.includes('升级 FtShare 订阅')) {
      throw new Error(`${reportType}: empty 只表示没有数据，不得出现升级入口`)
    }
    for (const mode of ['denied', 'partial', 'available']) {
      const permissions = mode === 'available' ? [] : tools.map(tool => ({ ...notice(tool), partial: mode === 'partial' }))
      const html = await render(permissions, mode !== 'denied')
      const file = join(output, `${reportType}-${mode}.html`)
      await writeFile(file, html)
      for (const width of [375, 705, 768, 1280, 1640]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle', timeout: 30000 })
        const state = await page.evaluate(() => {
          const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden'
          const masks = [...document.querySelectorAll('[data-ftshare-mask="true"]')]
          const bad = []
          for (const mask of masks) {
            const host = mask.parentElement
            const hr = host.getBoundingClientRect()
            const mr = mask.getBoundingClientRect()
            const card = mask.firstElementChild;
            if (getComputedStyle(card).display === 'flex') {
              const centers = [...card.children].map(e => { const r=e.getBoundingClientRect(); return r.left+r.width/2 });
              if (Math.max(...centers)-Math.min(...centers)>2) bad.push('misaligned mask card');
            }
            if (!visible(mask) || mr.width < 100 || mr.height < 100) bad.push('invisible mask: ' + host.className)
            for (const element of mask.querySelectorAll('strong,p,a,svg')) {
              const r = element.getBoundingClientRect()
              if (r.left < hr.left - 1 || r.right > hr.right + 1 || r.top < hr.top - 1 || r.bottom > hr.bottom + 1) bad.push('clipped: ' + element.textContent)
            }
          }
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, maskCount: masks.length, bad, headings: [...document.querySelectorAll('h2')].map(x => x.textContent.trim()) }
        })
        results.push({ reportType, mode, ...state, errors })
        if (width === 1280 && mode === 'denied') await page.screenshot({ path: join(output, `${reportType}.png`), fullPage: true })
        await page.close()
      }
    }
    // Every declared dependency independently causes a visible surface,
    // including conditional/missing targets and unrecognized future endpoints.
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    for (const tool of [...tools, 'ft_v9_future_dataset']) {
      await page.setContent(await render([notice(tool)]), { waitUntil: 'domcontentloaded' })
      assert(await page.locator('[data-ftshare-mask="true"]').evaluateAll(items => items.some(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0)), `${reportType}: silently dropped ${tool}`)
      if (reportType === 'deep_read' && tool === 'ft_v4_stock_realtime_day_kline') {
        assert.equal(await page.locator('#kline-chart.ftshare-mask-host').count(), 0, 'Realtime denial must not mask historical candles')
        assert.equal(await page.locator('.report-price > [data-ftshare-mask]').count(), 1, 'Missing quote must be covered in place')
      }
      if (reportType === 'portfolio_etfs' && tool === 'ft_v4_etf_realtime_day_kline') assert.equal(await page.locator('#summaryStocks > [data-ftshare-mask]').count(), 1, 'ETF summary quote permission must be covered')
    }
    // The same endpoint may succeed for one symbol and fail for another.
    // A partial notice must cover an empty module itself, not its neighbour.
    const target = payload.targets.find(target => target.tools.length);
    const partialHtml = await render([{ ...notice(target.tools[0]), partial: true }]);
    const script = partialHtml.match(/<script id="ftshare-module-mask-script">[\s\S]*?<\/script>/)[0];
    const isolatedScript = script.replace(/const payload = .*;/, 'const payload = ' + JSON.stringify({ ...payload, permissions: [{...notice(target.tools[0]), partial:true}], targets: [{...target, selector:'#partial-test'}] }) + ';');
    await page.setContent('<div id="partial-test"><h3>数据模块 1</h3><p>暂无数据</p></div>' + isolatedScript);
    assert.equal(await page.locator('#partial-test > [data-ftshare-mask]').count(),1,reportType + ': empty partial module must be masked in place');
    assert.equal(await page.locator('[data-ftshare-partial-key]').count(),0,reportType + ': no detached mask beside empty content');
    await page.setContent('<div id="partial-test"><p data-semantic="neutral">0.00%</p></div>' + isolatedScript);
    assert.equal(await page.locator('#partial-test > [data-ftshare-mask]').count(),0,reportType + ': valid zero must remain readable');
    assert.equal(await page.locator('[data-ftshare-partial-key] > [data-ftshare-mask]').count(),1);
    if (reportType === 'sector_analysis') {
      await page.setContent(await render([notice('ft_v3_supply_chain_subindustry_supply_chain')], true), {waitUntil:'domcontentloaded'})
      assert.equal(await page.locator('#drivers [data-driver-source="chain"] > [data-ftshare-mask="true"]').count(),1,'Chain permission must mask its driver card')
      assert.equal(await page.locator('#drivers [data-driver-source="capital"] > [data-ftshare-mask="true"]').count(),0,'Chain denial must not hide available capital facts')
      const broken = fallbackContext({...populated,reportType,request})
      broken.report.drivers[1] = {index:2,title:'',summary:'',confidence:'中',evidence:[{label:'资金净额',text:'净流入 100'}]}
      await page.setContent(await renderReportTemplate(reportType,broken,[]),{waitUntil:'domcontentloaded'})
      assert.equal(await page.locator('#drivers [data-driver-source="capital"] h3').textContent(),'资金流向')
      assert((await page.locator('#drivers [data-driver-source="capital"] .driver-summary').textContent()).includes('最新资金净额'))
      assert.equal(await page.locator('.order-flow-values').count(),0,'No fake gross buy/sell placeholders for a net-only source')
      assert.equal(await page.locator('#capital-order-structure [data-ftshare-mask="true"]').count(),0,'No upgrade claim without a denial')
    }
    await page.close()
    console.log(`${reportType}: 15 viewport/state checks, ${tools.length + 1} isolated permission checks`)
  }
} finally { await browser.close() }
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
const failures = results.filter(r => r.scrollWidth > r.width || r.bad.length || r.errors.length || (r.mode !== 'available' && !r.maskCount) || (r.mode === 'available' && r.maskCount))
console.log(JSON.stringify({ output, checks: results.length, failures }, null, 2))
assert.equal(failures.length, 0, 'Permission rendering QA failed')
