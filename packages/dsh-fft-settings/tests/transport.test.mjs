// 设置调用的传输层：宿主路由的编解码与浏览器调用方的信封契约。
//
// 宿主路由注册在共享的 `/api` 载体上，因此这里不重复测请求鉴权（那是载体的测试
// 范围），只测本插件的请求形状、体积上限与信封处理。

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FTSHARE_SETTINGS_MAX_BODY_BYTES, FTSHARE_SETTINGS_ROUTE } from '../lib/contract.js'
import { createSettingsRoute } from '../lib/transport.js'
import { createSettingsTransport } from '../lib/client-transport.js'
import { createSettingsRpcHandler } from '../lib/rpc-core.js'

const empty = payload => payload !== null && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0
const handler = createSettingsRpcHandler([{
  namespace: 'apiKey',
  rpcMethods: { describe: { validate: empty, invoke: () => ({ configured: true }) } },
}])

/** Call the route with a raw body and decode the response envelope. */
async function callRoute(route, body) {
  const response = await route.fetch(new Request(`http://dsh.internal${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }))
  return { status: response.status, payload: await response.json() }
}

test('路由落在 /api 下、只收 POST，并给出精确路径', () => {
  const route = createSettingsRoute({ handler })
  assert.equal(route.path, '/api/ftshare-settings')
  assert.equal(FTSHARE_SETTINGS_ROUTE, route.path)
  assert.ok(route.path.startsWith('/api/'), '载体只分发 /api 下的精确路由')
  assert.deepEqual(route.methods, ['POST'])
  assert.equal(route.requestBody, 'buffered')
})

test('路由把 endpoint 与 payload 交给登记的方法，并原样回传信封', async () => {
  const route = createSettingsRoute({ handler })
  const ok = await callRoute(route, JSON.stringify({ endpoint: 'apiKey/describe', payload: {} }))
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.payload, { ok: true, value: { configured: true } })

  const unknown = await callRoute(route, JSON.stringify({ endpoint: 'apiKey/nope', payload: {} }))
  assert.equal(unknown.status, 200, '业务失败也是 200 信封')
  assert.equal(unknown.payload.error.code, 'not_found')

  const bad = await callRoute(route, JSON.stringify({ endpoint: 'apiKey/describe', payload: { extra: 1 } }))
  assert.equal(bad.payload.error.code, 'bad_request', '参数校验仍由模块提供')
})

test('非法请求体收敛成 bad_request，且不执行任何方法', async () => {
  let calls = 0
  const counting = createSettingsRoute({
    handler: createSettingsRpcHandler([{ namespace: 'apiKey', rpcMethods: { describe: { validate: empty, invoke: () => { calls++; return null } } } }]),
  })
  for (const [label, body] of [
    ['不是 JSON', '{'],
    ['不是对象', '"apiKey/describe"'],
    ['是数组', '[]'],
    ['是 null', 'null'],
    ['超过体积上限', JSON.stringify({ endpoint: 'apiKey/describe', padding: 'x'.repeat(FTSHARE_SETTINGS_MAX_BODY_BYTES) })],
  ]) {
    const { status, payload } = await callRoute(counting, body)
    assert.equal(status, 400, label)
    assert.equal(payload.ok, false, label)
    assert.equal(payload.error.code, 'bad_request', label)
  }
  assert.equal(calls, 0, '请求体不合法时不该触到方法')

  const empty_ = await callRoute(counting, undefined)
  assert.equal(empty_.status, 400, '无请求体')

  for (const [label, body] of [['缺端点', '{}'], ['端点不是字符串', JSON.stringify({ endpoint: 7 })]]) {
    const { status, payload } = await callRoute(counting, body)
    assert.equal(status, 200, label)
    assert.equal(payload.error.code, 'not_found', label)
  }
  assert.equal(calls, 0, '认不出的端点不该触到方法')
})

test('浏览器调用方发出 {endpoint, payload} 并解出信封', async () => {
  const sent = []
  const transport = createSettingsTransport(async (input, init) => {
    sent.push({ input, init, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ ok: true, value: { configured: true } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })

  assert.deepEqual(await transport.call('apiKey/describe', {}), { ok: true, value: { configured: true } })
  assert.equal(sent[0].input, FTSHARE_SETTINGS_ROUTE)
  assert.equal(sent[0].init.method, 'POST')
  assert.deepEqual(sent[0].body, { endpoint: 'apiKey/describe', payload: {} })
})

test('浏览器调用方在载体拒绝或响应不可信时抛出传输失败', async () => {
  const unauthorized = createSettingsTransport(async () => new Response('unauthorized', { status: 401 }))
  await assert.rejects(() => unauthorized.call('apiKey/describe', {}), /HTTP 401/)

  const notFound = createSettingsTransport(async () => new Response('not found', { status: 404 }))
  await assert.rejects(() => notFound.call('apiKey/describe', {}), /HTTP 404/)
})

test('端到端：浏览器调用方 → 宿主路由 → 信封', async () => {
  const route = createSettingsRoute({ handler })
  const transport = createSettingsTransport(async (input, init) => {
    assert.equal(input, route.path)
    return route.fetch(new Request(`http://dsh.internal${input}`, init))
  })
  assert.deepEqual(await transport.call('apiKey/describe', {}), { ok: true, value: { configured: true } })
})
