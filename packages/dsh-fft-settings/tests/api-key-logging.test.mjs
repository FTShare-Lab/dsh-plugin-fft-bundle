/**
 * settings 侧三个日志点（规格 §7）测试：探测失败、验证服务异常 / 凭据不可确认、保存失败。
 *
 * 两件事一起断言：字段形状（`{ target, status, durationMs }` / `{ stage, code }` / `{ code }`）、
 * 成功路径完全静默，以及插件入口传下去的是**插件名** logger（名字由 cordis 既有语义给出），
 * 采集器能把它落成一行且不含 Key。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'
import { createApiKeySettings } from '../lib/features/api-key/service.js'
import { probeApiKey } from '../lib/features/api-key/probe.js'

const signal = () => new AbortController().signal
const NOW = 1789516800000
const row = { open: '10', high: '12', low: '9', close: '11', ts_millis: 1720000000000 }
const response = (data = [row], code = 200, message = 'success', status = 200) => new Response(JSON.stringify({ code, message, data }), { status })
const passed = { status: 'passed', remote: { status: 'available', message: '远端服务正常' }, apiKey: { status: 'available', message: 'API Key 验证通过' }, testedAt: '2026-09-16T00:00:00Z' }
let tempCounter = 0

/** 假 logger：记录每次 warn 的消息与字段。 */
function fakeLogger() {
  const warns = []
  return { warns, warn(message, fields) { warns.push({ message, fields }) } }
}

/** 一份可编排的假凭据存储。 */
function store(overrides = {}) {
  let key
  return {
    resolve: async () => key,
    describe: async () => ({ configured: key !== undefined, writable: true }),
    set: async value => { key = value },
    clear: async () => { key = undefined },
    ...overrides,
  }
}

/** 临时工作区固定放在包内 `tmp/`（已被根 .gitignore 忽略）。 */
async function tempHome(t) {
  const home = fileURLToPath(new URL(`../tmp/api-key-logging-${process.pid}-${++tempCounter}/`, import.meta.url))
  await mkdir(home, { recursive: true })
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

test('探测失败各写一条 warn（target/status/durationMs），成功与 not_run 不写', async () => {
  // 远端失败：只发了一次请求，Key 探测没跑 ⇒ 只有 remote 一条。
  const remote = fakeLogger()
  let calls = 0
  const down = await probeApiKey('test-secret', signal(), async () => { calls++; throw new Error('test-secret') }, NOW, remote)
  assert.equal(calls, 1)
  assert.equal(down.remote.status, 'network_error')
  assert.equal(down.apiKey.status, 'not_run')
  assert.equal(remote.warns.length, 1)
  assert.equal(remote.warns[0].message, 'FTShare 探测未通过')
  assert.deepEqual(Object.keys(remote.warns[0].fields).sort(), ['durationMs', 'status', 'target'])
  assert.equal(remote.warns[0].fields.target, 'remote')
  assert.equal(remote.warns[0].fields.status, 'network_error')
  assert.equal(Number.isFinite(remote.warns[0].fields.durationMs), true)
  assert.ok(remote.warns[0].fields.durationMs >= 0)

  // Key 探测失败：远端通过、Key 被拒 ⇒ 只有 apiKey 一条。
  const keyed = fakeLogger()
  let keyedCalls = 0
  const denied = await probeApiKey('test-secret', signal(), async () => ++keyedCalls === 1 ? response([]) : response(null, 403, '套餐权限不足 test-secret'), NOW, keyed)
  assert.equal(keyedCalls, 2)
  assert.equal(denied.remote.status, 'available')
  assert.equal(denied.apiKey.status, 'permission_denied')
  assert.equal(keyed.warns.length, 1)
  assert.equal(keyed.warns[0].fields.target, 'apiKey')
  assert.equal(keyed.warns[0].fields.status, 'permission_denied')

  // 成功路径：两次探测都通过 ⇒ 一条都不写。
  const healthy = fakeLogger()
  const report = await probeApiKey('test-secret', signal(), async () => response(), NOW, healthy)
  assert.equal(report.status, 'passed')
  assert.deepEqual(healthy.warns, [])

  // 未配置 Key：远端通过、Key 探测根本没发（auth_required）⇒ 也不是失败日志。
  const anonymous = fakeLogger()
  await probeApiKey(undefined, signal(), async () => response(), NOW, anonymous)
  assert.deepEqual(anonymous.warns, [])

  // 三条日志与字段里都不能出现 Key 的值。
  for (const warn of [...remote.warns, ...keyed.warns]) assert.ok(!JSON.stringify(warn).includes('test-secret'))
})

test('验证服务异常 / 凭据不可确认 / 保存失败各写一条 warn，成功路径静默', async () => {
  // 1）validator 抛错 → { stage: 'validate', code: 'validator_failed' }
  const broken = fakeLogger()
  const throwing = createApiKeySettings(store({ resolve: async () => 'test-key' }), async () => { throw new Error('test-secret') }, broken)
  const brokenReport = await throwing.api.testConnection()
  assert.equal(brokenReport.status, 'failed')
  assert.deepEqual(broken.warns, [{ message: 'FTShare 验证服务异常', fields: { stage: 'validate', code: 'validator_failed' } }])

  // 2）验证后无法确认生效凭据 → { stage: 'resolve', code: 'credential_unavailable' }
  const unavailable = fakeLogger()
  let reads = 0
  const flaky = createApiKeySettings(store({
    resolve: async () => { reads += 1; if (reads > 1) throw new Error('provider failure'); return 'test-key' },
  }), async () => structuredClone(passed), unavailable)
  const gone = await flaky.api.testConnection()
  assert.equal(gone.status, 'failed')
  assert.deepEqual(unavailable.warns, [{ message: 'FTShare 凭据不可确认', fields: { stage: 'resolve', code: 'credential_unavailable' } }])

  // 3）保存失败 → { code: 'save_failed' }
  const failing = fakeLogger()
  const unwritable = createApiKeySettings(store({ set: async () => { throw new Error('test-secret') } }), async () => structuredClone(passed), failing)
  const saved = await unwritable.api.configureAndTest('test-secret')
  assert.equal(saved.save.code, 'save_failed')
  assert.deepEqual(failing.warns, [{ message: 'FTShare API Key 保存失败', fields: { code: 'save_failed' } }])

  // 成功路径：保存 + 验证都通过 ⇒ 三条都不出现。
  const quiet = fakeLogger()
  const healthy = createApiKeySettings(store(), async () => structuredClone(passed), quiet)
  const ok = await healthy.api.configureAndTest('test-secret')
  assert.equal(ok.save.status, 'saved')
  assert.equal(ok.validation.status, 'passed')
  assert.deepEqual(quiet.warns, [])

  // 没有 logger 时（既有直接构造的用法）行为不变：不抛错、结果照旧。
  const silent = createApiKeySettings(store({ set: async () => { throw new Error('no logger') } }))
  assert.equal((await silent.api.configureAndTest('test-secret')).save.code, 'save_failed')
})

test('插件入口传插件名 logger：warn 带字段落进采集器，且不含 Key', async t => {
  const home = await tempHome(t)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  const ctx = new Context()
  ctx.provide('credentials', {
    async resolve() { return undefined },
    async describe() { return { configured: false, writable: true } },
    async set() { throw new Error('read-only provider: test-secret') },
    async unset() {},
  })
  const fiber = await ctx.plugin(plugin, { logs: { level: 'warn', maxBytes: 1024 * 1024, keep: 1, sources: [] } })
  t.after(() => fiber.dispose())

  const messages = []
  const off = ctx.logger.exporter({ levels: { default: 3 }, export: message => messages.push(message) })
  t.after(off)

  const result = await ctx.ftshareSettings.apiKey.configureAndTest('test-secret')
  assert.equal(result.save.code, 'save_failed')
  const warn = messages.find(message => message.type === 'warn' && message.args[0] === 'FTShare API Key 保存失败')
  assert.ok(warn, '保存失败没有写 warn')
  // 无参 ctx.logger() ⇒ logger name 就是插件名（规格 §2 第 4 条）。
  assert.equal(warn.name, '@dsh-ft/dsh-fft-settings')
  assert.deepEqual(warn.args[1], { code: 'save_failed' })
  assert.ok(!JSON.stringify(messages).includes('test-secret'))

  await ctx.ftshareSettings.logs.flush()
  const text = await readFile(join(home, 'logs', 'ft', 'current.log'), 'utf8')
  assert.match(text, /WARN {2}@dsh-ft\/dsh-fft-settings FTShare API Key 保存失败 code=save_failed/)
  assert.ok(!text.includes('test-secret'))
})
