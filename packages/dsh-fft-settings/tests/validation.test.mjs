import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiKeySettings } from '../lib/api-key.js'
import { probeApiKey, PROBE_CONTRACTS } from '../lib/probe.js'
import { createApiKeyRpcHandler, createApiKeyClient } from '../lib/rpc.js'
import { untested } from '../lib/contract.js'
const row = { open: '10', high: '12', low: '9', close: '11', ts_millis: 1720000000000 }
const response = (data = [row], code = 200, message = 'success', status = 200) => new Response(JSON.stringify({ code, message, data }), { status })
const passed = { status: 'passed', remote: { status: 'available', message: '远端服务正常' }, apiKey: { status: 'available', message: 'API Key 验证通过' }, testedAt: '2026-09-16T00:00:00Z' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(validator = async () => structuredClone(passed)) {
  let key
  let writable = true
  let failSave = false
  const store = {
    resolve: async () => key,
    describe: async () => ({ configured: !!key, writable, source: key ? 'file' : undefined }),
    set: async value => { if (failSave) throw new Error('test-sensitive-error'); key = value },
    clear: async () => { key = undefined },
  }
  return { ...createApiKeySettings(store, validator), store, change(value) { key = value }, readOnly() { writable = false }, failSave() { failSave = true } }
}
test('documented GET contracts, small limits, auth header, redirects disabled; no rows escape', async () => {
  const calls = []
  const report = await probeApiKey('test-secret', new AbortController().signal, async (url, init) => { calls.push({ url, init }); return response() }, 1789516800000)
  assert.equal(report.status, 'passed')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url.pathname, '/gateway/' + PROBE_CONTRACTS.daily)
  assert.equal(calls[1].url.pathname, '/gateway/' + PROBE_CONTRACTS.historicalMinute)
  assert.equal(calls[1].url.searchParams.get('symbol'), '600519.SH')
  assert.equal(calls[1].url.searchParams.get('limit'), '1')
  assert.equal(calls[1].url.searchParams.get('adjust_kind'), 'none')
  assert.ok(Number(calls[1].url.searchParams.get('until_ts_millis')) - Number(calls[1].url.searchParams.get('since_ts_millis')) <= 3 * 86400000)
  assert.equal(calls[0].init.headers.FTSHARE_API_KEY, undefined)
  assert.equal(calls[1].init.headers.FTSHARE_API_KEY, 'test-secret')
  for (const { url, init } of calls) {
    assert.equal(url.origin, 'https://market.ft.tech')
    assert.ok(!url.toString().includes('test-secret'))
    assert.equal(init.redirect, 'error')
  }
  assert.ok(!JSON.stringify(report).includes('test-secret'))
  assert.ok(!JSON.stringify(report).includes('ts_millis'))
})
test('key verification can fail while the remote is healthy, including HTTP 200 error envelopes', async () => {
  let calls = 0
  const report = await probeApiKey('test-secret', new AbortController().signal, async () => ++calls === 1 ? response() : response(null, 403, '套餐权限不足 test-secret'))
  assert.equal(report.status, 'partial')
  assert.equal(report.remote.status, 'available')
  assert.equal(report.apiKey.status, 'permission_denied')
  assert.ok(!JSON.stringify(report).includes('test-secret'))
})
test('minute probe obeys live lowercase adjustment and inclusive Beijing calendar-day limits', async () => {
  for (const now of [Date.parse('2026-09-16T15:59:59.999Z'), Date.parse('2026-09-16T16:00:00Z'), Date.parse('2026-09-16T09:30:00Z')]) {
    const report = await probeApiKey('test-secret', new AbortController().signal, async url => {
      if (url.pathname.endsWith(PROBE_CONTRACTS.historicalMinute)) {
        const since = Number(url.searchParams.get('since_ts_millis'))
        const until = Number(url.searchParams.get('until_ts_millis'))
        const beijingDay = ts => Math.floor((ts + 8 * 3600000) / 86400000)
        const count = beijingDay(until) - beijingDay(since) + 1
        if (url.searchParams.get('adjust_kind') !== 'none' || count > 3) return response(null, 400, 'invalid parameters', 400)
      }
      return response([])
    }, now)
    assert.equal(report.status, 'passed')
  }
})
test('parameter rejection is actionable and never reports that the key is invalid', async () => {
  let calls = 0
  const report = await probeApiKey('test-secret', new AbortController().signal, async () => ++calls === 1 ? response([]) : response(null, 400, 'sensitive response test-secret', 400))
  assert.equal(report.apiKey.status, 'invalid_response')
  assert.match(report.apiKey.message, /请求参数.*400/)
  assert.match(report.apiKey.message, /不代表 Key 无效/)
  assert.ok(!JSON.stringify(report).includes('test-secret'))
})
for (const [status, message, expected] of [[401, 'api_key_invalid test-secret', 'auth_failed'], [403, 'missing key', 'auth_required'], [403, 'forbidden', 'permission_denied'], [429, 'too many', 'rate_limited'], [403, 'quota', 'quota_exceeded'], [503, 'oops', 'upstream_error']]) {
  test(`key endpoint HTTP ${status} ${expected} does not negate remote health`, async () => {
    let calls = 0
    const report = await probeApiKey('test-secret', new AbortController().signal, async () => ++calls === 1 ? response([]) : response(null, status, message, status))
    assert.equal(calls, 2)
    assert.equal(report.remote.status, 'available')
    assert.equal(report.apiKey.status, expected)
    assert.equal(report.status, 'partial')
    assert.ok(!JSON.stringify(report).includes('test-secret'))
  })
}
test('holidays, closed markets and delayed data do not invalidate successful checks', async () => {
  for (const now of [Date.parse('2026-10-05T04:00:00Z'), Date.parse('2026-09-16T07:30:00Z')]) {
    const report = await probeApiKey('test-secret', new AbortController().signal, async () => response([]), now)
    assert.equal(report.status, 'passed')
    assert.equal(report.remote.status, 'available')
    assert.equal(report.apiKey.status, 'available')
    assert.equal(report.apiKey.message, 'API Key 验证通过')
  }
})
test('malformed envelopes, upstream errors and oversized responses are not healthy', async () => {
  for (const [factory, expected] of [
    [() => response(null), 'invalid_response'],
    [() => new Response('<html>test-secret</html>'), 'invalid_response'],
    [() => new Response('x'.repeat(130 * 1024)), 'invalid_response'],
    [() => response(null, 503, 'down', 503), 'upstream_error'],
    [() => response(null, 403, 'forbidden', 403), 'upstream_error'],
  ]) {
    let calls = 0
    const report = await probeApiKey('test-secret', new AbortController().signal, async () => { calls++; return factory() })
    assert.equal(calls, 1)
    assert.equal(report.remote.status, expected)
    assert.equal(report.apiKey.status, 'not_run')
  }
})
test('a successful HTTP response with missing or failed business status does not validate the key', async () => {
  for (const payload of [{ data: [] }, { code: 401, message: 'api_key_invalid', data: [] }, { code: 200, data: null }]) {
    let calls = 0
    const report = await probeApiKey('test-secret', new AbortController().signal, async () => ++calls === 1 ? response([]) : new Response(JSON.stringify(payload)))
    assert.equal(report.remote.status, 'available')
    assert.notEqual(report.apiKey.status, 'available')
  }
})
test('missing key still checks the remote anonymously and never checks key authentication', async () => {
  let calls = 0
  const report = await probeApiKey(undefined, new AbortController().signal, async (_url, init) => {
    calls++
    assert.equal(init.headers.FTSHARE_API_KEY, undefined)
    return response([])
  })
  assert.equal(calls, 1)
  assert.equal(report.remote.status, 'available')
  assert.equal(report.apiKey.status, 'auth_required')
  assert.equal(report.status, 'partial')
})
test('network errors are classified without leaking their message; cancelled requests do not continue', async () => {
  const report = await probeApiKey('test-secret', new AbortController().signal, async () => { throw new Error('test-secret') })
  assert.equal(report.remote.status, 'network_error')
  assert.ok(!JSON.stringify(report).includes('test-secret'))
  const controller = new AbortController()
  const cancelled = await probeApiKey('test-secret', controller.signal, async () => { controller.abort(); throw new Error() })
  assert.equal(cancelled.remote.status, 'not_run')
})
test('configure saves first; test failures preserve the saved key and separate outcomes', async () => {
  const owner = setup(async key => { assert.equal(key, 'test-key'); assert.equal(await owner.store.resolve(), key); return { ...untested(), status: 'failed' } })
  const report = await owner.api.configureAndTest(' test-key ')
  assert.equal(report.save.status, 'saved')
  assert.equal(report.validation.status, 'failed')
  assert.equal(await owner.api.resolve(), 'test-key')
})
test('invalid inputs, read-only and failed saves never probe', async () => {
  let calls = 0
  const owner = setup(async () => { calls++; return passed })
  assert.equal((await owner.api.configureAndTest('')).save.code, 'invalid_input')
  owner.readOnly()
  assert.equal((await owner.api.configureAndTest('test-key')).save.code, 'read_only')
  const failure = setup(async () => { calls++; return passed }); failure.failSave()
  assert.equal((await failure.api.configureAndTest('test-key')).save.code, 'save_failed')
  assert.equal(calls, 0)
})
test('coalesces simultaneous tests and returns isolated reports', async () => {
  const gate = deferred(); let calls = 0
  const owner = setup(async () => { calls++; await gate.promise; return passed })
  await owner.api.set('test-key')
  const a = owner.api.testConnection(); const b = owner.api.testConnection()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(calls, 1)
  gate.resolve()
  const [one, two] = await Promise.all([a, b])
  one.remote.message = 'changed'
  assert.equal(two.remote.message, '远端服务正常')
  assert.equal((await owner.api.getValidationStatus()).remote.message, '远端服务正常')
})
test('changing, clearing or disposing cancels old tests and prevents stale results', async () => {
  for (const action of ['change', 'clear', 'dispose']) {
    const gate = deferred(); const started = deferred(); let signal
    const owner = setup(async (_key, s) => { signal = s; started.resolve(); await gate.promise; return passed })
    await owner.api.set('old-key')
    const pending = owner.api.testConnection(); await started.promise
    if (action === 'change') await owner.api.set('new-key')
    if (action === 'clear') await owner.api.clear()
    if (action === 'dispose') owner.dispose()
    assert.ok(signal.aborted)
    gate.resolve()
    assert.equal((await pending).status, 'superseded')
    if (action !== 'dispose') assert.equal((await owner.api.getValidationStatus()).status, 'not_tested')
  }
})
test('external changes even without events invalidate validation on next read', async () => {
  const owner = setup()
  await owner.api.set('old-key'); await owner.api.testConnection()
  owner.change('new-key')
  assert.equal((await owner.api.describe()).validation.status, 'not_tested')
})
test('authenticated RPC adapter permits only public API key methods and checks payloads', async () => {
  const owner = setup()
  const handler = createApiKeyRpcHandler(owner.api)
  const invoke = (endpoint, payload) => handler(endpoint, payload, new AbortController().signal)
  assert.equal((await invoke('apiKey/resolve', {})).ok, false)
  assert.equal((await invoke('apiKey/createEnvironment', {})).ok, false)
  assert.equal((await invoke('apiKey/testConnection', { url: 'https://evil.invalid' })).ok, false)
  assert.equal((await invoke('apiKey/configureAndTest', { value: 3 })).ok, false)
  const client = createApiKeyClient({ call: async (endpoint, payload) => invoke(endpoint, payload) })
  const report = await client.configureAndTest('test-secret')
  assert.equal(report.save.status, 'saved'); assert.equal(report.validation.status, 'passed')
  assert.ok(!JSON.stringify(await client.describe()).includes('test-secret'))
  assert.equal((await client.describe()).maskedValue, '••••••••cret')
  await client.clear()
  assert.equal((await client.describe()).configured, false)
})

test('request timeout aborts stalled transport and avoids the second probe', async () => {
  let calls = 0
  // Keep the loop alive: AbortSignal.timeout itself uses an unref'ed timer.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const report = await probeApiKey('test-secret', new AbortController().signal, (_url, { signal }) => {
      calls++
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    assert.equal(report.remote.status, 'timeout')
    assert.equal(report.apiKey.status, 'not_run')
    assert.equal(calls, 1)
  } finally { clearInterval(keepAlive) }
})

test('successful persistence stays saved when subsequent provider resolution fails', async () => {
  let key
  const owner = createApiKeySettings({
    describe: async () => ({ configured: !!key, writable: true }),
    set: async value => { key = value }, clear: async () => { key = undefined },
    resolve: async () => { throw new Error('provider failure') },
  })
  const report = await owner.api.configureAndTest('test-key')
  assert.equal(key, 'test-key')
  assert.equal(report.save.status, 'saved')
  assert.equal(report.validation.status, 'not_run')
})

test('service exposes remote testing before a key is configured', async () => {
  let calls = 0
  const owner = setup(async key => {
    calls++
    assert.equal(key, undefined)
    return { ...passed, status: 'partial', apiKey: { status: 'auth_required', message: '未配置 API Key' } }
  })
  const report = await owner.api.testConnection()
  assert.equal(calls, 1)
  assert.equal(report.remote.status, 'available')
  assert.equal(report.apiKey.status, 'auth_required')
  assert.equal((await owner.api.getValidationStatus()).remote.status, 'available')
})
