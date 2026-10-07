import { fallbackContext, generateTemplateReport, marketBreadthFromFacts, phaseLabelFor } from '../lib/llm-report.js'

function facts(overrides = {}) {
  return {
    reportType: 'market_commentary',
    asOf: '2026-09-03',
    request: { reportType: 'market_commentary', phase: 'midday' },
    snapshots: [], market: [], indices: [], sectors: [], constituents: [], flows: [], limits: [],
    announcements: [], news: [], raw: {}, provenance: [], permissions: [], blockedPermissions: [], dataGaps: [], warnings: [],
    ...overrides,
  }
}

const aggregate = facts({
  market: [
    { symbol: '000001', change_rate: 1.2 },
    { up_count: '2,341', down_count: 3047, flat_count: '167', limit_up_count: 45, limit_down_count: 10 },
  ],
  // Duplicate event/list rows must not inflate the fallback when status is
  // available, although the aggregate market snapshot remains authoritative.
  limits: [
    { symbol: '000001', status: 'limit_up' },
    { symbol: '000001', status: 'limit_up' },
    { symbol: '000002', status: 'limit_down' },
  ],
})
const breadth = marketBreadthFromFacts(aggregate)
if (breadth.up_count !== 2341 || breadth.down_count !== 3047 || breadth.flat_count !== 167) throw new Error(`aggregate breadth mismatch: ${JSON.stringify(breadth)}`)
if (breadth.limit_up_count !== 45 || breadth.limit_down_count !== 10) throw new Error(`aggregate limit mismatch: ${JSON.stringify(breadth)}`)
if (Math.round(breadth.up_width_pct * 100) / 100 !== 42.14) throw new Error(`unexpected up width: ${breadth.up_width_pct}`)

const fallback = fallbackContext(aggregate)
if (fallback.phase_label !== '午盘点评' || fallback.phase_key !== 'midday') throw new Error(`midday phase mismatch: ${JSON.stringify({ phase_label: fallback.phase_label, phase_key: fallback.phase_key })}`)
if (fallback.breadth.up_count !== 2341 || fallback.breadth.down_count !== 3047 || fallback.breadth.limit_up_count !== 45 || fallback.breadth.limit_down_count !== 10) throw new Error(`fallback values mismatch: ${JSON.stringify(fallback.breadth)}`)
const fallbackText = JSON.stringify(fallback)
if (/基于 FTShare 市场|FTShare 市场数据|FTShare 涨停池/.test(fallbackText)) throw new Error(`fallback overstates FTShare provenance: ${fallbackText}`)

const classified = facts({
  market: [],
  limits: [
    { stock_code: '000001', status: 'limit_up' },
    { stock_code: '000001', status: 'limit_up' },
    { stock_code: '000002', status: 'limit_down' },
  ],
})
const classifiedBreadth = marketBreadthFromFacts(classified)
if (classifiedBreadth.limit_up_count !== 1 || classifiedBreadth.limit_down_count !== 1) throw new Error(`classified limit mismatch: ${JSON.stringify(classifiedBreadth)}`)

const unavailable = marketBreadthFromFacts(facts({ market: [{ symbol: '000001', change_rate: 2.4 }], limits: [{ symbol: '000001' }] }))
if (unavailable.up_count !== '当前模块尚无可核验事实，待数据接入后更新。' || unavailable.down_count !== '当前模块尚无可核验事实，待数据接入后更新。') throw new Error(`individual stock rows were counted: ${JSON.stringify(unavailable)}`)

if (phaseLabelFor('midday').label !== '午盘点评' || phaseLabelFor('after_close').label !== '收盘后') throw new Error('phase label mapping mismatch')

const hallucinatedPatch = {
  title: 'AI 市场点评',
  desc: '截至2026-09-03午盘，上涨911家，下跌3419家，涨停46家，跌停14家。',
  conclusion: '涨停46家但跌停14家，市场偏弱。',
  sector_insight: '板块数据不足',
  capital_insight: '资金数据不足',
  etf_insight: 'ETF 数据不足',
  judgements: [{ tone: 'neutral', label: '宽度', title: '下跌占优', body: '上涨911家、下跌3419家。' }],
  drivers: [{ tone: 'neutral', title: '市场宽度', score_label: '偏弱', summary: '跌停14家。', evidence: [] }],
}
const hallucinationLlm = {
  async *stream() {
    const text = JSON.stringify(hallucinatedPatch)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const guarded = await generateTemplateReport(
  hallucinationLlm,
  'market_commentary',
  facts({ market: [{ limit_up_count: 46 }] }),
  { provider: 'fake', model: 'fake', maxAttempts: 1 },
  new AbortController().signal,
)
const guardedText = JSON.stringify(guarded.context)
if (guardedText.includes('911') || guardedText.includes('3419') || guardedText.includes('跌停14')) throw new Error(`unsupported market counts survived LLM guard: ${guardedText}`)
if (!guardedText.includes('46')) throw new Error('verified limit-up count was lost by LLM guard')

const qualitativeCountPatch = {
  title: 'AI 市场点评',
  desc: '涨停股数量较多，盘中多次开板。',
  conclusion: '个股跌多涨少，涨停家数多于跌停，市场偏强。',
  sector_insight: '板块数据不足',
  capital_insight: '资金数据不足',
  etf_insight: 'ETF 数据不足',
}
const qualitativeCountLlm = {
  async *stream() {
    const text = JSON.stringify(qualitativeCountPatch)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const qualitativeGuarded = await generateTemplateReport(
  qualitativeCountLlm,
  'market_commentary',
  facts({ market: [{ limit_up_count: 46 }] }),
  { provider: 'fake', model: 'fake', maxAttempts: 1 },
  new AbortController().signal,
)
const qualitativeGuardedText = JSON.stringify(qualitativeGuarded.context)
if (qualitativeGuardedText.includes('涨停股数量较多') || qualitativeGuardedText.includes('个股跌多涨少') || qualitativeGuardedText.includes('涨停家数多于跌停')) throw new Error(`unsupported qualitative market comparison survived LLM guard: ${qualitativeGuardedText}`)

const sourceHeavyPatch = {
  title: 'AI 市场点评',
  desc: '根据 FTShare 数据，市场维持震荡。',
  conclusion: 'FTShare数据显示，市场情绪偏谨慎。',
  sector_insight: '基于 FTShare 数据，板块表现分化。',
  capital_insight: 'FTShare 数据表明，资金偏谨慎。',
  etf_insight: '根据FTShare数据，ETF 表现分化。',
  judgements: [{ tone: 'neutral', label: '宽度', title: '分化', body: '根据FTShare数据，市场宽度偏弱。' }],
  drivers: [{ tone: 'neutral', title: '市场宽度', score_label: '观察', summary: 'FTShare数据显示，结构仍待改善。', evidence: [] }],
}
const sourceHeavyLlm = {
  async *stream() {
    const text = JSON.stringify(sourceHeavyPatch)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const sourceBalanced = await generateTemplateReport(
  sourceHeavyLlm,
  'market_commentary',
  aggregate,
  { provider: 'fake', model: 'fake', maxAttempts: 1 },
  new AbortController().signal,
)
const sourceBalancedText = JSON.stringify(sourceBalanced.context)
if (/根据\s*FTShare\s*数据|基于\s*FTShare\s*数据|FTShare\s*数据(?:显示|表明|反映)/i.test(sourceBalancedText)) throw new Error(`repeated FTShare preface survived prose cleanup: ${sourceBalancedText}`)
if (!sourceBalancedText.includes('市场维持震荡') || !sourceBalancedText.includes('板块表现分化')) throw new Error('prose cleanup removed the market judgement itself')

console.log('market-commentary fallback: ok')
