/**
 * 上游失败样本的守护测试：用**真实日志/文档里的报文**断言「原文直传 + 四态正确」。
 *
 * 这里不验「我们猜得对不对」——没有猜测可验。只验四件事：
 * 1. 事实抄全（码、HTTP 状态、原文、retryable、档位）；
 * 2. 401/403 → denied，其余 → failed；
 * 3. 数字归一后的指纹稳定，同一类失败聚得起来；
 * 4. 日志按指纹节流（首次带原文，之后每 100 次带计数）。
 *
 * 全部在进程内跑，不发网络。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

import { createFtshareDataService } from '../lib/index.js'
import { classifyFailure, fingerprintOf, permissionNoticeFromPayload } from '../lib/errors.js'
import { createFailureStore, shippedCatalogSummary } from '../lib/status.js'

const FIXED_NOW = () => new Date('2026-11-02T06:00:00.000Z')
const fixtureDir = new URL('../tests/fixtures/upstream/', import.meta.url)

/** 载入全部 fixture。 */
function loadFixtures() {
  return readdirSync(fixtureDir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => JSON.parse(readFileSync(new URL(name, fixtureDir), 'utf8')))
}

/** 把 fixture 的 thrown 还原成一个带 `code` 的 Error。 */
function thrownOf(fixture) {
  const thrown = fixture.thrown
  const message = thrown.envelope === undefined ? thrown.message : JSON.stringify(thrown.envelope)
  const error = new Error(message)
  if (typeof thrown.code === 'number') error.code = thrown.code
  return error
}

/** 造一个只回答一次调用的假 transport。 */
function stubTransport(answer) {
  return {
    async call() {
      if (answer instanceof Error) throw answer
      return { value: answer }
    },
    async listTools() { return [] },
  }
}

/** 按 fixture 期望值断言一次 `call()` 的结果。 */
async function assertFixture(fixture) {
  const store = createFailureStore()
  const service = createFtshareDataService({
    transport: stubTransport(fixture.payload === undefined ? thrownOf(fixture) : fixture.payload),
    now: FIXED_NOW,
    statusStore: store,
  })
  const result = await service.call('ft_v1_finance_income', { stock_code: '600519' })
  const expect = fixture.expect
  assert.equal(result.state, expect.state, `${fixture.name}: state`)
  if (expect.code !== undefined) {
    assert.equal(result.notice?.code ?? null, expect.code, `${fixture.name}: code 照抄上游`)
  }
  if (expect.status !== undefined) {
    assert.equal(result.notice?.upstream?.status ?? null, expect.status, `${fixture.name}: HTTP 状态`)
  }
  if (expect.retryable !== undefined) {
    assert.equal(result.notice?.retryable, expect.retryable, `${fixture.name}: retryable`)
  }
  if (expect.upgradeUrl === true) {
    assert.ok(result.notice?.upgradeUrl?.includes('subscription'), `${fixture.name}: denied 带升级入口`)
  }
  if (expect.upgradeUrl === false) {
    assert.equal(result.notice?.upgradeUrl, undefined, `${fixture.name}: 401 不挂订阅页`)
  }
  if (expect.messageIncludes !== undefined) {
    assert.ok(result.notice?.message.includes(expect.messageIncludes), `${fixture.name}: message`)
  }
  if (expect.rows !== undefined) assert.equal(result.rows.length, expect.rows, `${fixture.name}: rows`)
  if (fixture.payload === undefined) {
    assert.ok(result.notice?.message.startsWith('上游原文：'), `${fixture.name}: 失败说明必须是上游原文`)
    assert.ok(result.notice?.upstream?.fingerprint, `${fixture.name}: 必须留指纹`)
    assert.ok(result.notice?.upstream?.raw.length > 0, `${fixture.name}: 必须留原文`)
  }
  return result
}

// —— 十个真实样本 ——
for (const fixture of loadFixtures()) await assertFixture(fixture)

// —— 401 是凭据：denied 但不挂订阅页（403 才挂）——
{
  const envelope = { error: { code: 'UPSTREAM_PERMISSION_DENIED', message: 'API Key 缺失', upstream_code: 401 } }
  const denied = classifyFailure(new Error(JSON.stringify(envelope)), 'ft_v1_finance_income')
  assert.equal(denied.state, 'denied')
  assert.equal(denied.notice.code, 'UPSTREAM_PERMISSION_DENIED')
  assert.equal(denied.notice.upgradeUrl, undefined, '401 是 Key 问题，不该引到订阅页')
  assert.equal(denied.notice.retryable, false)
}

// —— 指纹稳定：等待时长不同（数字不同）仍是同一个指纹 ——
{
  const make = wait => new Error(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: `最近 1 天最多访问 500 次；请等待 ${wait} 小时后再试`, retryable: true, upstream_code: 429 } }))
  const first = classifyFailure(make(18), 'ft_v1_finance_income')
  const second = classifyFailure(make(4), 'ft_v1_finance_income')
  assert.equal(first.failure.fingerprint, second.failure.fingerprint, '数字归一后同一类失败必须同指纹')
  assert.notEqual(fingerprintOf(429, 'UPSTREAM_UNAVAILABLE', 'a'), fingerprintOf(429, 'UPSTREAM_UNAVAILABLE', 'b'))
}

// —— 日志节流：同一指纹只记首次 + 每 100 次 ——
{
  const calls = []
  const logger = { warn: (event, fields) => calls.push({ event, fields }), info() {}, debug() {}, error() {} }
  const store = createFailureStore()
  const quota = new Error(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: '最近 1 天最多访问 500 次；请等待 18 小时后再试', retryable: true, upstream_code: 429 } }))
  const service = createFtshareDataService({ transport: stubTransport(quota), logger, now: FIXED_NOW, statusStore: store })
  for (let index = 0; index < 99; index += 1) await service.call('ft_v1_finance_income')
  assert.equal(calls.length, 1, '前 99 次同指纹只留一条日志')
  assert.equal(calls[0].event, 'ftshare.call_classified')
  assert.ok(String(calls[0].fields.message).includes('最近 1 天最多访问'), '首次日志必须带原文，fixture 才有来源')
  await service.call('ft_v1_finance_income')
  assert.equal(calls.length, 2, '第 100 次带计数再记一条')
  assert.equal(calls[1].fields.count, 100)
  assert.equal(calls[1].fields.message, undefined, '计数行不重复原文')
  const snapshot = store.snapshot()
  assert.equal(snapshot.totalFailures, 100)
  assert.equal(snapshot.failures[0].count, 100)
  assert.equal(snapshot.failures[0].status, 429)
}

// —— 目录漂移：随包快照 vs 上游实时清单 ——
{
  const store = createFailureStore()
  const tools = [{ tool: 'ft_v1_finance_income', title: '利润表', description: '查询利润表' }]
  const service = createFtshareDataService({
    transport: { async call() { throw new Error('unused') }, async listTools() { return tools } },
    now: FIXED_NOW,
    statusStore: store,
  })
  assert.equal(store.snapshot().catalog.liveCount, undefined, '还没拉清单时不冒充已检查')
  await service.listTools()
  const catalog = store.snapshot().catalog
  assert.equal(catalog.shippedCount, shippedCatalogSummary().count)
  assert.equal(catalog.liveCount, 1)
  assert.equal(catalog.changed, true, '条目数/内容不同必须标出漂移')
  assert.match(catalog.liveHash, /^[0-9a-f]{16}$/u)
}

// —— 权限标记是载荷事实：普通空数组不触发 ——
assert.equal(permissionNoticeFromPayload('ft_v1_finance_income', { data: [] }), undefined)
assert.ok(permissionNoticeFromPayload('ft_v1_finance_income', { metadata: { access_denied: true, message: '订阅未开通' } }))
assert.ok(permissionNoticeFromPayload('ft_v1_finance_income', { metadata: { permissions: [{ code: '403', message: '无权限' }] } }))

console.log(`upstream fixtures: ${loadFixtures().length} samples, facts passed through, 401/403 -> denied, fingerprint + log throttle + catalog drift passed`)
