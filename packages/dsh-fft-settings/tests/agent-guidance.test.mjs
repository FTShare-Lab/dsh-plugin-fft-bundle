// 契约守护：FT 提示词只注册**两段**（能力、数据纪律）+ 一条运行时事实。
//
// 价值在"少一段"这件事上：身份句从 4021ea3 起由 preset 的 persona 行承担，
// 若有人把 `ft:identity` 段加回来，金融模式就会把身份渲染两遍——E2E 能发现，
// 但那要重装 + 重启 + 跑一个回合，代价太大。这里用假 registry 直接盯住段数与顺序。

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import * as agentEntry from '../lib/agent.js'
import {
  FT_CREDENTIALS_CONTEXT,
  FT_CREDENTIALS_MISSING_TEXT,
  FT_CREDENTIALS_ORDER,
  FT_DATA_POLICY_SECTION,
  FT_DATA_POLICY_TEXT,
  FT_SECTION_ORDERS,
  FT_SERVICES_SECTION,
  FT_SERVICES_TEXT,
} from '../lib/guidance.js'

const PACKAGE_ROOT = new URL('../', import.meta.url)

/** The sentence that must live only in the mounting preset's `persona` row. */
const IDENTITY = /非凸\(FT\)金融助手/u

/** A prompt registry that records calls instead of rendering them, and notes disposal. */
function recordingPrompt() {
  const sections = []
  const contexts = []
  const hold = (list) => (entry) => {
    const record = entry
    list.push(record)
    return () => { record.disposed = true }
  }
  return {
    sections,
    contexts,
    section: hold(sections),
    context: hold(contexts),
  }
}

/**
 * Boot the agent-plane entry with a recording prompt registry.
 * @param t - the node:test context, used for disposal.
 * @param options - `apiKey` decides the credential fact and may be omitted to mount
 *   the contract without a settings row at all.
 */
async function boot(t, options = {}) {
  const ctx = new Context()
  const prompt = recordingPrompt()
  ctx.provide('systemPrompt', prompt)
  if (options.apiKey !== undefined) ctx.provide('ftshareSettings', { apiKey: options.apiKey })
  const fiber = await ctx.plugin(agentEntry)
  t.after(() => fiber.dispose())
  return { ctx, prompt }
}

test('ships an ./agent entry that resolves to a built file', async () => {
  // 防的是"改了 src 忘了 build"：git 安装只送达被跟踪文件，lib/ 缺了就装出空壳。
  assert.equal(agentEntry.name, '@dsh-ft/dsh-fft-settings/agent')
  assert.deepEqual(agentEntry.inject, ['systemPrompt'], 'the entry declares exactly the registry it needs')
  assert.equal(typeof agentEntry.apply, 'function')
  const manifest = JSON.parse(readFileSync(new URL('package.json', PACKAGE_ROOT), 'utf8'))
  const built = manifest.exports['./agent'].default
  assert.ok(
    existsSync(fileURLToPath(new URL(built, PACKAGE_ROOT))),
    `package.json exports "./agent" points at ${built}, which must exist in the package`,
  )
})

test('keeps both texts inside their prompt budget and names the tools they promise', async () => {
  // 两段是每次请求都要付的固定成本；超预算说明该搬进 skill。
  assert.ok(FT_SERVICES_TEXT.length <= 130, `FT_SERVICES_TEXT is ${FT_SERVICES_TEXT.length} chars`)
  for (const token of ['dsh-kline', 'search_symbols', 'cockpit_', 'factor-intake-standard', '设置页']) {
    assert.ok(FT_SERVICES_TEXT.includes(token), `FT_SERVICES_TEXT must name ${token}`)
  }
  assert.ok(FT_DATA_POLICY_TEXT.length <= 80, `FT_DATA_POLICY_TEXT is ${FT_DATA_POLICY_TEXT.length} chars`)
  for (const token of ['FTShare', '投资建议']) {
    assert.ok(FT_DATA_POLICY_TEXT.includes(token), `FT_DATA_POLICY_TEXT must name ${token}`)
  }
})

test('registers the capability and data-discipline sections, at orders 6 and 7', async t => {
  const { prompt } = await boot(t)
  assert.deepEqual(
    prompt.sections.map(entry => [entry.name, entry.order, entry.text]),
    [
      [FT_SERVICES_SECTION, FT_SECTION_ORDERS.services, FT_SERVICES_TEXT],
      [FT_DATA_POLICY_SECTION, FT_SECTION_ORDERS.dataPolicy, FT_DATA_POLICY_TEXT],
    ],
    'the contract is exactly these two sections, in this order',
  )
  assert.equal(FT_SECTION_ORDERS.services, 6, 'services must still land after the persona row (order 0)')
  assert.equal(FT_SECTION_ORDERS.dataPolicy, 7, 'data policy must still land before core plan policy (order 500)')
})

test('never states the identity as a section, so the preset renders it once', async t => {
  const { prompt } = await boot(t)
  assert.ok(
    !('identity' in FT_SECTION_ORDERS),
    'an identity section would render the same sentence twice in the finance mode',
  )
  for (const entry of [...prompt.sections, ...prompt.contexts]) {
    // A section carries its text; a runtime-context entry resolves it per request.
    const text = typeof entry.text === 'function' ? entry.text() : entry.text
    assert.doesNotMatch(text, IDENTITY, `"${entry.name}" must not restate the identity`)
  }
  assert.ok(
    !prompt.sections.some(entry => entry.name === 'ft:identity'),
    'the retired ft:identity section must not come back',
  )
})

test('renders the credential fact only once the key is known to be missing', async t => {
  let configured = true
  let notify = () => {}
  const { prompt } = await boot(t, {
    apiKey: {
      async describe() { return { configured } },
      subscribe(listener) { notify = listener; return () => { notify = () => {} } },
    },
  })
  const [fact] = prompt.contexts
  assert.ok(fact, 'the credential fact must register one runtime-context entry')
  assert.equal(fact.name, FT_CREDENTIALS_CONTEXT)
  assert.equal(fact.order, FT_CREDENTIALS_ORDER)

  // Unresolved and configured both render nothing: an unknown fact must not claim
  // the credential is missing.
  assert.equal(fact.text(), '', 'a configured key renders no fact')
  assert.equal(fact.text(), '', 'an unresolved key renders no fact either')

  configured = false
  notify()
  await Promise.resolve()
  assert.equal(fact.text(), FT_CREDENTIALS_MISSING_TEXT, 'a missing key must render its guidance')

  configured = true
  notify()
  await Promise.resolve()
  assert.equal(fact.text(), '', 'configuring the key must retract the fact')
})

test('registers the two sections even when no settings row provides the credential', async t => {
  const { prompt } = await boot(t)
  assert.equal(prompt.contexts.length, 0, 'without ftshareSettings the fact simply does not register')
  assert.equal(prompt.sections.length, 2, 'the contract must not depend on the settings row')
})

test('fails loudly when the prompt registry it declared is missing', () => {
  // `inject: ['systemPrompt']` 是契约：宿主没提供就该炸，而不是静默少两段。
  assert.throws(
    () => agentEntry.apply(new Context()),
    /systemPrompt service is missing/,
    'a missing registry must throw instead of dropping the contract',
  )
})

test('unregisters both sections when the preset subtree goes away', async () => {
  // preset 会随会话装卸；撤不掉的 section 会泄漏到下一个 agent。
  const ctx = new Context()
  const prompt = recordingPrompt()
  ctx.provide('systemPrompt', prompt)
  const fiber = await ctx.plugin(agentEntry)
  assert.equal(prompt.sections.length, 2, 'both sections register on mount')
  assert.ok(prompt.sections.every(entry => entry.disposed !== true), 'nothing is disposed while mounted')

  await fiber.dispose()
  assert.ok(
    prompt.sections.every(entry => entry.disposed === true),
    'every section must be handed back on unmount',
  )
})
