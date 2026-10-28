/**
 * 开发期宿主版本必须只有一处来源。
 *
 * 插件包把 `@deepseek-ai/*` 声明成 peer（运行期由 DSH 提供），编译期用的那一份来自
 * 根 `pnpm-workspace.yaml` 的 `catalog`（直接 devDependencies）与 `overrides`（peer
 * 闭包）。两者不钉的话，宿主包的开放下界会让 pnpm 把任何新 peer 重解析到 npm 最新版，
 * dev 树整体漂移、出现同名包两份与非移植类型——ami 0.4.2 升级时踩过这个坑。
 *
 * 这个测试守三条不变量：
 * 1. 包 manifest 里 `@deepseek-ai/*` 的 devDependency 只写 `catalog:`，不写死版本；
 * 2. catalog 里的每个宿主版本在 overrides 里也有同一份；
 * 3. lock 里每个 `@deepseek-ai/*` 包都只有一个版本，且版本等于 overrides 的钉值。
 *
 * 宿主升级只有一处动作：改 workspace 的 catalog/overrides（外加 `dsh.engines.dsh`
 * 下限与 ami 的 PROVENANCE 基线宿主），然后重装；本测试会指出漏钉的包。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const { load } = require('js-yaml')

const workspace = load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'))
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')
const catalog = workspace.catalog ?? {}
const overrides = workspace.overrides ?? {}

/** 本仓 workspace 包的 manifest。 */
function manifests() {
  return readdirSync(resolve(root, 'packages'))
    .map(name => resolve(root, 'packages', name, 'package.json'))
    .map(file => ({ file, manifest: JSON.parse(readFileSync(file, 'utf8')) }))
}

/** lock 里出现的 `@deepseek-ai/*` 包名 → 版本集合。 */
function lockedHostVersions() {
  const versions = new Map()
  const pattern = /^ {2}'?(@deepseek-ai\/[a-z0-9-]+)@([0-9][^:'(]*?)'?:/gmu
  for (const match of lock.matchAll(pattern)) {
    const name = match[1]
    if (!versions.has(name)) versions.set(name, new Set())
    versions.get(name).add(match[2])
  }
  return versions
}

describe('development host pins', () => {
  it('keeps peer auto-install on and every host version pinned once', () => {
    assert.equal(
      workspace.autoInstallPeers,
      true,
      'tests run host code, so peers must be installed; the versions are pinned by overrides',
    )
    for (const name of Object.keys(catalog)) {
      if (!name.startsWith('@deepseek-ai/')) continue
      assert.equal(
        overrides[name],
        catalog[name],
        `${name}: the transitive peer closure is installed from overrides, so catalog and overrides must agree`,
      )
    }
  })

  it('declares host devDependencies as `catalog:` only', () => {
    for (const { file, manifest } of manifests()) {
      for (const [name, spec] of Object.entries(manifest.devDependencies ?? {})) {
        if (!name.startsWith('@deepseek-ai/')) continue
        assert.equal(
          spec,
          'catalog:',
          `${file}: ${name} must resolve through the workspace catalog, not a version written into the package`,
        )
        assert.ok(catalog[name], `${file}: ${name} is missing from the workspace catalog`)
      }
    }
  })

  it('pins every host package that lands in the lock, at exactly one version', () => {
    const locked = lockedHostVersions()
    assert.ok(locked.size > 0, 'the lockfile must contain the development host closure')
    for (const [name, versions] of locked) {
      assert.ok(
        Object.hasOwn(overrides, name),
        `${name} is installed but not pinned in pnpm-workspace overrides; add it there so the closure cannot drift`,
      )
      assert.equal(versions.size, 1, `${name} resolved to several versions: ${[...versions].join(', ')}`)
      assert.deepEqual(
        [...versions],
        [String(overrides[name])],
        `${name}: lock resolved ${[...versions].join(', ')} but the workspace pins ${overrides[name]}`,
      )
    }
  })

  it('matches the development host checkout when one is reachable', { skip: !hostCheckout() }, () => {
    const version = JSON.parse(readFileSync(resolve(hostCheckout(), 'package.json'), 'utf8')).version
    const sentinel = '@deepseek-ai/dsh-tools'
    assert.equal(
      overrides[sentinel],
      version,
      `${hostCheckout()} is ${version}; bump the host pins (catalog + overrides) with it`,
    )
  })
})

/** A reachable harness checkout, or null. */
function hostCheckout() {
  const candidate = process.env.DSH_HARNESS_ROOT ?? resolve(root, '../thirdparty/deepseek-harness')
  try {
    if (readFileSync(resolve(candidate, 'package.json'), 'utf8')) return candidate
  } catch {
    return null
  }
  return null
}
