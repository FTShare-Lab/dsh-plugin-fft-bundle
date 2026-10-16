/**
 * 投影面的证据。
 *
 * 断言的不是「函数能跑」，而是四件事：
 * 1. **修复前**的摘要行长什么样（`fetch_candles · 600519.XSHG · 220 bars`），**修复后**长什么样；
 * 2. 明细真的被投影出来了（收盘价、自选明细），而摘要里根本没有；
 * 3. 空结果写成「无数据」而不是 `0`（P8 的形态），形状不符时**原样放行**；
 * 4. 三个 FTShare wrapper（`security_intelligence` / `market_pulse` /
 *    `market_board_detail`）不再由本行接管——它们由 `./mask` 从模型可见面掩掉。
 *
 * fixture 的形状抄自 `@ftshare-lab/dsh-kline` 的真实载荷。
 */
import assert from 'node:assert/strict'
import {
  apply,
  isProjectedTool,
  mcpToolNameOf,
  projectContent,
  renderGenericPayload,
  renderProjection,
} from '../lib/project.js'

/** 修复前模型看到的那一行（`server.py` 里 `fetch_candles` 的摘要）。 */
const BEFORE_TEXT = 'fetch_candles · 600519.XSHG · 220 bars · source=ftshare'

/** 保留工具的真实形状载荷：标量 + 数组。 */
const CANDLES = {
  ok: true,
  cached: false,
  symbol: '600519.XSHG',
  interval: 'day',
  count: 220,
  source: { name: 'FTShare', status: 'retrieved', updated_at: '2026-10-13 06:00 UTC' },
  rows: [
    { time: 1790000000, close: 1274.89 },
    { time: 1790086400, close: 1270.1 },
  ],
}

const PUBLIC_NAME = 'mcp__dsh-kline__fetch_candles'

// —— 修复前的现场：摘要里只有条数，明细一个字都没有 ——
assert.equal(mcpToolNameOf(PUBLIC_NAME).tool, 'fetch_candles')
assert.ok(BEFORE_TEXT.includes('220 bars'), '修复前的摘要必须包含裸计数才能作为对照')
assert.ok(!BEFORE_TEXT.includes('1274.89'), '修复前的摘要里不该有收盘价')

// —— 修复后的对照 ——
const after = renderProjection(PUBLIC_NAME, { content: [{ type: 'text', text: BEFORE_TEXT }], structuredContent: CANDLES })
assert.ok(after, '真实形状的载荷必须渲染出内容')
assert.ok(after.includes('symbol：600519.XSHG'), '标量字段必须完整渲染')
assert.ok(after.includes('close 1274.89'), '非情报卡片形状的行也要如实摊开')
assert.ok(after.includes('rows（2 条）'), '数组必须摊开')
assert.ok(after.includes('数据源 FTShare · 2026-10-13 06:00 UTC'), '出处必须带上')
assert.ok(!after.includes('220 bars'), '投影结果里不该出现裸计数摘要')
// —— 空结果写「无数据」而不是 0（P8）——
assert.equal(renderGenericPayload({ ok: true, data: [] }), 'data：无数据', '空数组写「无数据」而不是 0')
assert.equal(renderGenericPayload({ ok: true, items: [] }), 'items：无数据', '空数组写「无数据」，不写 0')
assert.ok(!renderGenericPayload({ ok: true, items: [] }).includes('=0'))
console.log('[投影对照] 修复前：', BEFORE_TEXT)
console.log('[投影对照] 修复后：\n' + after)

// —— 条数上限 ——
const many = renderGenericPayload({ ok: true, rows: Array.from({ length: 20 }, (_, index) => ({ time: index, close: 1000 + index })) })
assert.ok(many.includes('rows（20 条）'), '数组条数要报全')
assert.equal(many.split('\n').filter(line => /^\d+\. /u.test(line)).length, 8, '最多渲染 8 条')
assert.ok(many.includes('共 20 条，此处只显示前 8 条'), '截断必须显式说明')

// —— 没有任何可渲染内容时必须原样放行 ——
for (const weird of [undefined, null, 42, 'text', [], { ok: true }]) {
  assert.equal(renderProjection(PUBLIC_NAME, weird), undefined, `无可渲染内容必须放行：${JSON.stringify(weird)}`)
}
assert.equal(renderProjection(PUBLIC_NAME, { foo: 'bar' }), 'foo：bar', '单字段对象是可渲染的形状')
assert.equal(renderProjection('mcp__other-server__fetch_candles', CANDLES), undefined, '别的 MCP 服务器不归本包管')
assert.equal(renderProjection('bash', CANDLES), undefined, '非 MCP 工具不归本包管')
assert.equal(renderProjection('mcp__dsh-kline__analyze_kline', CANDLES), undefined, '带有自足正文的工具不接管')

// —— 三个 FTShare wrapper 已经交给 mask，本行不再接管 ——
for (const tool of ['security_intelligence', 'market_pulse', 'market_board_detail']) {
  assert.ok(!isProjectedTool(tool), `${tool} 已掩码，不该再出现在投影面`)
  assert.equal(renderProjection(`mcp__dsh-kline__${tool}`, { flows: [] }), undefined, `${tool} 不该被投影`)
}

// —— 嵌套对象与自选清单 ——
const watchlist = renderProjection('mcp__dsh-kline__get_watchlist', {
  structuredContent: { ok: true, watchlist: { activeGroupId: 'g1', items: [{ symbol: '600519.XSHG', name: '贵州茅台' }] } },
})
assert.ok(watchlist.includes('watchlist.items（1 条）'), '嵌套数组必须递归摊开')
assert.ok(watchlist.includes('600519.XSHG'), '自选明细必须可见')

// —— projectContent：只换文本块，非文本块保留；失败结果放行 ——
const content = projectContent(PUBLIC_NAME, {
  isError: false,
  value: { content: [], structuredContent: CANDLES },
  content: [{ type: 'text', text: BEFORE_TEXT }, { type: 'image', source: { data: 'x' } }],
})
assert.equal(content.length, 2, '文本块被替换、图片块保留')
assert.equal(content[0].type, 'image')
assert.equal(content[1].type, 'text')
assert.ok(content[1].text.includes('close 1274.89'))
assert.equal(projectContent(PUBLIC_NAME, { isError: true, content: [] }), undefined, '失败结果必须放行')
assert.equal(
  projectContent(PUBLIC_NAME, { isError: false, value: { structuredContent: { ok: true } }, content: [] }),
  undefined,
  '没有可渲染内容时必须放行',
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
  value: { content: [{ type: 'text', text: BEFORE_TEXT }], structuredContent: CANDLES },
  content: [{ type: 'text', text: BEFORE_TEXT }],
}
const unchanged = { kind: 'accept' }
const matched = await listeners[0].listener(exec, successResult, () => Promise.resolve(unchanged))
assert.equal(matched.kind, 'accept', '命中时仍是 accept，绝不是 block')
assert.equal(matched.value, undefined, '绝不能同时给出 value（会抛 TypeError）')
assert.ok(matched.content[0].text.includes('close 1274.89'), '模型可见文本被换成明细')
assert.ok(!matched.content[0].text.includes('220 bars'))

const unmatchedExec = { name: 'mcp__dsh-kline__search_symbols' }
const unmatched = await listeners[0].listener(unmatchedExec, successResult, () => Promise.resolve(unchanged))
assert.equal(unmatched, unchanged, '未接管的工具必须原样返回 next 的决定')

const maskedExec = { name: 'mcp__dsh-kline__security_intelligence' }
const maskedResult = { isError: false, value: { content: [{ type: 'text', text: 'security_intelligence · 600519.XSHG · flows=10 · events=0' }], structuredContent: { flows: [] } }, content: [] }
const masked = await listeners[0].listener(maskedExec, maskedResult, () => Promise.resolve(unchanged))
assert.equal(masked, unchanged, '已掩码的 wrapper 不再由本行投影（它根本不该被调用到）')

const weirdResult = { isError: false, value: { content: [], structuredContent: { ok: true } }, content: [] }
const passthrough = await listeners[0].listener(exec, weirdResult, () => Promise.resolve(unchanged))
assert.equal(passthrough, unchanged, '形状不符必须原样放行')
assert.equal(warnings.length, 1, '形状不符必须记一条 warn')
assert.equal(warnings[0].message, 'ftshare.projection_shape_mismatch')

const blocked = { kind: 'block', feedback: [{ type: 'text', text: 'denied by policy' }] }
const afterBlock = await listeners[0].listener(exec, successResult, () => Promise.resolve(blocked))
assert.equal(afterBlock, blocked, '下游已经判成失败时不许改写它的决定')

const replaced = { kind: 'accept', value: { anything: true } }
const afterReplace = await listeners[0].listener(exec, successResult, () => Promise.resolve(replaced))
assert.equal(afterReplace, replaced, '下游整块替换 value 之后不许再动 content')

console.log('projection: detail rendering, no bare counts, length caps, mask handoff, passthrough and hook behaviour passed')
