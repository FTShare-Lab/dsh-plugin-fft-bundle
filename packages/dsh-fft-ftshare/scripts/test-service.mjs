/**
 * `call()` 的归一与三态映射，用假 transport，**不发任何网络请求**。
 *
 * 重点是 P8：同一个「空结果」在三种成因下必须落成三个不同的 state——
 * 真的没有（`empty`）、套餐没开通（`denied`）、取数失败（`failed`）——并且
 * `denied`/`failed` 各自带上可展示的 notice。
 */
import assert from 'node:assert/strict'
import { createFtshareDataService, normalizeRows } from '../lib/index.js'
import { classifyFailure, parseUpstreamError, permissionNoticeFromPayload } from '../lib/errors.js'

/** 造一个按脚本作答的假 transport。 */
function stubTransport(script, options = {}) {
  const calls = []
  let listCalls = 0
  return {
    calls,
    get listCalls() { return listCalls },
    async call(tool, args, callOptions) {
      calls.push({ tool, args, options: callOptions })
      const answer = script[tool]
      if (answer === undefined) throw new Error(`未编排的工具：${tool}`)
      if (typeof answer === 'function') return answer(args)
      if (answer instanceof Error) throw answer
      return { value: answer }
    },
    async listTools() {
      listCalls += 1
      if (options.listToolsError !== undefined) throw options.listToolsError
      return [{
        tool: 'ft_v1_finance_income',
        title: '利润表',
        description: '查询龙虎榜明细',
        inputSchema: { type: 'object', properties: { stock_code: { type: 'string' } }, required: ['stock_code'] },
      }]
    },
  }
}

const FIXED_NOW = () => new Date('2026-10-13T06:00:00.000Z')

// —— available：真的拿到行 ——
{
  const transport = stubTransport({ ft_v1_finance_income: { data: [{ stock_code: '600519', revenue: 1 }] } })
  const service = createFtshareDataService({ transport, now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income', { stock_code: '600519' })
  assert.equal(result.state, 'available')
  assert.equal(result.ok, true)
  assert.equal(result.rows.length, 1)
  assert.equal(result.notice, undefined)
  assert.equal(result.source.name, 'FTShare')
  assert.equal(result.source.fetchedAt, '2026-10-13T06:00:00.000Z')
  assert.equal(transport.calls[0].tool, 'ft_v1_finance_income')
  assert.deepEqual(transport.calls[0].args, { stock_code: '600519' })
}

// —— empty：调用成功，但确实没有数据 ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v2_report_stock_reports: { ok: true, data: [], metadata: { source: 'ftshare' } } }), now: FIXED_NOW })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'empty', '成功但无行才是 empty')
  assert.equal(result.ok, true, 'empty 说明通道是通的')
  assert.deepEqual(result.rows, [])
  assert.equal(result.notice, undefined)
}

// —— denied：网关 403 route_not_allowed ——
{
  const error = new Error(JSON.stringify({ error: { code: 'route_not_allowed', message: 'route not allowed for the current plan' } }))
  const service = createFtshareDataService({ transport: stubTransport({ ft_v2_report_stock_reports: error }), now: FIXED_NOW })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'denied', '套餐无权限必须落成 denied，而不是 empty')
  assert.equal(result.ok, false)
  assert.equal(result.notice.code, 'route_not_allowed')
  assert.equal(result.notice.retryable, false)
  assert.equal(result.notice.requiredPlan, undefined, '上游没给档位就不猜，接口版本号不是档位依据')
  assert.ok(result.notice.upgradeUrl.includes('subscription'))
  assert.ok(result.notice.message.includes('无权访问'))
  assert.ok(result.notice.message.includes('不代表「没有数据」'), '提示必须点破「不是没有数据」这个误读')
}

// —— denied：另一家网关的 403 capability_limited（P8 实测形态）——
{
  const error = new Error('403 capability_limited: FTShare API Key 有效，但当前套餐未开通此项数据能力。')
  const service = createFtshareDataService({ transport: stubTransport({ ft_v2_limit_event_timeline_3s: error }), now: FIXED_NOW })
  const result = await service.call('ft_v2_limit_event_timeline_3s')
  assert.equal(result.state, 'denied')
  assert.equal(result.notice.code, 'capability_limited')
  assert.ok(result.notice.message.includes('更高的档位'), '上游没给档位时只说「更高的档位」，不猜具体套餐')
}

// —— denied：成功信封里带权限标记 ——
{
  const service = createFtshareDataService({
    transport: stubTransport({ ft_v2_report_stock_reports: { ok: true, data: [], metadata: { permissions: [{ code: '403', message: '订阅未开通该接口' }] } } }),
    now: FIXED_NOW,
  })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'denied', '成功信封里的权限标记同样是 denied')
  assert.ok(result.notice.message.includes('无权访问'))
}

// —— failed：限流可重试 ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: new Error('rate_limited: 请求过于频繁') }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'failed')
  assert.equal(result.notice.retryable, true)
  assert.ok(!result.notice.message.includes('无权访问'), '限流不是权限问题')
}

// —— failed：网络失败也是 failed，不是 empty ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: new Error('fetch failed: ECONNREFUSED') }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'failed')
  assert.deepEqual(result.rows, [])
}

// —— 未配置凭据导致的拒绝也是 denied，不是 empty ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: new Error('auth_required: FTShare 未收到 API Key，请检查配置后重试。') }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'denied')
  assert.equal(result.notice.code, 'auth_required')
  assert.equal(result.notice.retryable, false)
}

// —— listTools 自己触发拉取、保留说明与入参 schema、短 TTL 内不再拉 ——
{
  const transport = stubTransport({})
  const service = createFtshareDataService({ transport, now: FIXED_NOW })
  const listed = await service.listTools()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].title, '利润表')
  assert.equal(listed[0].description, '查询龙虎榜明细', '目录产物要靠 description')
  assert.deepEqual(listed[0].inputSchema.properties.stock_code, { type: 'string' }, '入参 schema 要保住，ftshare_call 的预校验用它')
  assert.equal(transport.listCalls, 1, '不需要先调通一次')
  await service.listTools()
  assert.equal(transport.listCalls, 1, 'TTL 内走缓存')
}

// —— 上游不可达时退回空清单，不抛 ——
{
  const service = createFtshareDataService({ transport: stubTransport({}, { listToolsError: new Error('ECONNREFUSED') }), now: FIXED_NOW })
  assert.deepEqual(await service.listTools(), [], '清单是增强信息，拿不到就是空，不是异常')
}

// —— normalizeRows 的判定边界 ——
assert.deepEqual(normalizeRows({ data: [{ a: 1 }] }), [{ a: 1 }])
assert.deepEqual(normalizeRows([{ a: 1 }]), [{ a: 1 }])
assert.deepEqual(normalizeRows({ ok: true, data: [] }), [], '信封里没东西才是「没有数据」')
assert.deepEqual(normalizeRows({ ok: true, message: '无数据' }), [], '只有信封字段时不算事实')
assert.deepEqual(normalizeRows({ code: '600519', name: '贵州茅台' }), [{ code: '600519', name: '贵州茅台' }], '单对象返回值也是一行数据')
assert.deepEqual(normalizeRows({ ok: true, history: [{ a: 1 }] }), [{ a: 1 }], '兜底扫描能找到非标准键下的数组')
assert.deepEqual(normalizeRows(undefined), [])
assert.deepEqual(normalizeRows('text'), [])

// —— 解析与归一的直接行为 ——
assert.deepEqual(parseUpstreamError(new Error('{"error":{"code":"403","message":"forbidden"}}')), { code: '403', message: 'forbidden' })
assert.equal(classifyFailure(new Error('timeout'), 'ft_v1_finance_income').state, 'failed')
assert.equal(classifyFailure(new Error('权限不足'), 'ft_v1_finance_income').state, 'denied')
assert.equal(permissionNoticeFromPayload('ft_v1_finance_income', { data: [] }), undefined, '普通空数组不触发权限遮罩')
assert.ok(permissionNoticeFromPayload('ft_v1_finance_income', { metadata: { access_denied: true, message: '订阅未开通' } }))

console.log('ftshareData.call: four-state normalization, notices, rows and tool listing passed')

// —— 宿主入口（全局平面）：只能 provide 服务，凭据只从设置服务取 ——
{
  const { apply } = await import('../lib/index.js')
  const provided = new Map()
  const resolved = []
  const hostCtx = {
    logger: () => ({ warn: () => {} }),
    ftshareSettings: { apiKey: { resolve: async () => { resolved.push('resolve'); return 'test-key' } } },
    provide: (name, value) => { provided.set(name, value) },
  }
  apply(hostCtx)
  assert.ok(provided.has('ftshareData'), '宿主入口必须 provide ftshareData')
  assert.deepEqual([...provided.keys()], ['ftshareData'], '宿主入口只提供这一个服务')
  // 凭据在每次调用时重新 resolve；这里只验证注入的是设置服务的那个函数，
  // 不触发任何网络请求（真实 transport 只在这一步之后才会被用到）。
  assert.equal(resolved.length, 0, 'apply 阶段不读凭据')
}

// —— 工具平面（preset）：注册接口表里暴露的条目，四态原样进正文 ——
{
  const { apply } = await import('../lib/tools.js')
  const registered = []
  const toolCtx = {
    logger: () => ({ warn: () => {} }),
    tools: { register: definition => { registered.push(definition); return () => {} } },
    ftshareData: {
      async call(tool, args) {
        if (tool === 'ft_v1_finance_income') {
          return { ok: true, state: 'available', rows: [{ title: '600519', value: '1.00亿', detail: '收入' }], source: { name: 'FTShare', fetchedAt: '2026-10-13T06:00:00.000Z' } }
        }
        return {
          ok: false,
          state: 'denied',
          rows: [],
          notice: { code: 'route_not_allowed', message: 'FTShare 无权访问该接口', requiredPlan: 'Advanced', upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription', retryable: false },
          source: { name: 'FTShare', fetchedAt: '2026-10-13T06:00:00.000Z' },
        }
      },
    },
  }
  apply(toolCtx)
  assert.equal(registered.length, 9, '接口表里 8 条暴露能力，外加通用直调 ftshare_call')
  const names = registered.map(definition => definition.name)
  assert.equal(new Set(names).size, names.length, '工具名不能重复')
  for (const name of names) assert.ok(name.startsWith('ftshare_'), `${name} 必须用 ftshare_ 前缀`)
  for (const banned of ['security_intelligence', 'market_pulse', 'fetch_candles', 'analyze_kline', 'search_symbols']) {
    assert.ok(!names.includes(`ftshare_${banned}`), `不许重复 dsh_kline 已有的能力：${banned}`)
  }

  const income = registered.find(definition => definition.name === 'ftshare_finance_income')
  const value = await income.execute({ stock_code: '600519' }, { signal: undefined })
  assert.equal(value.state, 'available')
  assert.ok(value.text.includes('利润表（ft_v1_finance_income）：可用'))
  assert.ok(value.text.includes('1.00亿'), '正文必须带上明细，而不是只报状态')
  assert.deepEqual(income.output.render({ stock_code: '600519' }, value), [{ type: 'text', text: value.text }])

  const reports = registered.find(definition => definition.name === 'ftshare_stock_reports')
  const denied = await reports.execute({ stock_code: '600519', page: 1, page_size: 30 }, { signal: undefined })
  assert.equal(denied.state, 'denied')
  assert.ok(denied.text.includes('无权访问'), '无权访问必须写在正文里，模型才看得到')
  assert.ok(denied.text.includes('所需订阅：Advanced'))
  assert.ok(!denied.text.includes('=0'))
}

console.log('provider plane: provide ftshareData, credentials deferred to settings; tools plane: 8 ftshare_* tools plus ftshare_call, four states in the body passed')
