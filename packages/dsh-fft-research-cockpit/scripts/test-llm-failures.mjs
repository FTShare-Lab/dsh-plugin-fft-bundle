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
import { missingCredentialGuidance } from '../lib/llm-report.js'

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

// 缺凭据：宿主原文（`llm-deepseek: no API key for provider route "…"`）只进日志，
// 用户看到的是能照做的中文，并且带上出问题的路由名。
const credentialFailure =
  'llm-deepseek: no API key for provider route "deepseek-official"; store FT_API_KEY through the '
  + 'credentials service (the web Models page writes it), or export FT_API_KEY in the launching environment'
const guidance = missingCredentialGuidance(credentialFailure)
assert.ok(guidance, '缺凭据失败必须被识别')
assert.match(guidance, /deepseek-official/u, '指引里要带出问题的路由名')
assert.match(guidance, /模型设置页/u, '指引要说明去哪配')
assert.match(guidance, /切换到已配置的模型/u, '指引要给第二条出路')
assert.ok(!/no API key|FT_API_KEY/u.test(guidance), '英文原文不得进入用户可见文案')

// 已被上层包装的文案（真实路径里失败会被聚合进「某章节生成失败」）同样要识别。
assert.ok(
  missingCredentialGuidance(`结构化 LLM 报告生成失败：技术面分析 轮次校验失败：LLM 请求失败：${credentialFailure}`),
  '包装过的失败文案同样要识别',
)
// 其它失败保持原文，不做二次解释。
assert.equal(missingCredentialGuidance('LLM 返回空内容'), undefined, '非凭据失败不映射')
assert.equal(missingCredentialGuidance('rate limit exceeded'), undefined, '限流不映射为凭据问题')

process.stdout.write('llm routing + failure text ok\n')
