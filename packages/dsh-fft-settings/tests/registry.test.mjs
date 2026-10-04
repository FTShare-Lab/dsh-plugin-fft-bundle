import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { assembleSettings, defineSettingsModule } from '../lib/module-registry.js'
import { createSettingsRpcHandler } from '../lib/rpc-core.js'
import { assembleSettingsCards, defineSettingsCard } from '../lib/card-registry.js'
import { createApiKeyRpcMethods } from '../lib/modules/api-key/rpc.js'
import { readFile } from 'node:fs/promises'
const empty = payload => payload !== null && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0
const signal = () => new AbortController().signal

test('new module entries provide namespaced services, RPC and lifecycle without dispatcher changes', async () => {
  const ctx = new Context()
  let assembled
  let disposed = 0
  const module = namespace => defineSettingsModule({
    namespace, inject: [],
    create(scoped) {
      scoped.effect(() => () => { disposed++ }, `test: ${namespace}`)
      return {
        service: { get: () => namespace, privateSecret: () => 'secret' },
        rpcMethods: { get: { validate: empty, invoke: () => namespace } },
      }
    },
  })
  const fiber = await ctx.plugin({ apply(scoped) { assembled = assembleSettings(scoped, [module('first'), module('second')]) } })
  try {
    assert.equal(assembled.service.apiVersion, 1)
    assert.equal(assembled.service.first.get(), 'first')
    assert.equal(assembled.service.second.get(), 'second')
    assert.equal((await assembled.handler('second/get', {}, signal())).value, 'second')
    for (const endpoint of ['first/privateSecret', 'second/toString', 'first/get/extra', 'missing/get']) {
      assert.equal((await assembled.handler(endpoint, {}, signal())).error.code, 'not_found')
    }
    assert.equal((await assembled.handler('first/get', { extra: true }, signal())).error.code, 'bad_request')
  } finally { await fiber.dispose() }
  assert.equal(disposed, 2)
})

test('duplicate and reserved namespaces fail before initializing resources', () => {
  let initialized = 0
  const module = namespace => ({ namespace, inject: [], create() { initialized++; return { service: {}, rpcMethods: {} } } })
  for (const entries of [[module('same'), module('same')], [module('apiVersion')], [module('__proto__')], [module('a/b')]]) {
    assert.throws(() => assembleSettings(new Context(), entries))
  }
  assert.equal(initialized, 0)
})

test('generic RPC preserves cancellation, rejection sanitization and null void results', async () => {
  let calls = 0
  const handler = createSettingsRpcHandler([{ namespace: 'example', rpcMethods: {
    save: { validate: empty, invoke() { calls++ } },
    broken: { validate: empty, invoke() { throw Error('private-secret') } },
  } }])
  const controller = new AbortController(); controller.abort()
  assert.equal((await handler('example/save', {}, controller.signal)).error.code, 'cancelled')
  assert.equal(calls, 0)
  assert.deepEqual(await handler('example/save', {}, signal()), { ok: true, value: null })
  const failure = await handler('example/broken', {}, signal())
  assert.equal(failure.error.code, 'operation_failed')
  assert.ok(!JSON.stringify(failure).includes('private-secret'))
  assert.throws(() => createSettingsRpcHandler([{ namespace: 'example', rpcMethods: { 'bad/path': {} } }]))
})

test('API key module keeps strict payload whitelist after generic dispatch', async () => {
  let calls = 0
  const handler = createSettingsRpcHandler([{ namespace: 'apiKey', rpcMethods: createApiKeyRpcMethods({ set() { calls++ } }) }])
  for (const value of [{ value: 'secret', extra: 1 }, { other: 'secret' }, [], null, { value: 12 }, { value: 'x'.repeat(1025) }]) {
    assert.equal((await handler('apiKey/set', value, signal())).error.code, 'bad_request')
  }
  assert.equal(calls, 0)
  assert.equal((await handler('apiKey/set', { value: 'secret' }, signal())).ok, true)
  assert.equal(calls, 1)
})

test('new cards render in registration order priority without changing page framework', () => {
  const context = {}
  const card = (id, order) => defineSettingsCard({ id, order, inject: [], createComponent(ctx) { assert.equal(ctx, context); return () => id } })
  const entries = [card('later', 20), card('first', 10), card('second', 10)]
  const cards = assembleSettingsCards(context, entries)
  assert.deepEqual(cards.map(c => c.Component()), ['first', 'second', 'later'])
  assert.equal(entries[0].id, 'later')
  assert.throws(() => assembleSettingsCards(context, [card('same', 0), card('same', 1)]))
})

test('browser bundle excludes Host module assembly and credential probing', async () => {
  const map = JSON.parse(await readFile(new URL('../lib/client.js.map', import.meta.url), 'utf8'))
  for (const hostFile of ['src/modules.ts', 'src/module-registry.ts', 'src/modules/api-key/host.ts', 'src/api-key.ts', 'src/probe.ts']) {
    assert.ok(!map.sources.some(source => source.endsWith(hostFile)), hostFile)
  }
  assert.ok(map.sources.some(source => source.endsWith('src/modules/api-key/card.tsx')))
})
