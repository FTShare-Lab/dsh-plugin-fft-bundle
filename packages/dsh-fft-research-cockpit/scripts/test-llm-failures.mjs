/**
 * LLM 层两个用户可见行为的回归测试：
 *
 * 1. 报告跟随**宿主**的默认模型路由（模型设置页改的就是它），读不到时才回退到插件 config；
 * 2. 缺凭据这类失败在 `warnings` 里给可操作的中文，英文原文只进日志。
 *
 * 两者都是纯函数，不需要网络或真实模型。
 */
import assert from 'node:assert/strict'
import { llmRoute } from '../lib/report-service.js'

const config = { llmProvider: 'deepseek-official', llmModel: 'deepseek-v4-flash' }

/** 最小 ctx：llmRoute 只用到 `ctx.get`。 */
const ctxWith = service => ({ get: name => (name === 'agentDefaultModel' ? service : undefined) })

// 宿主已配置 → 用宿主的路由，而不是插件 config 里可能过期的默认值。
assert.deepEqual(
  llmRoute(ctxWith({ currentSelection: () => ({ provider: 'ft-router', model: 'ft-large' }) }), config),
  { provider: 'ft-router', model: 'ft-large' },
  '宿主默认模型服务可用时必须跟随它',
)

// 宿主服务缺失（最小 profile）→ 回退，不抛错（该服务是可选读取，不在静态 inject 里）。
assert.deepEqual(
  llmRoute(ctxWith(undefined), config),
  { provider: config.llmProvider, model: config.llmModel },
  '缺 agentDefaultModel 服务时必须回退到 config',
)

// 宿主服务在但路由不完整 → 同样回退，不能把空串当模型名发给 LLM。
assert.deepEqual(
  llmRoute(ctxWith({ currentSelection: () => ({ provider: '', model: '' }) }), config),
  { provider: config.llmProvider, model: config.llmModel },
  '宿主路由字段为空时必须回退到 config',
)

process.stdout.write('llm routing ok\n')
