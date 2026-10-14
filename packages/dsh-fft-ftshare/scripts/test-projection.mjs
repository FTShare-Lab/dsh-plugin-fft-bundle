/**
 * P7/P8 的对照证据。
 *
 * 断言的不是「函数能跑」，而是三件事：
 * 1. **修复前**的摘要行长什么样（`flows=10 · events=0`），**修复后**长什么样；
 * 2. 明细真的被投影出来了（金额、日期、占比、收盘），而摘要里根本没有；
 * 3. 三态措辞各自正确，且形状不符时**原样放行**（返回 `next()` 的决定）。
 *
 * fixture 的形状抄自 `@ftshare-lab/dsh-kline` 的真实载荷
 * （`tools/fetch.py` 的 `fetch_security_intelligence` 与
 * `_intelligence_section_state`）：`events` 是被网关 403 拒绝的一段，`errors[0].code`
 * 实测为 `capability_limited`。
 */
import assert from 'node:assert/strict'
import {
  apply,
  mcpToolNameOf,
  projectContent,
  renderGenericPayload,
  renderMarketBoardDetail,
  renderMarketPulse,
  renderProjection,
  renderSecurityIntelligence,
} from '../lib/project.js'

/** 真实形状的资金流条目：日期 + 净额 + 占比 + 收盘。 */
const flow = index => ({
  title: `2026-10-${String(13 - index).padStart(2, '0')}`,
  value: `${(5040.12 - index).toFixed(2)}万`,
  change: `${(1.49 - index * 0.1).toFixed(2)}%`,
  detail: `收盘 ${(1274.89 - index).toFixed(2)} · -1.02%`,
  tone: index > 6 ? 'down' : 'up',
})

/** 个股情报载荷：10 条资金流 + events 为「套餐无权限」。 */
const availableWithDeniedEvents = {
  ok: true,
  cached: false,
  symbol: '600519.XSHG',
  source: { name: 'FTShare', status: 'retrieved', updated_at: '2026-10-13 06:00 UTC' },
  security_intelligence: {
    name: '贵州茅台',
    instrument_type: 'stock',
    sector: {
      industry: '白酒',
      flow: Array.from({ length: 8 }, (_, index) => ({ ...flow(index), detail: `领涨 贵州茅台 2.${index}1%` })),
      peers: Array.from({ length: 12 }, (_, index) => ({
        title: `同业${index + 1}`,
        value: `${(1000 + index).toFixed(2)}万`,
        detail: '白酒',
        change: '1.00%',
      })),
    },
    flows: Array.from({ length: 10 }, (_, index) => flow(index)),
    events: [],
  },
  sections: {
    sector: { state: 'available', errors: [] },
    flows: { state: 'available', errors: [] },
    events: {
      state: 'error',
      errors: [{ code: 'capability_limited', message: 'FTShare API Key 有效，但当前套餐未开通此项数据能力。' }],
    },
  },
}

/** 修复前模型看到的那一行（`server.py` 的 `security_intelligence` 摘要）。 */
const BEFORE_TEXT = 'security_intelligence · 600519.XSHG · flows=10 · events=0'

const PUBLIC_NAME = 'mcp__dsh-kline__security_intelligence'

// —— 修复前的现场：摘要里只有两个计数，明细一个字都没有 ——
assert.equal(mcpToolNameOf(PUBLIC_NAME).tool, 'security_intelligence')
assert.ok(BEFORE_TEXT.includes('events=0'), '修复前的摘要必须包含 events=0 才能作为对照')
assert.ok(!BEFORE_TEXT.includes('5040.12万'), '修复前的摘要里不该有资金流明细')

const after = renderSecurityIntelligence(availableWithDeniedEvents)
assert.ok(after, '真实形状的载荷必须渲染出内容')

// —— 修复后的对照 ——
assert.ok(after.includes('2026-10-13'), '必须逐条渲染日期')
assert.ok(after.includes('净额 5040.12万'), '必须渲染净额')
assert.ok(after.includes('占比 1.49%'), '必须渲染占比')
assert.ok(after.includes('收盘 1274.89'), '必须渲染收盘')
assert.ok(after.includes('所属行业：白酒'), '必须渲染板块联动')
assert.ok(after.includes('领涨 贵州茅台 2.01%'), '板块资金流也要逐条渲染')
assert.ok(after.includes('同业8'), '同类公司只显示前 8 条')
assert.ok(!after.includes('同业12'), '超出上限的同类公司不该出现')

assert.ok(after.includes('无权访问'), '权限失败必须显式说出「无权访问」')
assert.ok(after.includes('当前套餐无权访问该接口（403 route_not_allowed）'), '必须给出网关的真实原因')
assert.ok(after.includes('capability_limited'), '必须保留上游的错误码')
assert.ok(after.includes('不是“没有事件”'), '必须明确否掉「没有事件」这个误读')
assert.ok(!after.includes('events=0'), '绝不能输出 events=0 这类裸计数（P8）')
assert.ok(!after.includes('=0'), '投影结果里不该出现任何 key=0 形态')
assert.ok(!after.includes('flows=10'), '投影结果里不该出现裸计数摘要')

// 条数上限：资金流 10 条、板块 8 条
assert.equal((after.match(/净额 5040/g) ?? []).length, 2, '个股 1 条 + 板块 1 条，不是把 10 条重复渲染')
assert.ok(after.includes('共 12 条，此处只显示前 8 条'), '超上限的同类公司必须显式截断')
assert.equal(after.split('\n').filter(line => /^\d+\. 同业/u.test(line)).length, 8, '同类公司最多 8 条')
assert.equal(after.split('\n').filter(line => /^\d+\. 2026-10/u.test(line)).length, 18, '个股 10 条 + 板块 8 条')
console.log('[P7/P8 对照] 修复前：', BEFORE_TEXT)
console.log('[P7/P8 对照] 修复后：\n' + after)

// —— 三态各自的措辞 ——
const stateOf = eventSection => ({
  ok: true,
  symbol: '600519.XSHG',
  security_intelligence: { name: '贵州茅台', sector: {}, flows: [], events: [] },
  sections: {
    sector: { state: 'not_applicable', errors: [] },
    flows: { state: 'unsupported', errors: [] },
    events: eventSection,
  },
})

const emptyText = renderSecurityIntelligence(stateOf({ state: 'empty', errors: [] }))
assert.ok(emptyText.includes('交易事件：无数据'), 'empty 必须说「无数据」')
assert.ok(emptyText.includes('交易事件：无数据（上游返回成功且没有权限限制'), 'empty 必须说明不是权限问题')
assert.ok(!emptyText.includes('无权访问'), 'empty 不能说成无权访问')

const partialText = renderSecurityIntelligence(stateOf({
  state: 'partial',
  errors: [{ code: 'capability_limited', message: '当前套餐未开通此项数据能力。' }],
}))
assert.ok(partialText.includes('交易事件：部分可用'), 'partial 必须说「部分可用」')
assert.ok(partialText.includes('其中一段无权访问（403 route_not_allowed）'), 'partial 必须指出缺失的那一段是什么原因')
assert.ok(partialText.includes('不是“没有事件”'), 'partial 里也不能让权限失败看起来像空')

const errorText = renderSecurityIntelligence(stateOf({ state: 'error', errors: [{ code: 'rate_limited', message: '请求过于频繁' }] }))
assert.ok(errorText.includes('交易事件：✗ 取数失败（rate_limited：请求过于频繁）'), '普通失败必须与权限失败区分开')
assert.ok(!errorText.includes('无权访问'), '限流不是权限问题，不能写成无权访问')

const unsupportedText = renderSecurityIntelligence(stateOf({ state: 'unsupported', errors: [] }))
assert.ok(unsupportedText.includes('交易事件：该数据源不支持该接口'), 'unsupported 用中性措辞')

// —— 形状不符必须原样放行 ——
for (const weird of [undefined, null, 42, 'text', [], { foo: 'bar' }, { ok: false, error: 'invalid_symbol' }]) {
  assert.equal(renderSecurityIntelligence(weird), undefined, `形状不符必须放行：${JSON.stringify(weird)}`)
  assert.equal(renderProjection(PUBLIC_NAME, weird), undefined, '形状不符时投影必须放行')
}
assert.equal(renderProjection('mcp__other-server__security_intelligence', availableWithDeniedEvents), undefined, '别的 MCP 服务器不归本包管')
assert.equal(renderProjection('bash', availableWithDeniedEvents), undefined, '非 MCP 工具不归本包管')
assert.equal(renderProjection('mcp__dsh-kline__analyze_kline', availableWithDeniedEvents), undefined, '带有自足正文的工具不接管')

// —— 其余摘要式工具：至少不再输出裸计数 ——
const candles = renderProjection('mcp__dsh-kline__fetch_candles', {
  content: [{ type: 'text', text: 'fetch_candles · 600519.XSHG · 220 bars · source=ftshare' }],
  structuredContent: {
    ok: true,
    symbol: '600519.XSHG',
    interval: 'day',
    count: 220,
    rows: [{ time: 1790000000, close: 1274.89 }, { time: 1790086400, close: 1270.1 }],
  },
})
assert.ok(candles.includes('symbol：600519.XSHG'), '标量字段必须完整渲染')
assert.ok(candles.includes('close 1274.89'), '非情报卡片形状的行也要如实摊开')
assert.ok(candles.includes('rows（2 条）'), '数组必须摊开')
assert.equal(renderGenericPayload({ ok: true, data: [] }), 'data：无数据', '空数组写「无数据」而不是 0')
assert.equal(renderGenericPayload({ ok: true, items: [] }), 'items：无数据', '空数组写「无数据」，不写 0')
assert.ok(!renderGenericPayload({ ok: true, items: [] }).includes('=0'))

const watchlist = renderProjection('mcp__dsh-kline__get_watchlist', {
  structuredContent: { ok: true, watchlist: { activeGroupId: 'g1', items: [{ symbol: '600519.XSHG', name: '贵州茅台' }] } },
})
assert.ok(watchlist.includes('watchlist.items（1 条）'), '嵌套数组必须递归摊开')
assert.ok(watchlist.includes('600519.XSHG'), '自选明细必须可见')

// —— market_pulse / market_board_detail 也要显式三态 ——
const pulse = renderMarketPulse({
  ok: true,
  source: { name: 'FTShare', status: 'retrieved', updated_at: '2026-10-13 06:00 UTC' },
  market_pulse: {
    as_of: '2026-10-13',
    breadth: [{ title: '涨停', value: '42', detail: '当日涨停池', change: '', tone: 'up' }],
    flows: [{ title: '北向', value: '1.20亿', change: '0.30%', detail: '净流入' }],
    hot_sectors: [{ title: '半导体', value: '3.40亿', change: '2.10%', detail: '领涨 中芯国际' }],
  },
  sections: {
    breadth: { state: 'available', errors: [] },
    flows: { state: 'available', errors: [] },
    sectors: { state: 'available', errors: [] },
    concepts: { state: 'deferred', errors: [] },
    rankings: { state: 'error', errors: [{ code: 'capability_limited', message: '当前套餐未开通此项数据能力。' }] },
    events: { state: 'empty', errors: [] },
  },
})
assert.ok(pulse.includes('涨停 · 42'), '市场脉搏必须渲染家数而不是只给条数')
assert.ok(pulse.includes('热门概念：本次未请求'), 'deferred 不能被读成空')
assert.ok(pulse.includes('人气与异动榜：✗ 当前套餐无权访问该接口（403 route_not_allowed）'), '榜单无权访问要说清楚')
assert.ok(pulse.includes('异动：无数据'), '异动为空要说「无数据」')

const board = renderMarketBoardDetail({
  ok: true,
  board: {
    name: '白酒',
    code: 'BK0477',
    kind: 'industry',
    snapshot: { title: '白酒', value: '5.04亿', change: '1.49%', detail: '领涨 贵州茅台 3.21%' },
    history: Array.from({ length: 6 }, (_, index) => flow(index)),
    members: [],
  },
  sections: { board: { state: 'available', errors: [] }, members: { state: 'source_dependent', errors: [] } },
  source: { name: 'FTShare', status: 'retrieved', updated_at: '2026-10-13 06:00 UTC' },
})
assert.ok(board.includes('板块详情 · 白酒 · industry'), '板块详情要有标题行')
assert.ok(board.includes('快照：白酒 · 净额 5.04亿'), '快照要逐字段渲染')
assert.ok(board.includes('资金流历史（6 条）'), '历史要摊开')
assert.ok(board.includes('成分股：取决于数据源，暂无数据'), 'source_dependent 用中性措辞')

// —— projectContent：只换文本块，非文本块保留；失败结果放行 ——
const content = projectContent(PUBLIC_NAME, {
  isError: false,
  value: { content: [], structuredContent: availableWithDeniedEvents },
  content: [{ type: 'text', text: BEFORE_TEXT }, { type: 'image', source: { data: 'x' } }],
})
assert.equal(content.length, 2, '文本块被替换、图片块保留')
assert.equal(content[0].type, 'image')
assert.equal(content[1].type, 'text')
assert.ok(content[1].text.includes('净额 5040.12万'))
assert.equal(projectContent(PUBLIC_NAME, { isError: true, content: [] }), undefined, '失败结果必须放行')
assert.equal(
  projectContent(PUBLIC_NAME, { isError: false, value: { structuredContent: { nope: 1 } }, content: [] }),
  undefined,
  '形状不符必须放行',
)

// —— 钩子本体：注册在 tools/post-execute，命中就换文本，不命中就原样返回 next 的决定 ——
const listeners = []
const warnings = []
const ctx = {
  on: (event, listener) => { listeners.push({ event, listener }) },
  logger: () => ({ warn: (message, meta) => warnings.push({ message, meta }) }),
}
apply(ctx)
assert.equal(listeners.length, 1, '必须注册恰好一个钩子')
assert.equal(listeners[0].event, 'tools/post-execute', '钩子必须挂在 tools/post-execute 上')

const exec = { name: PUBLIC_NAME }
const successResult = {
  isError: false,
  value: { content: [{ type: 'text', text: BEFORE_TEXT }], structuredContent: availableWithDeniedEvents },
  content: [{ type: 'text', text: BEFORE_TEXT }],
}
const unchanged = { kind: 'accept' }
const matched = await listeners[0].listener(exec, successResult, () => Promise.resolve(unchanged))
assert.equal(matched.kind, 'accept', '命中时仍是 accept，绝不是 block')
assert.equal(matched.value, undefined, '绝不能同时给出 value（会抛 TypeError）')
assert.ok(matched.content[0].text.includes('净额 5040.12万'), '模型可见文本被换成明细')
assert.ok(!matched.content[0].text.includes('events=0'))

const unmatchedExec = { name: 'mcp__dsh-kline__search_symbols' }
const unmatched = await listeners[0].listener(unmatchedExec, successResult, () => Promise.resolve(unchanged))
assert.equal(unmatched, unchanged, '未接管的工具必须原样返回 next 的决定')

const weirdExec = { name: PUBLIC_NAME }
const weirdResult = { isError: false, value: { content: [], structuredContent: { foo: 'bar' } }, content: [] }
const passthrough = await listeners[0].listener(weirdExec, weirdResult, () => Promise.resolve(unchanged))
assert.equal(passthrough, unchanged, '形状不符必须原样放行')
assert.equal(warnings.length, 1, '形状不符必须记一条 warn')
assert.equal(warnings[0].message, 'ftshare.projection_shape_mismatch')

const blocked = { kind: 'block', feedback: [{ type: 'text', text: 'denied by policy' }] }
const afterBlock = await listeners[0].listener(exec, successResult, () => Promise.resolve(blocked))
assert.equal(afterBlock, blocked, '下游已经判成失败时不许改写它的决定')

const replaced = { kind: 'accept', value: { anything: true } }
const afterReplace = await listeners[0].listener(exec, successResult, () => Promise.resolve(replaced))
assert.equal(afterReplace, replaced, '下游整块替换 value 之后不许再动 content')

console.log('P7/P8 projection: detail rendering, three explicit states, length caps, passthrough and hook behaviour passed')
