/**
 * FT 日志采集器 / 导出器测试（`node --test`，跑 `lib/` 产物）。
 *
 * 覆盖：exporter 级别语义（含默认门槛丢 warn 的坑）、节流合并、脱敏、轮转与保留份数、
 * 启动回填、RPC 白名单、导出体积封顶、flush 可见性、dispose 后 exporter 移除，
 * 以及接缝直挂（`createSettingsHost` + `modules.register(createLogsModule(...))`）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'
import { Config, DEFAULT_LOGS_CONFIG } from '../lib/index.js'
import { parseLogsConfig, resolveLogsConfig } from '../lib/features/logs/config.js'
import { FtLogCollector } from '../lib/features/logs/collector.js'
import { byteLength, formatDownloadFileName, formatLogLine } from '../lib/features/logs/format.js'
import { resolveDshHome } from '../lib/features/logs/home.js'
import { buildLogExport } from '../lib/features/logs/export.js'
import { createLogsModule } from '../lib/features/logs/index.js'
import { statsPlaceholder } from '../lib/features/logs/card.js'
import { createLogsRpcMethods } from '../lib/features/logs/rpc.js'
import { createSettingsHost } from '../lib/core/module-registry.js'
import { createSettingsRpcHandler } from '../lib/core/rpc-core.js'

const signal = () => new AbortController().signal
const clockStart = Date.parse('2026-10-12T15:04:05.123+08:00')
let tempCounter = 0

/** 临时工作区固定放在包内 `tmp/`（已被根 .gitignore 忽略）。 */
async function tempHome(t) {
  const home = fileURLToPath(new URL(`../tmp/logs-test-${process.pid}-${++tempCounter}/`, import.meta.url))
  await mkdir(home, { recursive: true })
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

const logPath = home => join(home, 'logs', 'ft', 'current.log')

/** 一份可解析的假 credentials 服务（任何用例都不发真实请求）。 */
const credentials = {
  async resolve() { return undefined },
  async describe() { return { configured: false, writable: true } },
  async set() {},
  async unset() {},
}

/** 把 `$DSH_HOME` 指向临时目录，并在用例结束后还原。 */
function useHome(t, home) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
}

/** 启动整个插件（含真实采集器），返回 Context。 */
async function boot(t, { home, config } = {}) {
  useHome(t, home)
  const ctx = new Context()
  ctx.provide('credentials', credentials)
  const fiber = config === undefined ? await ctx.plugin(plugin) : await ctx.plugin(plugin, config)
  t.after(() => fiber.dispose())
  return { ctx, fiber }
}

/** 采集器直连用例：可控时钟、定时器不自动触发，保证 flush 语义可断言。 */
function makeCollector(home, overrides = {}) {
  const notifications = []
  const collector = new FtLogCollector({
    directory: join(home, 'logs', 'ft'),
    level: 'debug',
    maxBytes: 1024 * 1024,
    keep: 1,
    now: () => overrides.clock?.value ?? clockStart,
    schedule: () => () => {},
    selfReport: line => notifications.push(line),
    ...overrides.options,
  })
  return { collector, notifications }
}

async function readLines(path) {
  const text = await readFile(path, 'utf8')
  return text.split('\n').filter(line => line.length > 0)
}

test('exporter levels are an upper bound: debug collects every level, the default drops warn', async () => {
  const ctx = new Context()
  const all = []
  const info = []
  const standard = []
  const dispose = [
    ctx.logger.exporter({ levels: { default: 3 }, export: message => all.push(message.type) }),
    ctx.logger.exporter({ levels: { default: 1 }, export: message => info.push(message.type) }),
    ctx.logger.exporter({ export: message => standard.push(message.type) }),
  ]
  const log = ctx.logger('ft-probe')
  log.error('错误')
  log.info('信息')
  log.warn('警告')
  log.debug('调试')
  assert.deepEqual(all, ['error', 'info', 'warn', 'debug'])
  assert.deepEqual(info, ['error', 'info'])
  // 省略 levels 等价于 default: 1 —— warn 被静默丢弃，这正是不能把 ctx.logger.buffer 当数据源的原因。
  assert.deepEqual(standard, ['error', 'info'])
  assert.deepEqual([...new Set(ctx.logger.buffer.map(message => message.type))].sort(), ['error', 'info'])
  for (const off of dispose) off()
})

test('collector uses the configured level as the exporter threshold and writes the spec line format', async t => {
  const home = await tempHome(t)
  const { collector } = makeCollector(home, { options: { level: 'warn' } })
  assert.equal(collector.threshold, 2)
  collector.append({ ts: clockStart, type: 'debug', name: 'ft-probe', args: ['调试不该出现'] })
  collector.append({ ts: clockStart, type: 'warn', name: 'ft-probe', args: ['FTShare 调用失败', { attempt: 3, tool: 'stock_minutes' }] })
  await collector.flush()
  const lines = await readLines(collector.filePath)
  assert.equal(lines.length, 1)
  assert.equal(lines[0], '2026-10-12T15:04:05.123+08:00 WARN  ft-probe FTShare 调用失败 attempt=3 tool=stock_minutes')
  assert.equal(formatLogLine({ ts: clockStart, type: 'warn', name: 'ft-probe', args: ['单行'] }).startsWith('2026-10-12T15:04:05.123+08:00 WARN  ft-probe '), true)
})

test('同一 key 在 10 秒窗口内合并为一行并带重复次数', async t => {
  const home = await tempHome(t)
  const clock = { value: clockStart }
  const { collector } = makeCollector(home, { clock })
  const record = { ts: clockStart, type: 'warn', name: 'ft-probe', args: ['FTShare 调用失败', { attempt: 1 }] }
  // 三次调用的时间戳不同：节流 key 不含时间戳，仍应合并为一行。
  for (let index = 0; index < 3; index += 1) collector.append({ ...record, ts: clockStart + index })
  // 窗口内不会落盘（flush 才强制写出），合并后只有一行。
  await collector.flush()
  let lines = await readLines(collector.filePath)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /重复次数=3$/)

  clock.value = clockStart + 10_001
  collector.append(record)
  await collector.flush()
  lines = await readLines(collector.filePath)
  assert.equal(lines.length, 2)
  assert.ok(!lines[1].includes('重复次数'))
})

test('flush 之前不落盘，flush 之后内容可见', async t => {
  const home = await tempHome(t)
  const { collector } = makeCollector(home)
  collector.append({ ts: clockStart, type: 'error', name: 'ft-probe', args: ['flush-可见性标记'] })
  await assert.rejects(readFile(collector.filePath, 'utf8'), /ENOENT/)
  await collector.flush()
  assert.match(await readFile(collector.filePath, 'utf8'), /flush-可见性标记/)
  const stats = collector.stats()
  assert.equal(stats.records, 1)
  assert.equal(stats.rotations, 0)
  assert.equal(stats.writeFailures, 0)
  assert.deepEqual(stats.byName, { 'ft-probe': 1 })
})

test('脱敏：假 Key、token、cookie 与当前密钥精确值都不进文件', async t => {
  const home = await tempHome(t)
  const secret = 'Zx9Qw2Lm4Rt6'
  const { collector } = makeCollector(home, { options: { secrets: async () => [secret] } })
  collector.append({
    ts: clockStart,
    type: 'warn',
    name: 'ft-probe',
    args: [
      'Bearer abcdefghijklmnop FTSHARE_API_KEY=plainsecret123456 sk-live-abcdef123456 '
      + '0123456789abcdef0123456789abcdef Authorization: Basic Zm9vYmFyYmF6 Cookie: session=deadbeef '
      + `当前密钥 ${secret}`,
    ],
  })
  await collector.flush()
  const text = await readFile(collector.filePath, 'utf8')
  for (const leaked of ['abcdefghijklmnop', 'plainsecret123456', 'sk-live-abcdef123456', '0123456789abcdef0123456789abcdef', 'Zm9vYmFyYmF6', 'deadbeef', secret]) {
    assert.ok(!text.includes(leaked), `泄漏了 ${leaked}`)
  }
  assert.match(text, /FTSHARE_API_KEY=\*\*\*/)
  assert.match(text, /Bearer \*\*\*/)
})

test('单行超过 8 KiB 时截断并标注', async t => {
  const home = await tempHome(t)
  const { collector } = makeCollector(home)
  collector.append({ ts: clockStart, type: 'error', name: 'ft-probe', args: [`长消息 ${'x'.repeat(20_000)}`] })
  await collector.flush()
  const [line] = await readLines(collector.filePath)
  assert.ok(byteLength(line) <= 8 * 1024)
  assert.match(line, /\.\.\.\[已截断\]$/)
})

test('轮转：超过 maxBytes 生成轮转文件并只保留 keep 份', async t => {
  const home = await tempHome(t)
  const clock = { value: clockStart }
  const { collector, notifications } = makeCollector(home, {
    clock,
    options: { maxBytes: 256, keep: 2 },
  })
  for (let index = 0; index < 20; index += 1) {
    clock.value += 11_000
    collector.append({ ts: clock.value, type: 'warn', name: 'ft-probe', args: [`记录-${index}`, { pad: 'y'.repeat(60) }] })
  }
  await collector.flush()
  const files = await readdir(collector.filePath.replace(/\/current\.log$/, ''))
  const rotated = files.filter(name => name.startsWith('ft-') && name.endsWith('.log'))
  assert.equal(rotated.length, 2)
  assert.equal(collector.stats().rotations > 0, true)
  assert.ok(notifications.some(line => line.includes('轮转')))
})

test('backfill 把注册前缓冲里的 error/info 补写进文件，warn 不可恢复', async t => {
  const home = await tempHome(t)
  useHome(t, home)
  const ctx = new Context()
  ctx.provide('credentials', credentials)
  // 采集器挂载之前打的日志：cordis 内置缓冲只留 error/info。
  ctx.logger('ft-early').error('early-error-marker')
  ctx.logger('ft-early').info('early-info-marker')
  ctx.logger('ft-early').warn('early-warn-marker')
  assert.deepEqual(ctx.logger.buffer.map(message => message.type), ['error', 'info'])
  const fiber = await ctx.plugin(plugin, { logs: { level: 'warn', maxBytes: 1024 * 1024, keep: 2, sources: [] } })
  t.after(() => fiber.dispose())
  await ctx.ftshareSettings.logs.flush()
  const text = await readFile(logPath(home), 'utf8')
  assert.match(text, /early-error-marker/)
  assert.match(text, /early-info-marker/)
  assert.ok(!text.includes('early-warn-marker'))
})

const DEFAULT_LOGS = { level: 'warn', maxBytes: 8 * 1024 * 1024, keep: 3, sources: [] }

test('Config 是原生 Schemastery schema：DSH 配置收集器的判定式通过，validate 补齐完整默认值', () => {
  // DSH 判定（app-boot/src/config-schema/native.ts）：不满足会得到 entry.status='unsupported'
  // 与一条 error 诊断，logs.* 进不了 profile 的配置 schema / 配置编辑器。
  // `Config` 由插件入口把 feature 自己的 logs 子 schema 组合出来。
  assert.equal(Reflect.get(Config, Symbol.for('schemastery')), true)
  assert.equal(typeof Reflect.get(Config, 'type'), 'string')
  const meta = Reflect.get(Config, 'meta')
  assert.equal(meta !== null && typeof meta === 'object', true)
  assert.equal(Config['~standard'].version, 1)
  // 无配置行时 cordis 传的是 `{}` 而不是 `undefined`：两者都必须补齐完整默认值。
  assert.deepEqual(Config['~standard'].validate(undefined), { value: { logs: DEFAULT_LOGS } })
  assert.deepEqual(Config['~standard'].validate({}), { value: { logs: DEFAULT_LOGS } })
  assert.deepEqual(Config['~standard'].validate({ logs: { level: 'debug' } }).value.logs, { ...DEFAULT_LOGS, level: 'debug' })
  // 非法值是 error 而不是夹紧：插件不挂载（见下一个用例）。
  assert.equal('issues' in Config['~standard'].validate({ logs: { keep: 99 } }), true)
  assert.equal('issues' in Config['~standard'].validate({ logs: { level: 'info' } }), true)
})

test('apply 完全不传 config、以及无配置行的 {}，都能挂载并回报默认 stats', async t => {
  const home = await tempHome(t)
  // boot 在 config 为 undefined 时调用 ctx.plugin(plugin)（一个参数都不传）。
  const { ctx } = await boot(t, { home })
  const stats = await ctx.ftshareSettings.logs.stats()
  assert.equal(stats.level, 'warn')
  assert.equal(stats.maxBytes, 8 * 1024 * 1024)
  assert.equal(stats.keep, 3)
  assert.deepEqual(stats.sources, [])

  const emptyHome = await tempHome(t)
  const { ctx: emptyCtx } = await boot(t, { home: emptyHome, config: {} })
  const emptyStats = await emptyCtx.ftshareSettings.logs.stats()
  assert.equal(emptyStats.level, 'warn')
  assert.equal(emptyStats.maxBytes, 8 * 1024 * 1024)
  assert.equal(emptyStats.keep, 3)
})

test('接缝直挂：createSettingsHost + register(createLogsModule(默认配置)) 不依赖任何插件配置', async t => {
  const home = await tempHome(t)
  useHome(t, home)
  const ctx = new Context()
  ctx.provide('credentials', credentials)
  const host = createSettingsHost()
  ctx.provide('ftshareSettings', host.service)
  // owner 用一根可释放的 fiber，注册表把命名空间挂在它上面。
  const fiber = await ctx.plugin({ apply() {} })
  t.after(() => fiber.dispose())

  const registration = host.service.modules.register(createLogsModule(resolveLogsConfig(undefined)), fiber.ctx)
  assert.equal(registration.namespace, 'logs')
  assert.deepEqual(host.service.modules.namespaces(), ['logs'])
  const stats = await registration.service.stats()
  assert.equal(stats.level, 'warn')
  assert.equal(stats.maxBytes, 8 * 1024 * 1024)
  assert.equal(stats.keep, 3)
  assert.deepEqual(stats.sources, [])
  // 采集器在注册期就挂上了：owner fiber 上的 logger 记录会落盘。
  ctx.logger('ft-probe').warn('接缝直挂标记')
  await registration.service.flush()
  assert.match(await readFile(logPath(home), 'utf8'), /接缝直挂标记/)

  registration.dispose()
  assert.equal(host.service.logs, undefined)
  assert.deepEqual(host.service.modules.namespaces(), [])
})

test('配置写错（level 非法 / 数值越界）→ cordis 抛 ValidationError，插件整体不挂载', async t => {
  const home = await tempHome(t)
  useHome(t, home)
  for (const config of [
    { logs: { level: 'info' } },
    { logs: { level: 'verbose' } },
    { logs: { keep: 99 } },
    { logs: { maxBytes: 1024 } },
  ]) {
    const ctx = new Context()
    ctx.provide('credentials', credentials)
    await assert.rejects(async () => { await ctx.plugin(plugin, config) }, error => {
      assert.match(String(error?.message ?? error), /invalid config/)
      assert.match(String(error?.message ?? error), /logs/)
      return true
    })
    assert.equal(ctx.ftshareSettings, undefined)
  }
  // 没有任何配置被接受，也就没有任何日志文件被创建。
  await assert.rejects(readFile(logPath(home), 'utf8'), /ENOENT/)
})

test('内部兜底解析仍然容错（不参与 DSH schema 收集，仅给绕过 cordis 校验的调用方）', () => {
  // 子 schema 归 feature：入参是整个插件配置，只取 `logs` 这一片。
  assert.deepEqual(parseLogsConfig(undefined), { value: DEFAULT_LOGS })
  assert.equal('issues' in parseLogsConfig({ logs: { level: 'verbose' } }), true)
  // 兜底路径同样不认 info 档：接收上限会把 warn 一起丢掉。
  assert.equal('issues' in parseLogsConfig({ logs: { level: 'info' } }), true)
  assert.equal(resolveLogsConfig({ logs: { level: 'verbose' } }).level, 'warn')
  assert.equal(resolveLogsConfig({ logs: { level: 'debug', keep: 99 } }).keep, 20)
  assert.deepEqual(resolveLogsConfig({}), DEFAULT_LOGS)
  // 默认值里的 sources 每次都是新数组，调用方改写不会污染 DEFAULT_LOGS_CONFIG。
  assert.notEqual(resolveLogsConfig(undefined).sources, DEFAULT_LOGS_CONFIG.sources)
})

test('RPC 白名单：坏 payload → bad_request，未登记方法 → not_found', async t => {
  const home = await tempHome(t)
  const { ctx } = await boot(t, { home })
  const handler = createSettingsRpcHandler([{ namespace: 'logs', rpcMethods: createLogsRpcMethods(ctx.ftshareSettings.logs) }])
  for (const payload of [{ extra: 1 }, [], null, 3, 'stats']) {
    assert.equal((await handler('logs/stats', payload, signal())).error.code, 'bad_request')
  }
  for (const payload of [{ lines: 0 }, { lines: 201 }, { lines: 1.5 }, { lines: '80' }, { lines: 80, extra: 1 }, null]) {
    assert.equal((await handler('logs/preview', payload, signal())).error.code, 'bad_request')
  }
  for (const endpoint of ['logs/clear', 'logs/flush', 'logs/sources', 'logs/stats/extra', 'other/stats']) {
    assert.equal((await handler(endpoint, {}, signal())).error.code, 'not_found')
  }
  const ok = await handler('logs/preview', { lines: 5 }, signal())
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value.lines, [])
  assert.equal((await handler('logs/stats', {}, signal())).ok, true)
  assert.equal((await handler('logs/export', {}, signal())).ok, true)
})

test('导出：header 含来源条数、时间范围、盲区，超限截断并标 truncated', async t => {
  const home = await tempHome(t)
  const { collector } = makeCollector(home)
  collector.append({ ts: clockStart, type: 'warn', name: 'ft-probe', args: ['主日志标记'] })
  await collector.flush()
  const big = join(home, 'plugins.log')
  await writeFile(big, `${'x'.repeat(8 * 1024)}\n`.repeat(400), 'utf8')
  const result = await buildLogExport({
    filePath: collector.filePath,
    sources: [`~/${'不存在'}.log`, big],
    homeDisplay: '~/.dsh',
    pluginVersion: '0.2.0',
  })
  assert.match(result.fileName, /^ft-runtime-\d{8}-\d{6}\.log$/)
  assert.match(result.text, /# truncated=true/)
  assert.match(result.text, /# 覆盖盲区：/)
  assert.match(result.text, /FT 插件日志（本进程 cordis）/)
  assert.match(result.text, /条数=1/)
  assert.match(result.text, /时间范围=2026-10-12T15:04:05\.123\+08:00/)
  assert.match(result.text, /缺失/)
  assert.match(result.text, /===== /)
  const extra = result.summaries.find(item => item.path === big)
  assert.equal(extra.truncated, true)
  assert.ok(extra.bytes <= 2 * 1024 * 1024)
  // 合计上限 8 MiB：单来源已被截到 2 MiB，整体仍在预算内。
  assert.ok(byteLength(result.text) <= 8 * 1024 * 1024 + 64 * 1024)
  assert.equal(formatDownloadFileName(clockStart), 'ft-runtime-20261012-150405.log')
})

test('导出：合计 8 MiB 封顶，超出的来源标注未纳入', async t => {
  const home = await tempHome(t)
  const primary = join(home, 'current.log')
  await writeFile(primary, 'primary\n', 'utf8')
  const sources = []
  const line = `2026-10-12T15:04:05.123+08:00 INFO  probe ${'z'.repeat(900)}\n`
  for (let index = 0; index < 5; index += 1) {
    const path = join(home, `extra-${index}.log`)
    await writeFile(path, line.repeat(2300), 'utf8')
    sources.push(path)
  }
  const result = await buildLogExport({ filePath: primary, sources, homeDisplay: '~/.dsh', pluginVersion: '0.2.0' })
  assert.equal(result.truncated, true)
  assert.ok(byteLength(result.text) <= 8 * 1024 * 1024 + 128 * 1024)
  assert.equal(result.summaries.filter(item => item.truncated).length >= 1, true)
})

test('设置页接口：stats / preview / export 走 RPC 全链路，dispose 后 exporter 被移除', async t => {
  const home = await tempHome(t)
  const { ctx, fiber } = await boot(t, { home, config: { logs: { level: 'warn', maxBytes: 1024 * 1024, keep: 1, sources: [] } } })
  const logs = ctx.ftshareSettings.logs
  const exporterCount = ctx.logger.exporters.size
  ctx.logger('ft-probe').warn('RPC-导出标记', { attempt: 2 })
  assert.ok(ctx.logger.exporters.size >= exporterCount)
  await logs.flush()

  const stats = await logs.stats()
  assert.equal(stats.records >= 1, true)
  assert.equal(stats.byName['ft-probe'], 1)
  const preview = await logs.preview(10)
  assert.match(preview.lines.join('\n'), /RPC-导出标记/)
  assert.equal(preview.truncated, false)
  const exported = await logs.export()
  assert.match(exported.text, /RPC-导出标记/)
  assert.match(exported.text, /# 生成时间：/)
  assert.match(exported.text, /# 插件版本：@ft\/dsh-fft-settings \d+\.\d+\.\d+/)
  assert.match(exported.text, /# 运行时：node v/)
  assert.equal(exported.fileName.endsWith('.log'), true)

  await fiber.dispose()
  assert.equal(ctx.logger.exporters.size, exporterCount - 1)
  ctx.logger('ft-probe').warn('dispose-之后不该再采集')
  await new Promise(resolve => setTimeout(resolve, 20))
  const text = await readFile(logPath(home), 'utf8')
  assert.ok(!text.includes('dispose-之后不该再采集'))
})

test('浏览器产物不含采集器、文件系统与配置校验代码', async () => {
  const map = JSON.parse(await readFile(new URL('../lib/client.js.map', import.meta.url), 'utf8'))
  for (const hostFile of ['src/features/logs/collector.ts', 'src/features/logs/export.ts', 'src/features/logs/home.ts', 'src/features/logs/host.ts', 'src/features/logs/rpc.ts', 'src/features/logs/config.ts']) {
    assert.ok(!map.sources.some(source => source.endsWith(hostFile)), hostFile)
  }
  assert.ok(map.sources.some(source => source.endsWith('src/features/logs/card.tsx')))
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const builtin of ['node:fs', 'node:path', 'node:os']) assert.ok(!bundle.includes(builtin), builtin)
})

test('$DSH_HOME \u652f\u6301 ~ \u5c55\u5f00\uff0c\u7a7a\u767d\u503c\u89c6\u4e3a\u672a\u8bbe\u7f6e', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '~/custom-home' }), join(homedir(), 'custom-home'))
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
  assert.equal(resolveDshHome({ DSH_HOME: '/abs/path' }), '/abs/path')
  assert.equal(resolveDshHome({}), join(homedir(), '.dsh'))
})

test('读取失败后字段不再说「读取中」，且失败文案确实进了浏览器产物', async () => {
  assert.equal(statsPlaceholder(false), '读取中…')
  assert.equal(statsPlaceholder(true), '读取失败')
  // 产物断言：卡片源码改了但没重建时，这里会先红。
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(bundle.includes('读取失败'))
})
