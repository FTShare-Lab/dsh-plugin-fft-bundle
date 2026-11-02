/**
 * `call()` 的归一与四态映射，用假 transport，**不发任何网络请求**。
 *
 * 重点是 P8：同一个「空结果」在三种成因下必须落成三个不同的 state——
 * 真的没有（`empty`，且必须有正向证据）、上游拒绝（`denied`）、取数失败（`failed`）——
 * 并且 `denied`/`failed` 各自带上照抄上游的 notice。
 */
import assert from 'node:assert/strict'
import { createFtshareDataService, normalizeRows, observePayload } from '../lib/index.js'
import { classifyFailure, permissionNoticeFromPayload } from '../lib/errors.js'

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

/** 一个真实形态的上游错误信封。 */
function envelopeOf(code, message, extra = {}) {
  return new Error(JSON.stringify({ error: { code, message, ...extra } }))
}

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

// —— empty：必须来自「已知容器为空数组」的正向证据 ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v2_report_stock_reports: { ok: true, data: [], metadata: { source: 'ftshare' } } }), now: FIXED_NOW })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'empty', 'data 为空数组才是 empty')
  assert.equal(result.ok, true, 'empty 说明通道是通的')
  assert.deepEqual(result.rows, [])
  assert.equal(result.notice, undefined)
}

// —— 成功信封但没有数据容器证据：不能冒充「没有数据」——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v2_report_stock_reports: { ok: true, message: '无数据' } }), now: FIXED_NOW })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'failed', '没有正向证据就不是 empty')
  assert.ok(result.notice.message.includes('没有可识别的数据容器'), '要说清是形状问题')
  assert.ok(result.notice.upstream?.fingerprint, '未识别载荷同样要留指纹')
}

// —— denied：上游 403 + 信封码（真实形态）——
{
  const error = envelopeOf('UPSTREAM_PERMISSION_DENIED', '当前套餐无权访问该接口', { retryable: false, upstream_code: 403 })
  const service = createFtshareDataService({ transport: stubTransport({ ft_v2_report_stock_reports: error }), now: FIXED_NOW })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'denied', '403 必须落成 denied，而不是 empty')
  assert.equal(result.ok, false)
  assert.equal(result.notice.code, 'UPSTREAM_PERMISSION_DENIED', '码照抄，不改写')
  assert.equal(result.notice.upstream.status, 403)
  assert.equal(result.notice.retryable, false)
  assert.equal(result.notice.requiredPlan, undefined, '上游没给档位就不写')
  assert.ok(result.notice.upgradeUrl.includes('subscription'))
  assert.ok(result.notice.message.startsWith('上游原文：'))
  assert.ok(result.notice.upstream.raw.includes('UPSTREAM_PERMISSION_DENIED'))
}

// —— denied：401 是凭据问题，不挂订阅页 ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: envelopeOf(undefined, 'API Key 缺失', { upstream_code: 401 }) }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'denied')
  assert.equal(result.notice.code, '401', '没有上游码时用 HTTP 状态（事实）')
  assert.equal(result.notice.upgradeUrl, undefined)
}

// —— denied：成功信封里带权限标记（P8 第二形态）——
{
  const service = createFtshareDataService({
    transport: stubTransport({ ft_v2_report_stock_reports: { ok: true, data: [], metadata: { permissions: [{ code: '403', message: '订阅未开通该接口' }] } } }),
    now: FIXED_NOW,
  })
  const result = await service.call('ft_v2_report_stock_reports')
  assert.equal(result.state, 'denied', '成功信封里的权限标记同样是 denied')
  assert.ok(result.notice.message.includes('上游在成功响应里标注了权限限制'))
}

// —— failed：配额 429，原文直传、retryable 照抄 ——
{
  const quota = envelopeOf('UPSTREAM_UNAVAILABLE', '［用户通知］最近 1 天最多访问 500 次；请等待 18 小时后再试', { retryable: true, upstream_code: 429 })
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: quota }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'failed', '额度用尽不是权限拒绝')
  assert.equal(result.notice.code, 'UPSTREAM_UNAVAILABLE')
  assert.equal(result.notice.upstream.status, 429)
  assert.equal(result.notice.retryable, true)
  assert.ok(result.notice.message.includes('最多访问'), '原文要原样带出来')
  assert.ok(!result.notice.message.includes('免费配额用尽'), '不再编我们自己的配额文案')
}

// —— failed：网络失败也是 failed，不是 empty；传输事实可重试 ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: new Error('fetch failed') }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'failed')
  assert.deepEqual(result.rows, [])
  assert.equal(result.notice.retryable, true)
  assert.equal(result.notice.code, undefined, '没有码就不编码')
}

// —— failed：参数被上游拒绝，retryable 照上游 false ——
{
  const service = createFtshareDataService({ transport: stubTransport({ ft_v1_finance_income: envelopeOf('INVALID_ARGUMENT', '参数值不满足约束', { retryable: false }) }), now: FIXED_NOW })
  const result = await service.call('ft_v1_finance_income')
  assert.equal(result.state, 'failed')
  assert.equal(result.notice.code, 'INVALID_ARGUMENT')
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

// —— 载荷观测的判定边界（empty 的证据只来自已知容器）——
assert.equal(observePayload({ data: [] }).emptyEvidence, true)
assert.equal(observePayload({ data: [{}] }).rows.length, 1)
assert.equal(observePayload({ ok: true, message: '无数据' }).unrecognized, true, '只有信封字段不算证据')
assert.equal(observePayload({ history: [] }).unrecognized, true, '非容器空数组不算证据')
assert.equal(observePayload({ ok: true, history: [{ a: 1 }] }).rows.length, 1, '非空仍允许兜底')
assert.equal(observePayload({ code: '600519', name: '贵州茅台' }).rows.length, 1, '单对象返回值也是一行数据')
assert.equal(observePayload({ data: [{ a: 1 }] }).rows.length, 1)
assert.equal(observePayload(undefined).unrecognized, true)
assert.deepEqual(normalizeRows({ ok: true, data: [] }), [])
assert.deepEqual(normalizeRows([{ a: 1 }]), [{ a: 1 }])
assert.deepEqual(normalizeRows('text'), [])

// —— 解析与归一的直接行为 ——
assert.equal(classifyFailure(new Error('timeout'), 'ft_v1_finance_income').state, 'failed')
assert.equal(classifyFailure(new Error('权限不足'), 'ft_v1_finance_income').state, 'failed', '没有 401/403 就不猜权限')
assert.equal(permissionNoticeFromPayload('ft_v1_finance_income', { data: [] }), undefined, '普通空数组不触发权限遮罩')
assert.ok(permissionNoticeFromPayload('ft_v1_finance_income', { metadata: { access_denied: true, message: '订阅未开通' } }))

console.log('ftshareData.call: four-state normalization, positive empty evidence, raw notices, rows and tool listing passed')

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

// —— 工具平面（preset）：注册接口表里暴露的条目 + ftshare_call + ftshare_status ——
{
  const { apply } = await import('../lib/tools.js')
  const registered = []
  const toolCtx = {
    tools: { register: definition => { registered.push(definition); return () => {} } },
    ftshareData: {
      async call(tool) {
        if (tool === 'ft_v1_finance_income') {
          return { ok: true, state: 'available', rows: [{ title: '600519', value: '1.00亿', detail: '收入' }], source: { name: 'FTShare', fetchedAt: '2026-10-13T06:00:00.000Z' } }
        }
        return {
          ok: false,
          state: 'denied',
          rows: [],
          notice: {
            code: 'UPSTREAM_PERMISSION_DENIED',
            message: '上游原文：当前套餐无权访问该接口',
            requiredPlan: 'Advanced',
            upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription',
            retryable: false,
            upstream: { raw: '{"error":{"code":"UPSTREAM_PERMISSION_DENIED","upstream_code":403}}', status: 403, fingerprint: '0123456789abcdef' },
          },
          source: { name: 'FTShare', fetchedAt: '2026-10-13T06:00:00.000Z' },
        }
      },
    },
  }
  apply(toolCtx)
  assert.equal(registered.length, 10, '8 条暴露能力 + ftshare_call + ftshare_status')
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
  assert.ok(denied.text.includes('上游给出的所需档位：Advanced'))
  assert.ok(denied.text.includes('上游状态：HTTP 403'))
  assert.ok(!denied.text.includes('=0'))

  const statusTool = registered.find(definition => definition.name === 'ftshare_status')
  assert.ok(statusTool, '要有失败现场入口')
  const statusValue = await statusTool.execute({}, { signal: undefined })
  assert.ok(statusValue.text.includes('FTShare 失败聚合'))
  assert.ok(statusValue.text.includes('目录：随包 250 条'), '要给出随包目录规模')
}

console.log('provider plane: provide ftshareData, credentials deferred to settings; tools plane: 8 ftshare_* tools plus ftshare_call and ftshare_status, four states in the body passed')
