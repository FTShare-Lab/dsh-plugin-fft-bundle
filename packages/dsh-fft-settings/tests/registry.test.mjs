// 宿主侧的缝：命名空间注册表与活路由表。
//
// 这里只测本插件自己的语义：先校验后写入、服务属性与路由同时出现/消失、
// 生命周期跟随 owner fiber、以及通用分发的白名单与信封。槽位（浏览器侧的缝）
// 由 client-seam.test.mjs 覆盖。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { createSettingsHost } from '../lib/core/module-registry.js'
import { createSettingsRpcHandler } from '../lib/core/rpc-core.js'
import { createApiKeyRpcMethods } from '../lib/features/api-key/rpc.js'

const empty = payload => payload !== null && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0
const signal = () => new AbortController().signal
const module = namespace => ({
  namespace, inject: [],
  create() {
    return {
      service: { get: () => namespace, privateSecret: () => 'secret' },
      rpcMethods: { get: { validate: empty, invoke: () => namespace } },
    }
  },
})

/** Boot one host with a disposable owner fiber (the registry's `owner` argument). */
async function boot(t) {
  const ctx = new Context()
  const host = createSettingsHost()
  ctx.provide('ftshareSettings', host.service)
  const fiber = await ctx.plugin({ apply() {} })
  t.after(() => fiber.dispose())
  return { ctx, host, owner: fiber.ctx, fiber }
}

test('a namespace registered after boot publishes its service property and its routes together', async t => {
  const { ctx, host, owner } = await boot(t)
  assert.equal(ctx.ftshareSettings.apiVersion, 1)
  assert.deepEqual(ctx.ftshareSettings.modules.namespaces(), [])
  assert.deepEqual(host.handler.namespaces(), [])
  assert.equal((await host.handler('first/get', {}, signal())).error.code, 'not_found')

  const registration = host.service.modules.register(module('first'), owner)
  assert.equal(registration.namespace, 'first')
  assert.equal(registration.service.get(), 'first')
  assert.deepEqual(host.service.modules.namespaces(), ['first'])
  // Service property and route table move together.
  assert.equal(ctx.ftshareSettings.first.get(), 'first')
  assert.deepEqual(host.handler.namespaces(), ['first'])
  assert.equal((await host.handler('first/get', {}, signal())).value, 'first')

  // A second namespace arrives later on the same boot.
  const second = host.service.modules.register(module('second'), owner)
  assert.equal((await host.handler('second/get', {}, signal())).value, 'second')
  assert.deepEqual(host.service.modules.namespaces(), ['first', 'second'])

  // The dispatcher never reflects over the service object.
  for (const endpoint of ['first/privateSecret', 'first/toString', 'first/get/extra', 'missing/get']) {
    assert.equal((await host.handler(endpoint, {}, signal())).error.code, 'not_found', endpoint)
  }
  assert.equal((await host.handler('first/get', { extra: true }, signal())).error.code, 'bad_request')

  // An explicit dispose is idempotent and removes both halves.
  registration.dispose()
  registration.dispose()
  second.dispose()
  assert.equal(ctx.ftshareSettings.first, undefined)
  assert.equal(ctx.ftshareSettings.second, undefined)
  assert.deepEqual(host.service.modules.namespaces(), [])
  assert.deepEqual(host.handler.namespaces(), [])
  assert.equal((await host.handler('first/get', {}, signal())).error.code, 'not_found')
})

test('releasing the owner fiber removes its namespace property and every route of that namespace', async t => {
  const { ctx, host, owner, fiber } = await boot(t)
  const registration = host.service.modules.register(module('owned'), owner)
  // A sibling registration owned by a different fiber must survive.
  const survivor = host.service.modules.register(module('survivor'), ctx)
  assert.equal((await host.handler('owned/get', {}, signal())).value, 'owned')

  await fiber.dispose()
  assert.equal(ctx.ftshareSettings.owned, undefined)
  assert.equal((await host.handler('owned/get', {}, signal())).error.code, 'not_found')
  assert.deepEqual(host.service.modules.namespaces(), ['survivor'])
  assert.deepEqual(host.handler.namespaces(), ['survivor'])
  assert.equal(ctx.ftshareSettings.survivor.get(), 'survivor')
  // The dead registration's disposer stays a no-op.
  registration.dispose()
  assert.equal(ctx.ftshareSettings.survivor.get(), 'survivor')
  survivor.dispose()
})

test('duplicate, reserved and malformed namespaces fail before create and leave no trace', async t => {
  const { ctx, host, owner } = await boot(t)
  let created = 0
  const counting = namespace => ({
    namespace, inject: [],
    create() { created++; return { service: { get: () => namespace }, rpcMethods: { get: { validate: empty, invoke: () => namespace } } } },
  })
  const registration = host.service.modules.register(counting('first'), owner)
  assert.equal(created, 1)
  const before = Object.keys(ctx.ftshareSettings).sort()

  assert.throws(() => host.service.modules.register(counting('first'), owner), /Duplicate settings namespace: first/)
  for (const namespace of ['apiVersion', 'modules', 'constructor', 'prototype', '__proto__', 'a/b', '1st', '', 'with space']) {
    assert.throws(() => host.service.modules.register(counting(namespace), owner), undefined, namespace)
  }
  assert.equal(created, 1, 'rejected namespaces never reach create')
  assert.deepEqual(host.service.modules.namespaces(), ['first'])
  assert.deepEqual(host.handler.namespaces(), ['first'])
  assert.deepEqual(Object.keys(ctx.ftshareSettings).sort(), before)
  assert.equal(Object.getPrototypeOf(host.service), Object.prototype)

  // Retrying is allowed once the previous registration was revoked.
  registration.dispose()
  assert.doesNotThrow(() => host.service.modules.register(counting('first'), owner))
  assert.equal(created, 2)
})

test('a declared module dependency that the owner cannot resolve fails registration', async t => {
  const { ctx, host, owner } = await boot(t)
  let created = 0
  const needy = name => ({ namespace: 'needy', inject: [name], create() { created++; return { service: {}, rpcMethods: {} } } })

  assert.throws(() => host.service.modules.register(needy('credentials'), owner), /Missing settings module dependency for needy: credentials/)
  assert.equal(created, 0, 'an unresolvable dependency never reaches create')
  assert.equal(ctx.ftshareSettings.needy, undefined)
  assert.deepEqual(host.handler.namespaces(), [])

  ctx.provide('credentials', { resolve: async () => undefined })
  const registration = host.service.modules.register(needy('credentials'), owner)
  assert.equal(created, 1)
  assert.equal(registration.namespace, 'needy')
  assert.deepEqual(host.service.modules.namespaces(), ['needy'])
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

test('the live route table increments and decrements without touching the mounted route', async () => {
  const handler = createSettingsRpcHandler()
  assert.deepEqual(handler.namespaces(), [])
  // A rejected module writes nothing, not even the endpoints that would have validated.
  assert.throws(() => handler.register({ namespace: 'ok', rpcMethods: { 'bad/path': { validate: empty, invoke: () => null } } }))
  assert.deepEqual(handler.namespaces(), [])
  assert.equal((await handler('ok/save', {}, signal())).error.code, 'not_found')
  assert.throws(() => handler.register({ namespace: 'modules', rpcMethods: {} }))

  handler.register({ namespace: 'ok', rpcMethods: { save: { validate: empty, invoke: () => 'saved' } } })
  assert.equal((await handler('ok/save', {}, signal())).value, 'saved')
  assert.throws(() => handler.register({ namespace: 'ok', rpcMethods: {} }), /Duplicate settings namespace: ok/)
  assert.deepEqual(handler.namespaces(), ['ok'])

  handler.unregister('missing')
  handler.unregister('ok')
  assert.deepEqual(handler.namespaces(), [])
  assert.equal((await handler('ok/save', {}, signal())).error.code, 'not_found')
  handler.register({ namespace: 'ok', rpcMethods: { save: { validate: empty, invoke: () => 'again' } } })
  assert.equal((await handler('ok/save', {}, signal())).value, 'again')
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

test('browser bundle excludes Host module assembly and credential probing', async () => {
  const map = JSON.parse(await readFile(new URL('../lib/client.js.map', import.meta.url), 'utf8'))
  for (const hostFile of ['src/features/api-key/index.ts', 'src/features/api-key/host.ts', 'src/features/api-key/service.ts', 'src/features/api-key/probe.ts', 'src/core/module-registry.ts']) {
    assert.ok(!map.sources.some(source => source.endsWith(hostFile)), hostFile)
  }
  for (const browserFile of ['src/core/shell.tsx', 'src/features/api-key/card.tsx']) {
    assert.ok(map.sources.some(source => source.endsWith(browserFile)), browserFile)
  }
})
