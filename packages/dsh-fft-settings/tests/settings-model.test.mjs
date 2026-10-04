import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FtshareSettingsModel } from '../lib/settings-model.js'
import { untested } from '../lib/contract.js'
const empty = { configured: false, writable: true, revision: 0, validation: untested() }
const tick = () => new Promise(r => setImmediate(r))
const api = (overrides = {}) => ({ describe: async () => structuredClone(empty), set: async () => {}, clear: async () => {}, ...overrides })
test('unknown status disables saving and recovery clears read errors', async () => {
  let failed = true; let calls = 0
  const model = new FtshareSettingsModel(api({ describe: async () => { if (failed) throw Error(); return empty }, configureAndTest: async () => { calls++ } }))
  await model.refresh(); assert.ok(model.getSnapshot().statusError)
  assert.equal(await model.configureAndTest('test-key'), false); assert.equal(calls, 0)
  failed = false; await model.refresh(); assert.equal(model.getSnapshot().statusError, undefined)
})
test('saved key remains saved even if validation failed; UI distinguishes results', async () => {
  const status = { ...empty, configured: true, validation: { ...untested(), status: 'failed' } }
  const model = new FtshareSettingsModel(api({ describe: async () => status, configureAndTest: async () => ({ save: { status: 'saved', message: '已保存' }, validation: status.validation }) }))
  await model.refresh()
  assert.equal(await model.configureAndTest('test-key'), true)
  assert.equal(model.getSnapshot().save.status, 'saved')
  assert.match(model.getSnapshot().message, /未通过/)
})
test('test current works for read-only key and never saves a draft', async () => {
  let tested = 0
  const model = new FtshareSettingsModel(api({ describe: async () => ({ ...empty, configured: true, writable: false }), testConnection: async () => { tested++; return untested() } }))
  await model.refresh()
  assert.equal(await model.configureAndTest('draft'), false)
  await model.testConnection(); assert.equal(tested, 1)
})
test('late refresh and unmounted requests do not overwrite current state', async () => {
  let resolveOld; let calls = 0
  const model = new FtshareSettingsModel(api({ describe: () => ++calls === 1 ? new Promise(r => { resolveOld = r }) : Promise.resolve({ ...empty, configured: true }) }))
  const old = model.refresh(); await model.refresh(); resolveOld(empty); await old
  assert.equal(model.getSnapshot().status.configured, true)
  let notify; const disconnect = model.connect(listener => { notify = listener; return () => {} }); await tick()
  notify(); disconnect(); await tick()
  assert.equal(model.getSnapshot().status.configured, true)
})
test('clear re-reads fallback and transport failure does not claim an unsaved key', async () => {
  let source = 'file'
  const model = new FtshareSettingsModel(api({ describe: async () => ({ ...empty, configured: true, source }), clear: async () => { source = 'user-env' }, configureAndTest: async () => { throw Error('secret') } }))
  await model.refresh(); await model.clear(); assert.equal(model.getSnapshot().status.source, 'user-env')
  assert.equal(await model.configureAndTest('test-key'), false)
  assert.match(model.getSnapshot().message, /待确认/); assert.ok(!model.getSnapshot().message.includes('secret'))
})
