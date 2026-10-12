import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

const REF = 'FTSHARE_API_KEY'

async function boot(t, event = 'credentials/reference-updated') {
  const ctx = new Context()
  let saved
  let inherited
  let fallback
  const effective = () => inherited ?? saved ?? fallback
  const source = () => inherited !== undefined ? 'env' : saved !== undefined ? 'file' : fallback !== undefined ? 'user-env' : undefined
  ctx.provide('credentials', {
    async resolve(ref) {
      assert.equal(ref, REF)
      return effective() === undefined ? undefined : { value: effective(), source: source() }
    },
    async describe(ref) {
      assert.equal(ref, REF)
      return { configured: effective() !== undefined, writable: inherited === undefined, source: source() }
    },
    async set(ref, value) {
      assert.equal(ref, REF)
      if (inherited !== undefined) throw new Error('read_only')
      saved = value
      ctx.emit(event, ref)
    },
    async unset(ref) {
      assert.equal(ref, REF)
      if (inherited !== undefined) throw new Error('read_only')
      saved = undefined
      ctx.emit(event, ref)
    },
  })
  const fiber = await ctx.plugin(plugin)
  t.after(() => fiber.dispose())
  return {
    ctx, fiber, service: ctx.ftshareSettings.apiKey,
    inherit(value) { inherited = value },
    fallback(value) { fallback = value },
  }
}

test('reads each operation, shares writes, and exposes only safe status', async t => {
  const { service, ctx } = await boot(t)
  assert.equal(ctx.ftshareSettings.apiVersion, 1)
  assert.equal(service.credentialRef, REF)
  assert.equal(await service.resolve(), undefined)
  await service.set('  test-key-one  ')
  assert.equal(await service.resolve(), 'test-key-one')
  await ctx.credentials.set(REF, 'test-key-two')
  assert.equal(await service.resolve(), 'test-key-two')
  assert.equal((await service.describe()).source, 'file')
  await service.clear()
  assert.equal(await service.resolve(), undefined)
})

test('the built-in API key namespace is published through the public registry', async t => {
  const { ctx, service } = await boot(t)
  // Both built-in features take the public registry path; apiKey comes first.
  assert.deepEqual(ctx.ftshareSettings.modules.namespaces(), ['apiKey', 'logs'])
  assert.equal(ctx.ftshareSettings.apiKey, service)
  // Same path as any other module: the namespace is taken, so a second attempt
  // is rejected and the live one keeps working.
  assert.throws(() => ctx.ftshareSettings.modules.register({ namespace: 'apiKey', inject: [], create: () => ({ service: {}, rpcMethods: {} }) }, ctx), /Duplicate settings namespace: apiKey/)
  assert.equal((await ctx.ftshareSettings.apiKey.describe()).configured, false)
})

test('environment precedence is read-only; clearing saved values reveals fallback', async t => {
  const { service, inherit, fallback } = await boot(t)
  fallback('test-fallback')
  await service.set('test-saved')
  inherit('test-env')
  assert.equal((await service.describe()).writable, false)
  assert.equal(await service.resolve(), 'test-env')
  await assert.rejects(service.set('test-other'), /只读/)
  await assert.rejects(service.clear(), /只读/)
  inherit(undefined)
  assert.equal(await service.resolve(), 'test-saved')
  await service.clear()
  assert.equal(await service.resolve(), 'test-fallback')
})

test('status exposes only a mask and suffix of the effective key across updates and fallback', async t => {
  const { service, ctx, inherit, fallback } = await boot(t)
  assert.equal((await service.describe()).maskedValue, undefined)
  await service.set('test-secret-1234')
  const status = await service.describe()
  assert.equal(status.maskedValue, '••••••••1234')
  assert.ok(!JSON.stringify(status).includes('test-secret'))
  await ctx.credentials.set(REF, 'test-replacement-5678')
  assert.equal((await service.describe()).maskedValue, '••••••••5678')
  inherit('test-inherited-9012')
  assert.equal((await service.describe()).maskedValue, '••••••••9012')
  inherit(undefined)
  fallback('test-fallback-3456')
  await service.clear()
  assert.equal((await service.describe()).maskedValue, '••••••••3456')
  fallback(undefined)
  assert.equal((await service.describe()).maskedValue, undefined)
  for (const key of ['x', '1234']) {
    await service.set(key)
    assert.equal((await service.describe()).maskedValue, '••••••••')
  }
})

for (const event of plugin.FTSHARE_CREDENTIAL_EVENTS) {
  test(`subscription filters ${event}, carries no key and supports disposal`, async t => {
    const { service, ctx } = await boot(t, event)
    const events = []
    const dispose = service.subscribe((...args) => events.push(args))
    ctx.emit(event, 'ANOTHER_KEY')
    await ctx.credentials.set(REF, 'test-secret')
    await service.clear()
    assert.deepEqual(events, [[], []])
    dispose()
    await service.set('test-secret-again')
    assert.equal(events.length, 2)
  })
}

test('unloading removes the service and change subscriptions', async t => {
  const { ctx, fiber, service } = await boot(t)
  let changes = 0
  service.subscribe(() => { changes++ })
  await fiber.dispose()
  assert.equal(ctx.get('ftshareSettings'), undefined)
  ctx.emit('credentials/reference-updated', REF)
  assert.equal(changes, 0)
})

test('environment snapshots replace stale keys without mutating the input', async t => {
  const { service } = await boot(t)
  const base = { PATH: '/test/bin', FTSHARE_API_KEY: 'test-stale' }
  assert.deepEqual(await service.createEnvironment(base), { PATH: '/test/bin' })
  await service.set('test-current')
  assert.deepEqual(await service.createEnvironment(base), { PATH: '/test/bin', FTSHARE_API_KEY: 'test-current' })
  assert.equal(base.FTSHARE_API_KEY, 'test-stale')
  assert.deepEqual(await service.createEnvironment(), { FTSHARE_API_KEY: 'test-current' })
})

test('invalid keys never overwrite an existing key or appear in errors', async t => {
  const { service } = await boot(t)
  await service.set('test-saved')
  for (const value of ['', '   ', 'test\nsecret', 'test\u0000secret', 'a'.repeat(513)]) {
    await assert.rejects(service.set(value), error => {
      assert.ok(!error.message.includes('test'))
      return true
    })
    assert.equal(await service.resolve(), 'test-saved')
  }
})

test('Host mounts and releases the settings route with the service', async t => {
  const { ctx, fiber } = await boot(t)
  let route; let removed = false
  ctx.provide('connection', { fetch: { register(registered) {
    route = registered
    return async () => { removed = true }
  } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(route.path, '/api/ftshare-settings')
  assert.deepEqual(route.methods, ['POST'])
  const response = await route.fetch(new Request(`http://dsh.internal${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'apiKey/describe', payload: {} }),
  }))
  assert.equal(response.status, 200)
  const report = await response.json()
  assert.equal(report.ok, true)
  assert.equal(report.value.configured, false)
  await fiber.dispose()
  assert.equal(removed, true)
})
