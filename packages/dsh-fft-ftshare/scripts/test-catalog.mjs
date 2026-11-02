/**
 * 目录产物的守护测试：与接口表对齐、可复现、可被 `ftshare_call` 正确使用。
 *
 * 不发任何网络请求：目录是盘上的产物，`ftshare_call` 的取数用假服务顶掉。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { FTSHARE_CAPABILITIES } from '../lib/capabilities.js'
import { asCatalog, catalogEntryOf, missingRequiredArgs } from '../lib/catalog.js'
import { renderArtifacts, renderIndex, toCatalogEntries } from './build-catalog.mjs'

const packageRoot = new URL('..', import.meta.url)
const catalogRaw = readFileSync(new URL('catalog.json', packageRoot), 'utf8')
const indexRaw = readFileSync(new URL('catalog.txt', packageRoot), 'utf8')
const meta = JSON.parse(readFileSync(new URL('catalog.meta.json', packageRoot), 'utf8'))
const catalog = asCatalog(JSON.parse(catalogRaw))

// —— 目录新鲜度：条目数与生成时间可核对 ——
assert.ok(catalog.entries.length > 0, '目录不能是空的')
assert.equal(meta.count, catalog.entries.length, 'catalog.meta.json 的条目数必须与 catalog.json 一致')
assert.ok(!Number.isNaN(Date.parse(meta.generatedAt)), '生成时间必须可解析')
assert.equal(meta.catalogBytes, Buffer.byteLength(catalogRaw), '元数据里的字节数必须与实际产物一致')
assert.equal(meta.indexBytes, Buffer.byteLength(indexRaw), '元数据里的索引字节数必须与实际产物一致')
assert.ok(meta.count >= 250, `目录条目数应覆盖上游全量，实际 ${meta.count}`)

// —— 索引格式：名字 | 标题 | 入参名（必填带 *）——
{
  const lines = indexRaw.trimEnd().split('\n')
  assert.equal(lines.length, catalog.entries.length, '索引一行一个接口')
  for (const line of lines) assert.match(line, /^ft_v\d+_[a-z0-9_]+ \| .+ \| [^\s|]*$/u, `索引行格式不对：${line}`)
  assert.ok(indexRaw.includes('*'), '必填入参要带 * 标记')
}

// —— 接口表里每个 interface 都必须在目录里 ——
{
  const names = new Set(catalog.entries.map(entry => entry.name))
  const missing = FTSHARE_CAPABILITIES.filter(entry => !names.has(entry.interface))
  assert.deepEqual(missing.map(entry => entry.interface), [], '接口表里的接口名必须都能在目录里找到')
}

// —— 生成器可复现：同样输入产出同样字节 ——
{
  const tools = [{ tool: 'ft_v2_demo', title: '示例', description: '说明', inputSchema: { type: 'object', required: ['date'], properties: { date: { type: 'string' } } } }]
  const entries = toCatalogEntries(tools)
  assert.deepEqual(entries.map(entry => entry.name), ['ft_v2_demo'])
  const first = renderArtifacts(entries, '2026-10-16T00:00:00.000Z')
  const second = renderArtifacts(toCatalogEntries(tools), '2026-10-16T00:00:00.000Z')
  assert.deepEqual(first, second, '同样输入必须产出同样字节')
  assert.equal(first.index, 'ft_v2_demo | 示例 | date*\n', '必填入参加 *')
  assert.deepEqual(renderIndex([]), '\n', '空目录也是一行（空行）')
  // 条目顺序不影响产物：排序在 toCatalogEntries 里做掉。
  const shuffled = toCatalogEntries([...tools, { tool: 'ft_v1_demo', title: '甲' }])
  assert.deepEqual(shuffled.map(entry => entry.name), ['ft_v1_demo', 'ft_v2_demo'])
}

// —— 形状不对的目录：丢条目而不是留半条 ——
{
  assert.deepEqual(asCatalog(undefined).entries, [])
  assert.deepEqual(asCatalog({ entries: [{ title: '没有名字' }, { name: 'ft_v1_ok' }] }).entries, [{ name: 'ft_v1_ok', title: 'ft_v1_ok' }])
}

// —— 入参预校验：只说「缺谁」 ——
{
  const entry = catalogEntryOf(catalog, 'ft_v1_report_announcements_list')
  assert.ok(entry, '这个接口必须在目录里')
  assert.deepEqual(missingRequiredArgs(entry, {}), ['date'])
  assert.deepEqual(missingRequiredArgs(entry, { date: '20261015' }), [])
  assert.deepEqual(missingRequiredArgs(entry, { date: null }), ['date'], 'null 等于没给')
  assert.deepEqual(missingRequiredArgs({ name: 'x', title: 'x' }, {}), [], '没有 schema 就不预校验')
}

// —— ftshare_call：三种结局各有各的话 ——
{
  const { apply } = await import('../lib/tools.js')
  const registered = []
  const calls = []
  const noticeOf = state => state === 'denied'
    ? { code: 'UPSTREAM_PERMISSION_DENIED', message: '上游原文：当前套餐无权访问该接口', upgradeUrl: 'https://ftai.chat/me/profile?tab=subscription', retryable: false, upstream: { raw: '{"error":{"code":"UPSTREAM_PERMISSION_DENIED","upstream_code":403}}', status: 403, fingerprint: '0123456789abcdef' } }
    : { code: 'UPSTREAM_UNAVAILABLE', message: '上游原文：最近 1 天最多访问 500 次；请等待后再试', retryable: true, upstream: { raw: '{"error":{"code":"UPSTREAM_UNAVAILABLE","upstream_code":429}}', status: 429, fingerprint: 'fedcba9876543210' } }
  const toolCtx = {
    logger: () => ({ warn: () => {} }),
    tools: { register: definition => { registered.push(definition); return () => {} } },
    ftshareData: {
      async call(name, args) {
        calls.push({ name, args })
        const state = name === 'ft_v1_finance_income' ? 'denied' : 'failed'
        return { ok: false, state, rows: [], notice: noticeOf(state), source: { name: 'FTShare', fetchedAt: '2026-10-16T00:00:00.000Z' } }
      },
    },
  }
  apply(toolCtx)
  const callTool = registered.find(definition => definition.name === 'ftshare_call')
  assert.ok(callTool, 'preset 平面必须注册 ftshare_call')

  const unknown = await callTool.execute({ interface: 'ft_v9_not_in_catalog' }, { signal: undefined })
  assert.equal(unknown.state, 'failed')
  assert.ok(unknown.text.includes('目录里没有接口 ft_v9_not_in_catalog'), '目录外的名字要说清是名字问题')
  assert.ok(unknown.text.includes('catalog.txt'), '要给出索引文件路径，让模型去 grep')
  assert.equal(calls.length, 0, '目录外的名字不许出站')

  const missingArg = await callTool.execute({ interface: 'ft_v1_report_announcements_list', args: {} }, { signal: undefined })
  assert.equal(missingArg.state, 'failed')
  assert.ok(missingArg.text.includes('缺必填入参：date'), '缺参要直说缺谁')
  assert.equal(calls.length, 0, '缺参不许出站')

  const denied = await callTool.execute({ interface: 'ft_v1_finance_income', args: { stock_code: '600519' } }, { signal: undefined })
  assert.equal(denied.state, 'denied')
  assert.ok(denied.text.includes('无权访问'), '无权要说无权')
  assert.ok(denied.text.includes('升级入口'), '无权要带升级入口')
  assert.deepEqual(calls.at(-1), { name: 'ft_v1_finance_income', args: { stock_code: '600519' } })

  const failed = await callTool.execute({ interface: 'ft_v2_announcements_stock_announcements', args: { type: 'stock', stock_code: '600519', page: 1, page_size: 30 } }, { signal: undefined })
  assert.equal(failed.state, 'failed')
  assert.ok(failed.text.includes('上游原文'), '失败原文要直传，模型才看得到上游说了什么')
  assert.ok(failed.text.includes('最多访问'), '配额原文要保住，不换成我们自己的文案')
}

console.log(`catalog: ${catalog.entries.length} entries, table interfaces present, generator reproducible, ftshare_call outcomes covered`)
