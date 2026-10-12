// 浏览器侧的缝：槽位 `ftshare.settings.card`。
//
// 这里用真实的 SlotCore 承担声明与登记（子槽位声明、按 id 去重、按 order
// 排序都是它的语义），只在它之上补两件运行时的东西：渲染器才有的
// `inject`（声明存在时同步执行、否则等声明）与列表投影 `renderSlot`
// （就是渲染器读 `entriesOfSlot` 的那一步）。因此本文件测的是本插件贡献
// 的注册与渲染位置，而不是自造的注册表。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerSettingsSection } from '../lib/core/shell.js'
import { registerApiKeyCard } from '../lib/features/api-key/card.js'
import { FTSHARE_API_KEY_REF, FTSHARE_SETTINGS_CARD_SLOT, FTSHARE_SETTINGS_SECTION } from '../lib/contract.js'

/** Renderer-shaped slots service over a real SlotCore. */
function createSlots() {
  const core = new SlotCore()
  return {
    register: core.register.bind(core),
    /** Declaration-lifetime hook: run now when declared, otherwise on declaration. */
    inject(key, callback) {
      let dispose
      const activate = () => {
        if (dispose !== undefined || core.spec(key) === undefined) return
        dispose = callback() ?? (() => {})
      }
      const off = core.subscribeDeclaration(key, activate)
      activate()
      return () => { off(); const running = dispose; dispose = undefined; running?.() }
    },
    /** The list dispatch the renderer performs: every winning entry, in order. */
    renderSlot: (key, owner) => core.entriesOfSlot(key).map(entry => entry.component(owner)),
    core,
  }
}

/** The settings shell declares its section slot; nothing may register before that. */
function declareSettingsShell(slots) {
  return slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => 'shell')
}

/** A client context with the invalidation surfaces the built-in card binds. */
function createContext(slots) {
  const subscriptions = []
  return {
    slots,
    subscriptions,
    remote: { $on: (event, listener) => { subscriptions.push([event, listener]); return () => {} } },
    on: (event, listener) => { subscriptions.push([event, listener]); return () => {} },
  }
}

test('the section declares the card slot and renders cards registered through it', async () => {
  const slots = createSlots()
  declareSettingsShell(slots)
  const ctx = createContext(slots)

  // The child slot does not exist until the section declares it, so a direct
  // registration before that is a load-time error, exactly as the framework
  // reports it.
  assert.throws(() => slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: 'too-early' }, () => 'too-early'), /is not declared/)

  const disposeSection = registerSettingsSection(ctx)
  const section = slots.core.entriesOfSlot('settings.section')
  assert.equal(section.length, 1)
  assert.deepEqual(section[0].options, { id: FTSHARE_SETTINGS_SECTION.id, order: FTSHARE_SETTINGS_SECTION.order, label: FTSHARE_SETTINGS_SECTION.label })
  // Declaring the child slot is what authorizes the section's render site.
  assert.deepEqual(section[0].children, { [FTSHARE_SETTINGS_CARD_SLOT]: { kind: 'list', scope: 'root' } })
  assert.deepEqual(slots.core.spec(FTSHARE_SETTINGS_CARD_SLOT), { kind: 'list', scope: 'root' })

  // The section's own component is the single render site for every card.
  assert.deepEqual(slots.renderSlot(FTSHARE_SETTINGS_CARD_SLOT, {}), [])
  slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: 'cockpit', order: 40, label: '投研舱' }, () => 'cockpit-card')

  const tree = section[0].component({ renderSlot: slots.renderSlot })
  const [, cards] = tree.props.children
  assert.deepEqual(cards, ['cockpit-card'])
  // The shell renders its own CSS in front of the cards.
  assert.match(tree.props.children[0].props.children, /--ftshare-text/)

  disposeSection()
  assert.equal(slots.core.spec(FTSHARE_SETTINGS_CARD_SLOT), undefined)
})

test('a card that registers before the section waits for the declaration and then renders', async () => {
  const slots = createSlots()
  declareSettingsShell(slots)
  const ctx = createContext(slots)
  let disposeCard
  // `settings.section` exists, but its child slot is declared by the section
  // entry the built-in client contributes; until then the card only waits.
  assert.doesNotThrow(() => { disposeCard = registerApiKeyCard(ctx) })
  assert.deepEqual(slots.core.entries(FTSHARE_SETTINGS_CARD_SLOT), [])

  const disposeSection = registerSettingsSection(ctx)
  const entries = slots.core.entriesOfSlot(FTSHARE_SETTINGS_CARD_SLOT)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].options, { id: 'apiKey', order: 10 })
  assert.equal(slots.renderSlot(FTSHARE_SETTINGS_CARD_SLOT, {}).length, 1)

  disposeCard()
  assert.deepEqual(slots.core.entries(FTSHARE_SETTINGS_CARD_SLOT), [])
  disposeSection()
})

test('the built-in card registers late, sorts by order and keeps its invalidation wiring', async () => {
  const slots = createSlots()
  declareSettingsShell(slots)
  const ctx = createContext(slots)
  const disposeSection = registerSettingsSection(ctx)

  // The built-in card arrives after the declaration, exactly like any other.
  const disposeCard = registerApiKeyCard(ctx)
  slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: 'cockpit', order: 40, label: '投研舱' }, () => 'cockpit-card')
  slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: 'no-order' }, () => 'no-order-card')

  const entries = slots.core.entriesOfSlot(FTSHARE_SETTINGS_CARD_SLOT)
  // The ledger sorts list entries by ascending `order`, and the ui-slots
  // runtime reads a missing `order` as 0 — so a card that omits `order` lands
  // in front of the built-in one (order 10) and an explicit order is the only
  // way to place a card after it.
  assert.deepEqual(entries.map(entry => entry.options.id), ['no-order', 'apiKey', 'cockpit'])
  assert.deepEqual(entries[1].options, { id: 'apiKey', order: 10 })

  // No priority is published: the built-in card only declares id/order, so a
  // second card claiming the same id at the same priority is a load-time error.
  assert.throws(() => slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: 'apiKey' }, () => null), /already has an entry with id "apiKey"/)

  const [, card] = slots.renderSlot(FTSHARE_SETTINGS_CARD_SLOT, {})
  assert.equal(typeof card.props.api.describe, 'function')
  let notified = 0
  const off = card.props.subscribeChanges(() => { notified++ })
  assert.deepEqual(ctx.subscriptions.map(([event]) => event), ['credentials/reference-updated', 'connection/reset'])
  const [[, credentialListener], [, resetListener]] = ctx.subscriptions
  credentialListener('ANOTHER_KEY')
  assert.equal(notified, 0, 'another credential reference never invalidates this card')
  credentialListener(FTSHARE_API_KEY_REF)
  resetListener()
  assert.equal(notified, 2)
  off()

  disposeCard()
  assert.deepEqual(slots.renderSlot(FTSHARE_SETTINGS_CARD_SLOT, {}), ['no-order-card', 'cockpit-card'])
  disposeSection()
})
