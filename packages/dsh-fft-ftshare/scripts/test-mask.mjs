/**
 * 掩码行的行为：只 deny 当前可见的 kline wrapper，晚到的工具再补一次，且绝不抛。
 *
 * 不发网络、不需要 DSH 运行时：`apply()` 的宿主面（`on` / `logger` / agent 的
 * `tools`）用一个假实现顶掉，断言的是「对哪些名字调了 restrict」。
 */
import assert from 'node:assert/strict'

import { MASKED_KLINE_TOOLS, apply, maskPlan, publicToolName } from '../lib/mask.js'

// —— 纯函数：与可见集取交集 ——
assert.deepEqual(maskPlan([]), [], '什么都看不见时不该 deny 任何名字（否则 restrict 会抛）')
assert.deepEqual(maskPlan(['mcp__dsh-kline__fetch_candles']), [], 'kline 的保留工具一条都不掩')
assert.deepEqual(
  maskPlan(['mcp__dsh-kline__market_pulse', 'mcp__dsh-kline__fetch_candles', 'ftshare_call']),
  ['mcp__dsh-kline__market_pulse'],
  '只 deny 可见的 wrapper',
)
assert.deepEqual(
  maskPlan([...MASKED_KLINE_TOOLS.map(publicToolName)]),
  MASKED_KLINE_TOOLS.map(publicToolName),
  '三个 wrapper 全在时全掩',
)

/** 造一个假的 preset 宿主上下文。 */
function fakeHost() {
  const listeners = new Map()
  const warnings = []
  return {
    warnings,
    ctx: {
      on: (event, listener) => {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => {}
      },
      logger: () => ({ info: () => {}, warn: (message, meta) => warnings.push({ message, meta }) }),
    },
    emit: (event, payload) => (listeners.get(event) ?? []).forEach(listener => listener(payload)),
    count: event => (listeners.get(event) ?? []).length,
  }
}

/** 造一个假 agent：可见集会被 restrict 真的改掉，和 DSH 的行为一致。 */
function fakeAgent(visible, options = {}) {
  const restrictCalls = []
  const cleanups = []
  const names = new Set(visible)
  return {
    restrictCalls,
    names,
    cleanups,
    agent: {
      ctx: {
        tools: {
          schemas: () => [...names].map(name => ({ name })),
          restrict: ({ deny }) => {
            if (options.fail === true) throw new Error('unknown global tool "x"')
            restrictCalls.push([...deny])
            // 掩掉的工具从可见集消失——正是「交集即去重」成立的原因。
            for (const name of deny) names.delete(name)
            return () => {}
          },
        },
        effect: (register) => {
          const cleanup = register()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
          return () => {}
        },
      },
    },
  }
}

// —— 创建时：只掩当时可见的那些 ——
const host = fakeHost()
apply(host.ctx)
assert.equal(host.count('agent/created'), 1, '必须监听 agent/created')
assert.equal(host.count('tools/change'), 1, '必须同时监听 tools/change（MCP 工具可能晚到）')

const early = fakeAgent(['mcp__dsh-kline__market_pulse', 'mcp__dsh-kline__fetch_candles'])
host.emit('agent/created', { agent: early.agent })
assert.deepEqual(early.restrictCalls, [['mcp__dsh-kline__market_pulse']], '只 deny kline 的 FTShare wrapper')
assert.ok(early.names.has('mcp__dsh-kline__fetch_candles'), 'kline 保留工具必须还在')
assert.ok(early.cleanups.length === 1, '必须在该 agent 自己的 fiber 上登记清理')

// —— 晚到的工具：tools/change 时补掩，且不重复 append ——
early.names.add('mcp__dsh-kline__security_intelligence')
host.emit('tools/change', {})
assert.deepEqual(early.restrictCalls[1], ['mcp__dsh-kline__security_intelligence'], '晚到的 wrapper 要补掩')
host.emit('tools/change', {})
assert.equal(early.restrictCalls.length, 2, '已掩的名字不再重复 deny（交集即去重）')

// —— 没有 kline 工具的 agent：一次 restrict 都不该发生 ——
const clean = fakeAgent(['ftshare_call', 'ftshare_finance_income'])
host.emit('agent/created', { agent: clean.agent })
host.emit('tools/change', {})
assert.deepEqual(clean.restrictCalls, [], '没有可掩的工具时不许调 restrict（空 filter 会抛）')

// —— restrict 抛错时绝不外抛：agent/created 是串行监听，抛错会连带 agent 创建失败 ——
const broken = fakeAgent(['mcp__dsh-kline__market_pulse'], { fail: true })
host.emit('agent/created', { agent: broken.agent })
assert.equal(host.warnings.length, 1, '抛错要自己吞掉并记一条 warn')
assert.equal(host.warnings[0].message, 'ftshare.mask_failed')

console.log(`mask: ${MASKED_KLINE_TOOLS.length} kline FTShare wrappers masked per agent, late arrivals covered, failures swallowed`)
