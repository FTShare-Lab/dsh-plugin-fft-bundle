/**
 * 跨平面通路的守护测试：宿主路由 + 浏览器助手 + §5.1 契约。
 *
 * 全部在进程内跑：路由收到的是一个真实的 `Request`，客户端发出的 `fetch` 直接接到
 * 路由上，因此「往返之后四态不变形」是被真的验证过的，而不是靠形状约定。
 * 另外静态检查客户端产物：它必须是只读子集，不得出现凭据、网关地址或 node 内置依赖。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createFtshareClient } from '../lib/client.js'
import { asCatalog } from '../lib/catalog.js'
import { FTSHARE_DATA_ROUTE } from '../lib/contract.js'
import { createFtshareRoute } from '../lib/route.js'

const catalog = asCatalog(JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8')))
assert.ok(catalog.entries.length > 0, '目录不能是空的')

const FIXED_SOURCE = { name: 'FTShare', fetchedAt: '2026-10-16T00:00:00.000Z' }

/** 造一个按脚本作答的假宿主服务。 */
function stubData(script) {
  const calls = []
  return {
    calls,
    async call(name, args, options) {
      calls.push({ name, args, signal: options?.signal })
      const answer = script[name]
      if (answer === undefined) throw new Error(`未编排的接口：${name}`)
      return { ...answer, source: answer.source ?? FIXED_SOURCE }
    },
    async listTools() { return [] },
  }
}

/** 客户端 fetch：把请求接到路由上（同源、同一次 Response 语义）。 */
function routeFetch(route) {
  const requests = []
  const impl = async (input, init) => {
    requests.push({ input, init })
    return await route.fetch(new Request(new URL(input, 'http://localhost'), init))
  }
  impl.requests = requests
  return impl
}

/** 造一对「宿主服务 + 路由 + 客户端」。 */
function bridge(script) {
  const data = stubData(script)
  const route = createFtshareRoute(data)
  const fetch = routeFetch(route)
  const client = createFtshareClient({ catalog, fetch, now: () => new Date('2026-10-16T00:00:00.000Z') })
  return { data, route, fetch, client }
}

// —— 四态原样过桥 ——
{
  const { client } = bridge({
    ft_v1_finance_income: { ok: true, state: 'available', rows: [{ revenue: 1 }] },
    ft_v1_finance_balance: { ok: true, state: 'empty', rows: [] },
    ft_v1_eastmoney_stock_valuation: {
      ok: false,
      state: 'denied',
      rows: [],
      notice: {
        code: 'UPSTREAM_PERMISSION_DENIED',
        message: '上游原文：当前套餐无权访问该接口',
        requiredPlan: 'Basic',
        upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription',
        retryable: false,
        upstream: { raw: '{"error":{"code":"UPSTREAM_PERMISSION_DENIED","upstream_code":403}}', status: 403, fingerprint: '0123456789abcdef' },
      },
    },
    ft_v1_margin_trading_details: {
      ok: false,
      state: 'failed',
      rows: [],
      notice: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: '上游原文：最近 1 天最多访问 500 次；请等待 18 小时后再试',
        retryable: true,
        upstream: { raw: '{"error":{"code":"UPSTREAM_UNAVAILABLE","upstream_code":429}}', status: 429, fingerprint: 'fedcba9876543210' },
      },
    },
  })

  const seen = new Set()
  const available = await client.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(available.state, 'available')
  assert.equal(available.rows.length, 1)
  seen.add(available.state)

  const empty = await client.call('ft_v1_finance_balance', { stock_code: '600519' })
  assert.equal(empty.state, 'empty')
  assert.equal(empty.notice, undefined)
  seen.add(empty.state)

  const denied = await client.call('ft_v1_eastmoney_stock_valuation', { symbol: '600519.SH' })
  assert.equal(denied.state, 'denied')
  assert.equal(denied.ok, false)
  assert.equal(denied.notice.upgradeUrl, 'https://ftai.chat/me/profile?tab=subscription', '升级入口必须一起过桥')
  assert.equal(denied.notice.requiredPlan, 'Basic', '档位必须一起过桥')
  assert.equal(denied.notice.retryable, false)
  assert.equal(denied.notice.upstream.status, 403, '上游状态必须一起过桥')
  assert.equal(denied.notice.upstream.fingerprint, '0123456789abcdef', '指纹必须一起过桥')
  seen.add(denied.state)

  const failed = await client.call('ft_v1_margin_trading_details', { stock: '600519.SH', date: '20261015' })
  assert.equal(failed.state, 'failed')
  assert.ok(failed.notice.message.includes('最多访问'), '原文原样过桥')
  assert.equal(failed.notice.upstream.status, 429)
  seen.add(failed.state)

  assert.deepEqual([...seen].sort(), ['available', 'denied', 'empty', 'failed'], '往返后 state 取值集合恰为四种')
}

// —— notice 可以没有码：上游不给码时不编造 ——
{
  const { client } = bridge({
    ft_v1_finance_income: {
      ok: false,
      state: 'failed',
      rows: [],
      notice: { message: '上游原文：上游返回了未识别的失败', retryable: false, upstream: { raw: 'boom', fingerprint: 'aaaaaaaaaaaaaaaa' } },
    },
  })
  const result = await client.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(result.state, 'failed')
  assert.equal(result.notice.code, undefined, '没有上游码就不给码')
  assert.ok(result.notice.message.includes('上游原文'))
  assert.equal(result.notice.upstream.fingerprint, 'aaaaaaaaaaaaaaaa', '指纹要过桥')
}

// —— notice 没有 message 时按形状不符处理，不吞掉失败原因 ——
{
  const { client } = bridge({
    ft_v1_finance_income: { ok: false, state: 'failed', rows: [], notice: { code: 'UPSTREAM_UNAVAILABLE' } },
  })
  const result = await client.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(result.state, 'failed')
  assert.equal(result.notice.code, 'invalid_response')
}

// —— 接口名校验：路由只认目录内的名字 ——
{
  const { client, data } = bridge({})
  const rejected = await client.call('ft_v9_not_in_catalog', {})
  assert.equal(rejected.state, 'failed')
  assert.equal(rejected.notice.code, 'unknown_interface', '目录外的名字在客户端就被挡住')
  assert.equal(data.calls.length, 0, '目录外的名字不出站')
}

// —— 路由自身也拒绝目录外的名字（底座不能变成任意上游的穿透代理）——
{
  const { route, data } = bridge({})
  const response = await route.fetch(new Request(new URL(FTSHARE_DATA_ROUTE, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interface: 'https://evil.example/mcp' }),
  }))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'unknown_interface')
  assert.equal(data.calls.length, 0)
}

// —— 缺必填入参：本地预校验 + 路由复核 ——
{
  const { client, route, data } = bridge({})
  const missing = await client.call('ft_v1_report_announcements_list', {})
  assert.equal(missing.state, 'failed')
  assert.equal(missing.notice.code, 'missing_arguments')
  assert.equal(data.calls.length, 0)

  const response = await route.fetch(new Request(new URL(FTSHARE_DATA_ROUTE, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interface: 'ft_v1_report_announcements_list', args: {} }),
  }))
  assert.equal(response.status, 400, '绕过客户端直接打路由也要被拦住')
  assert.equal(data.calls.length, 0)
}

// —— 传输层失败一律 failed ——
{
  const base = { ft_v1_finance_income: { ok: true, state: 'available', rows: [{ a: 1 }] } }

  const offline = createFtshareClient({ catalog, fetch: async () => { throw new Error('Failed to fetch') } })
  const failedOffline = await offline.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(failedOffline.state, 'failed')
  assert.equal(failedOffline.notice.code, 'transport_failed')
  assert.equal(failedOffline.notice.retryable, true)

  const serverError = createFtshareClient({ catalog, fetch: async () => new Response('boom', { status: 502 }) })
  assert.equal((await serverError.call('ft_v1_finance_income', { stock_code: '600519' })).state, 'failed')

  const garbage = createFtshareClient({ catalog, fetch: async () => new Response('not json', { status: 200 }) })
  assert.equal((await garbage.call('ft_v1_finance_income', { stock_code: '600519' })).state, 'failed')

  const wrongShape = createFtshareClient({ catalog, fetch: async () => new Response(JSON.stringify({ ok: 'yes' }), { status: 200 }) })
  const badShape = await wrongShape.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(badShape.state, 'failed')
  assert.equal(badShape.notice.code, 'invalid_response')

  // 取消：面板连点与快速切标的会产生并发与取消，取消必须落成 failed 而不是挂住。
  const aborter = new AbortController()
  aborter.abort()
  const cancelled = createFtshareClient({ catalog, fetch: async (_input, init) => {
    if (init.signal?.aborted === true) throw new Error('aborted')
    return new Response('', { status: 200 })
  } })
  assert.equal((await cancelled.call('ft_v1_finance_income', { stock_code: '600519' }, { signal: aborter.signal })).state, 'failed')

  // 正常路径仍然可用（上面的 stub 只用于离线用例）
  const healthy = createFtshareClient({ catalog, fetch: async () => new Response(JSON.stringify({ ...base.ft_v1_finance_income, source: FIXED_SOURCE }), { status: 200 }) })
  assert.equal((await healthy.call('ft_v1_finance_income', { stock_code: '600519' })).state, 'available')
}

// —— 缓存：成功缓存，denied 不缓存 ——
{
  let hits = 0
  const fetch = async () => {
    hits += 1
    const answer = { ft_v1_finance_income: { ok: true, state: 'available', rows: [] }, ft_v1_eastmoney_stock_valuation: { ok: false, state: 'denied', rows: [], notice: { code: 'route_not_allowed', message: '无权', retryable: false } } }
    return new Response(JSON.stringify(hits === 1 ? { ...answer.ft_v1_finance_income, source: FIXED_SOURCE } : { ...answer.ft_v1_eastmoney_stock_valuation, source: FIXED_SOURCE }), { status: 200 })
  }
  const client = createFtshareClient({ catalog, fetch })
  await client.call('ft_v1_finance_income', { stock_code: '600519' })
  await client.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(hits, 1, '同样的 (interface, args) 在 TTL 内不再出站')
  await client.call('ft_v1_eastmoney_stock_valuation', { symbol: '600519.SH' })
  await client.call('ft_v1_eastmoney_stock_valuation', { symbol: '600519.SH' })
  assert.equal(hits, 3, 'denied 不缓存：订阅或 Key 可能刚变')
}

// —— 发现：search() 是对目录的纯函数，不发网络；listTools() 用目录而不是网络 ——
{
  const { client, data } = bridge({})
  const hits = data.calls.length
  const found = client.search('announcements')
  assert.ok(found.length > 0, '要能按名字检索到接口')
  assert.ok(found.every(entry => entry.name.includes('announcement') || entry.title.includes('公告') || (entry.description ?? '').includes('公告')), '检索结果必须命中关键词')
  assert.equal(client.search('').length, 20, '空串返回默认上限')
  assert.equal(client.search('zzz-not-a-thing').length, 0)
  const tools = await client.listTools()
  assert.equal(tools.length, catalog.entries.length, '目录就是清单，不必再出站')
  assert.ok(tools.every(tool => typeof tool.tool === 'string' && tool.tool !== '' && typeof tool.title === 'string'), '清单条目要与目录同形')
  assert.equal(data.calls.length, hits, 'search/listTools 不发网络')
}

// —— 客户端产物必须是只读子集 ——
{
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const banned of ['market.ft.tech', 'FTSHARE_API_KEY', 'apiKey', 'resolveApiKey', 'ftshareSettings']) {
    assert.ok(!source.includes(banned), `客户端产物不得出现 ${banned}`)
  }
  assert.ok(!/from ["']node:/u.test(source), '客户端产物不得依赖 node 内置模块')
  assert.ok(!source.includes('/lib/route'), '客户端不得把宿主路由拖进浏览器产物')
}

console.log('crossplane: four states round-trip intact, catalog name fence, transport failures -> failed, cache rules, client is read-only')
