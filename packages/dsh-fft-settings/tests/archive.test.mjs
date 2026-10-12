/**
 * FT 诊断包（zip，P2）测试：归档结构、manifest 字段、同一 8 MiB 未压缩预算下的截断、
 * 缺失来源只进 manifest、`/api/ftshare-settings/logs.zip` 路由契约与卸载撤销，
 * 以及「诊断包代码不进浏览器产物」的守卫。
 *
 * 归档正文与单文件导出共用 `loadLogExport` / `renderLogExport`，所以这里直接断言
 * 「zip 里的 ft-runtime.log == 单文件导出的 text」，避免两条路径悄悄漂移。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'
import { FTSHARE_SETTINGS_ROUTE } from '../lib/contract.js'
import {
  LOGS_ARCHIVE_LOG,
  LOGS_ARCHIVE_MANIFEST,
  LOGS_ARCHIVE_ROUTE,
  LOGS_ARCHIVE_SOURCE_DIR,
  LOGS_EXPORT_MAX_BYTES,
  LOGS_SOURCE_MAX_BYTES,
} from '../lib/features/logs/contract.js'
import { buildLogArchive, createLogsArchiveRoute } from '../lib/features/logs/archive.js'
import { buildLogExport } from '../lib/features/logs/export.js'

const clockStart = Date.parse('2026-10-12T15:04:05.123+08:00')
const decoder = new TextDecoder()
const asText = bytes => decoder.decode(bytes)
const LOG_LINE = `2026-10-12T15:04:05.123+08:00 INFO  ft-probe ${'z'.repeat(900)}\n`
let tempCounter = 0

/** 临时工作区固定放在包内 `tmp/`（已被根 .gitignore 忽略）。 */
async function tempHome(t) {
  const home = fileURLToPath(new URL(`../tmp/archive-test-${process.pid}-${++tempCounter}/`, import.meta.url))
  await mkdir(home, { recursive: true })
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

/** 写一个至少有 `bytes` 字节的日志文件（行结构完整，便于断言行数）。 */
async function writeSized(path, bytes) {
  await writeFile(path, LOG_LINE.repeat(Math.ceil(bytes / LOG_LINE.length)), 'utf8')
}

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

test('诊断包含 manifest、ft-runtime.log 与来源原文，日志文本与单文件导出逐字一致', async t => {
  const home = await tempHome(t)
  const primary = join(home, 'current.log')
  const extra = join(home, 'plugins.log')
  await writeFile(primary, '2026-10-12T15:04:05.123+08:00 WARN  ft-probe 主日志标记\n', 'utf8')
  await writeFile(extra, '2026-10-12T15:04:06.000+08:00 WARN  kpan 插件日志标记\n2026-10-12T15:04:07.000+08:00 ERROR kpan 第二条\n', 'utf8')

  const options = {
    filePath: primary,
    sources: [extra],
    homeDisplay: '~/.dsh',
    pluginVersion: '0.3.0',
    environment: 'node v22.19.0 darwin arm64',
    now: () => clockStart,
  }
  const archive = await buildLogArchive(options)
  const files = unzipSync(archive.bytes)
  const names = Object.keys(files)

  assert.equal(names[0], LOGS_ARCHIVE_MANIFEST, 'manifest 排在第一位')
  assert.deepEqual(names, [LOGS_ARCHIVE_MANIFEST, LOGS_ARCHIVE_LOG, `${LOGS_ARCHIVE_SOURCE_DIR}1-plugins.log`])
  assert.equal(archive.fileName, 'ft-runtime-20261012-150405.zip')
  assert.equal(archive.truncated, false)

  // zip 里的日志与单文件导出是同一份文本：两条导出路径不会漂移。
  const single = await buildLogExport(options)
  assert.equal(asText(files[LOGS_ARCHIVE_LOG]), single.text)
  assert.match(asText(files[LOGS_ARCHIVE_LOG]), /主日志标记/)

  const manifest = JSON.parse(asText(files[LOGS_ARCHIVE_MANIFEST]))
  assert.equal(manifest.generatedAt, '2026-10-12T15:04:05.123+08:00')
  assert.equal(manifest.pluginVersion, '@ft/dsh-fft-settings 0.3.0')
  assert.equal(manifest.runtime, 'node v22.19.0 darwin arm64')
  assert.equal(manifest.home, '~/.dsh')
  assert.deepEqual(manifest.limits, {
    sourceBytes: LOGS_SOURCE_MAX_BYTES,
    archiveBytes: LOGS_EXPORT_MAX_BYTES,
    maxSourceFiles: 20,
  })
  assert.equal(manifest.truncated, false)
  assert.deepEqual(manifest.entries.map(entry => entry.name), [LOGS_ARCHIVE_LOG, `${LOGS_ARCHIVE_SOURCE_DIR}1-plugins.log`])
  assert.equal(manifest.blindSpots.length, 4)
  assert.ok(manifest.blindSpots.some(line => line.includes('渲染进程')))

  const [main, plugin] = manifest.sources
  assert.equal(main.entry, LOGS_ARCHIVE_LOG)
  assert.equal(main.lines, 1)
  assert.equal(main.bytes, Buffer.byteLength(await readFile(primary, 'utf8')))
  assert.equal(main.firstAt, '2026-10-12T15:04:05.123+08:00')
  assert.equal(main.lastAt, '2026-10-12T15:04:05.123+08:00')
  assert.equal(main.missing, undefined)
  assert.equal(plugin.entry, `${LOGS_ARCHIVE_SOURCE_DIR}1-plugins.log`)
  assert.equal(plugin.lines, 2)
  assert.equal(plugin.firstAt, '2026-10-12T15:04:06.000+08:00')
  assert.equal(plugin.lastAt, '2026-10-12T15:04:07.000+08:00')
  assert.equal(plugin.truncated, false)
  // 原文进归档，内容与磁盘一致。
  assert.equal(asText(files[`${LOGS_ARCHIVE_SOURCE_DIR}1-plugins.log`]), await readFile(extra, 'utf8'))
})

test('归档以未压缩字节共用 8 MiB 预算：原文被截断、后续来源只进 manifest', async t => {
  const home = await tempHome(t)
  const primary = join(home, 'current.log')
  await writeSized(primary, 1024 * 1024)
  const extras = []
  for (let index = 0; index < 3; index += 1) {
    const path = join(home, `extra-${index}.log`)
    await writeSized(path, 2 * 1024 * 1024)
    extras.push(path)
  }

  const archive = await buildLogArchive({
    filePath: primary,
    sources: extras,
    homeDisplay: '~/.dsh',
    // 版本允许是 promise：host 侧直接把 readPluginVersion() 塞进来。
    pluginVersion: Promise.resolve('0.3.0'),
    environment: 'node v22 test',
    now: () => clockStart,
  })
  const files = unzipSync(archive.bytes)
  const manifest = JSON.parse(asText(files[LOGS_ARCHIVE_MANIFEST]))

  assert.equal(manifest.pluginVersion, '@ft/dsh-fft-settings 0.3.0')
  assert.equal(archive.truncated, true)
  assert.equal(manifest.truncated, true)
  // 未压缩总量（含 header/manifest 的一点点开销）不越过同一预算。
  const uncompressed = Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0)
  assert.ok(uncompressed <= LOGS_EXPORT_MAX_BYTES + 64 * 1024, `未压缩总量 ${uncompressed}`)

  const sourceEntries = Object.keys(files).filter(name => name.startsWith(LOGS_ARCHIVE_SOURCE_DIR))
  assert.deepEqual(sourceEntries, [`${LOGS_ARCHIVE_SOURCE_DIR}1-extra-0.log`], '只剩第一个来源拿到剩余额度')
  assert.ok(files[`${LOGS_ARCHIVE_SOURCE_DIR}1-extra-0.log`].byteLength <= LOGS_SOURCE_MAX_BYTES)

  const byPath = new Map(manifest.sources.map(source => [source.path, source]))
  assert.equal(byPath.get(extras[0]).truncated, true, '被剩余额度切短的原文标 truncated')
  assert.equal(byPath.get(extras[0]).entry, `${LOGS_ARCHIVE_SOURCE_DIR}1-extra-0.log`)
  for (const path of extras.slice(1)) {
    assert.equal(byPath.get(path).entry, undefined, '预算耗尽后不再进归档')
    assert.equal(byPath.get(path).truncated, true)
  }
})

test('缺失来源只写进 manifest，不进归档也不报错', async t => {
  const home = await tempHome(t)
  const primary = join(home, 'current.log')
  await writeFile(primary, 'primary\n', 'utf8')
  const missing = `~/${'不存在'}来源-${tempCounter}.log`

  const archive = await buildLogArchive({
    filePath: primary,
    sources: [missing],
    homeDisplay: '$DSH_HOME',
    pluginVersion: '0.3.0',
    environment: 'node v22 test',
    now: () => clockStart,
  })
  const files = unzipSync(archive.bytes)
  const names = Object.keys(files)
  assert.deepEqual(names, [LOGS_ARCHIVE_MANIFEST, LOGS_ARCHIVE_LOG])
  const manifest = JSON.parse(asText(files[LOGS_ARCHIVE_MANIFEST]))
  const [main, gone] = manifest.sources
  assert.equal(main.entry, LOGS_ARCHIVE_LOG)
  assert.equal(gone.missing, true)
  assert.equal(gone.entry, undefined)
  assert.equal(gone.lines, 0)
  assert.match(gone.path, /来源-\d+\.log$/)
})

test('GET 路由：精确路径、三个响应头、无参数依赖，body 是可解开的 zip', async t => {
  const home = await tempHome(t)
  const primary = join(home, 'current.log')
  const extra = join(home, 'plugins.log')
  await writeFile(primary, '2026-10-12T15:04:05.123+08:00 WARN  ft-probe 路由标记\n', 'utf8')
  await writeFile(extra, 'extra-line\n', 'utf8')

  const route = createLogsArchiveRoute({
    filePath: primary,
    sources: [extra],
    homeDisplay: '~/.dsh',
    pluginVersion: '0.3.0',
    environment: 'node v22 test',
    now: () => clockStart,
  })
  assert.equal(route.path, LOGS_ARCHIVE_ROUTE)
  assert.equal(LOGS_ARCHIVE_ROUTE, '/api/ftshare-settings/logs.zip')
  assert.deepEqual(route.methods, ['GET'])
  assert.equal(route.requestBody, 'buffered')

  // 带 query 也照常出包：路由不读任何参数。
  const response = await route.fetch(new Request(`http://dsh.internal${LOGS_ARCHIVE_ROUTE}?ignored=1`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="ft-runtime-20261012-150405.zip"')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  assert.deepEqual(Object.keys(files), [LOGS_ARCHIVE_MANIFEST, LOGS_ARCHIVE_LOG, `${LOGS_ARCHIVE_SOURCE_DIR}1-plugins.log`])
  assert.match(asText(files[LOGS_ARCHIVE_LOG]), /路由标记/)
})

test('诊断包路由由 logs feature 自己挂上，并随 owner fiber 释放被撤销', async t => {
  const home = await tempHome(t)
  useHome(t, home)
  const ctx = new Context()
  ctx.provide('credentials', credentials)
  // 载体由外部提供：记录 register，并让 disposer 可观测。
  const registered = []
  const removed = []
  ctx.provide('connection', {
    fetch: {
      register(route) {
        registered.push(route)
        return async () => { removed.push(route.path) }
      },
    },
  })
  const fiber = await ctx.plugin(plugin)
  t.after(() => fiber.dispose())
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(
    registered.map(route => route.path).sort(),
    [FTSHARE_SETTINGS_ROUTE, LOGS_ARCHIVE_ROUTE].sort(),
  )
  const archiveRoute = registered.find(route => route.path === LOGS_ARCHIVE_ROUTE)
  assert.deepEqual(archiveRoute.methods, ['GET'])

  // 走真实链路：collector 刷盘 → 读文件 → 打包 → 响应。
  ctx.logger('ft-probe').warn('诊断包标记')
  const response = await archiveRoute.fetch(new Request(`http://dsh.internal${LOGS_ARCHIVE_ROUTE}`))
  assert.equal(response.status, 200)
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  assert.match(asText(files[LOGS_ARCHIVE_LOG]), /诊断包标记/)

  await fiber.dispose()
  assert.deepEqual(removed.sort(), [FTSHARE_SETTINGS_ROUTE, LOGS_ARCHIVE_ROUTE].sort())
})

test('诊断包代码不进浏览器产物：archive/export/fflate 与 node 内建都不出现', async () => {
  const map = JSON.parse(await readFile(new URL('../lib/client.js.map', import.meta.url), 'utf8'))
  for (const hostFile of ['src/features/logs/archive.ts', 'src/features/logs/export.ts', 'src/features/logs/host.ts', 'src/features/logs/collector.ts']) {
    assert.ok(!map.sources.some(source => source.endsWith(hostFile)), hostFile)
  }
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const needle of ['fflate', 'node:fs', 'node:path', 'node:os']) assert.ok(!bundle.includes(needle), needle)
  // 卡片只用契约里的路由常量，不 import 归档实现。
  const card = await readFile(new URL('../src/features/logs/card.tsx', import.meta.url), 'utf8')
  assert.match(card, /LOGS_ARCHIVE_ROUTE/)
  assert.ok(!card.includes('archive.js'))
})
