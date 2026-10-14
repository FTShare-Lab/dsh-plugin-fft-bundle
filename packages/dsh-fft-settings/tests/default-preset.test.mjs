/**
 * 一次性认领默认 preset 的测试（`node --test`，跑 `lib/` 产物）。
 *
 * 认领只在"本机从没认领过"时发生一次：写 `selectedDefault` 走的是设置服务
 * （与设置页同一条路，只能写 volatile 字段），写前先把 profile patch 复制一份
 * 到本插件数据目录，随后落 claim 文件；此后无论用户怎么改默认都不再干预。
 * 这里用假 settings / agentPresets / profileContext 盯住各条分支：
 * 首次认领、已有 claim、preset 未注册、写入失败、已经是我们的默认，以及
 * 快照的四条路径（写前必快照、首次快照不被覆盖、快照失败则整体中止、无 patch 文件则跳过）。
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  BACKUP_FILE_NAME,
  CLAIM_FILE_NAME,
  DATA_DIR_NAME,
  DEFAULT_PRESET_ID,
  REGISTRY_ENTRY_ID,
  backupFilePath,
  claimFilePath,
  installDefaultPresetOnce,
} from '../lib/default-preset.js'

/** 一份最小可用的 profile patch 内容。 */
const PATCH = '- id: system-prompt\n  config: {}\n'

let tempCounter = 0

/** 把 `$DSH_HOME` 指向包内 tmp 下的临时目录，并在用例结束后还原。 */
async function tempHome(t) {
  const home = fileURLToPath(new URL(`../tmp/default-preset-${process.pid}-${++tempCounter}/`, import.meta.url))
  await mkdir(home, { recursive: true })
  t.after(() => rm(home, { recursive: true, force: true }))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  return home
}

/** 轮询到条件成立或超时，避免依赖固定 sleep。 */
async function settle(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('the claim did not settle')
}

/** 读取已落盘的 claim；文件还没写完（或还没建）时返回 undefined。 */
function readClaim(home) {
  try {
    return JSON.parse(readFileSync(claimFilePath(home), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 用假的 settings / agentPresets / profileContext 启动一次认领。
 *
 * `options.patch` 决定 profile patch 的内容（`false` = 不建文件）；
 * `options.patchIsDirectory` 把它做成目录（`copyFile` 必然失败）；
 * `options.noProfileService` 不提供 profileContext；`options.fail` 让写入抛错。
 * @param t - node:test 上下文。
 * @param home - 本次使用的 `$DSH_HOME`。
 * @param options - 上述开关。
 * @returns the recorded settings writes, roster reads, and the patch path.
 */
async function boot(t, home, options = {}) {
  const calls = []
  let lists = 0
  const patchPath = join(home, 'profiles', 'desktop', 'cordis.patch.yml')
  if (options.patchIsDirectory === true) await mkdir(patchPath, { recursive: true })
  else if (options.patch !== false) {
    await mkdir(dirname(patchPath), { recursive: true })
    await writeFile(patchPath, options.patch ?? PATCH)
  }
  const ctx = new Context()
  ctx.provide('settings', {
    async update(ns, patch) {
      calls.push([ns, patch])
      if (options.fail === true) throw new Error('settings write refused')
    },
  })
  ctx.provide('agentPresets', {
    defaultId: options.defaultId ?? 'standard',
    async list() {
      lists += 1
      return (options.presets ?? [DEFAULT_PRESET_ID]).map(id => ({ id }))
    },
  })
  if (options.noProfileService !== true) ctx.provide('profileContext', { patchPath })
  const fiber = await ctx.plugin({
    name: 'default-preset-probe',
    inject: ['settings', 'agentPresets'],
    apply: scope => installDefaultPresetOnce(scope),
  })
  t.after(() => fiber.dispose())
  return { calls, listCount: () => lists, home, patchPath }
}

test('claims the default once: snapshots the patch, writes selectedDefault, records the claim', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home)
  await settle(() => readClaim(home) !== undefined)
  assert.deepEqual(calls, [[REGISTRY_ENTRY_ID, { selectedDefault: DEFAULT_PRESET_ID }]])
  assert.equal(readFileSync(backupFilePath(home), 'utf8'), PATCH, 'the snapshot must hold the profile patch verbatim')
  const claim = readClaim(home)
  assert.equal(claim.preset, DEFAULT_PRESET_ID)
  assert.equal(typeof claim.at, 'string')
  assert.equal(claim.backup, backupFilePath(home))
})

test('leaves a machine that already claimed alone', async t => {
  const home = await tempHome(t)
  const first = await boot(t, home)
  await settle(() => readClaim(home) !== undefined)
  assert.equal(first.calls.length, 1)
  const second = await boot(t, home)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(second.calls, [], 'a recorded claim must stop every later write')
  assert.equal(second.listCount(), 0, 'a recorded claim must not even ask for the roster')
})

test('waits for a composition that registers the preset', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home, { presets: ['standard', 'minimal'] })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(calls, [], 'an unregistered preset id must never be pinned')
  assert.equal(existsSync(claimFilePath(home)), false, 'no claim may be recorded while nothing was written')
  assert.equal(existsSync(backupFilePath(home)), false, 'nothing is about to be written, so nothing is snapshotted')
})

test('records nothing when the write fails, and does not throw', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home, { fail: true })
  await settle(() => calls.length === 1)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(existsSync(claimFilePath(home)), false, 'a failed write must be retried on the next start')
  assert.equal(readFileSync(backupFilePath(home), 'utf8'), PATCH, 'the snapshot of the failed attempt stays for the retry')
})

test('records the claim without writing when the default is already ours', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home, { defaultId: DEFAULT_PRESET_ID })
  await settle(() => readClaim(home) !== undefined)
  assert.deepEqual(calls, [], 'an already-correct default needs no write')
  assert.equal(existsSync(backupFilePath(home)), false, 'no write means no snapshot')
})

test('keeps the first snapshot instead of overwriting it', async t => {
  const home = await tempHome(t)
  await mkdir(dirname(backupFilePath(home)), { recursive: true })
  await writeFile(backupFilePath(home), 'first\n')
  await boot(t, home)
  await settle(() => readClaim(home) !== undefined)
  assert.equal(readFileSync(backupFilePath(home), 'utf8'), 'first\n', 'the earliest state must survive later attempts')
})

test('never writes when the snapshot cannot be taken', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home, { patchIsDirectory: true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(calls, [], 'the write must not happen without its snapshot')
  assert.equal(existsSync(claimFilePath(home)), false, 'an aborted claim must retry on the next start')
})

test('claims without a snapshot when the profile has no patch file yet', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home, { patch: false })
  await settle(() => readClaim(home) !== undefined)
  assert.deepEqual(calls, [[REGISTRY_ENTRY_ID, { selectedDefault: DEFAULT_PRESET_ID }]])
  assert.equal(existsSync(backupFilePath(home)), false, 'a profile that never wrote anything has nothing to snapshot')
  assert.equal('backup' in readClaim(home), false)
})

test('claims without a snapshot when the context carries no profile service', async t => {
  const home = await tempHome(t)
  const { calls } = await boot(t, home, { noProfileService: true })
  await settle(() => readClaim(home) !== undefined)
  assert.deepEqual(calls, [[REGISTRY_ENTRY_ID, { selectedDefault: DEFAULT_PRESET_ID }]])
  assert.equal(existsSync(backupFilePath(home)), false)
})

test('keeps both files under the plugin data directory', () => {
  assert.equal(claimFilePath('/home/x'), join('/home/x', DATA_DIR_NAME, CLAIM_FILE_NAME))
  assert.equal(backupFilePath('/home/x'), join('/home/x', DATA_DIR_NAME, BACKUP_FILE_NAME))
  assert.equal(CLAIM_FILE_NAME, 'default-preset.json')
  assert.equal(BACKUP_FILE_NAME, 'cordis.patch.yml.bak')
})
