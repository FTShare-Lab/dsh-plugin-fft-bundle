// 品牌 token 的跨包契约。
//
// 主题层由本包 client 半发布（`src/brand.ts`），但它是"有则用、无则回退"的
// 变量：fft-settings 缺席、或宿主根本没有 theme 服务时，其它子插件必须靠 CSS
// fallback 保持同一配色。因此这里钉两件事：
//   1. token 只有一处来源，且都是两种调色板同值；
//   2. 任何 `var(--ft-*)` 都必须带 fallback，且 fallback 与 token 值逐字相同。
// 新增品牌色时，先改 `src/brand.ts`，再改消费者，最后这里会替你对齐。

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyBrandTokens, FT_BRAND_SOURCE, FT_BRAND_TOKENS } from '../lib/brand.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_ROOT = resolve(PACKAGE_ROOT, '..')

/** Directories that never carry shipped browser styles. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'tmp', 'docs', 'scripts', 'tests'])
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.tsx'])

/** Every shipped source file below one directory. */
function sources(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sources(path))
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) found.push(path)
  }
  return found
}

/** Every browser source in every sibling package, as absolute paths. */
function packageSources() {
  const found = []
  for (const entry of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    found.push(...sources(join(PACKAGES_ROOT, entry.name)))
  }
  return found
}

/** One `var(--ft-*)` read: name, whether a fallback was supplied, and its value. */
function reads(source) {
  return [...source.matchAll(/var\(\s*(--ft-[a-z0-9-]+)\s*(,?)\s*([^)]*?)\)/g)]
    .map(([, name, comma, fallback]) => ({ name, fallback: comma === '' ? undefined : fallback.trim() }))
}

test('the layer publishes only scheme-invariant FT brand tokens', () => {
  assert.equal(FT_BRAND_SOURCE, '@ft/dsh-fft-settings')
  assert.deepEqual(Object.keys(FT_BRAND_TOKENS).sort(), [
    '--ft-accent', '--ft-accent-ink', '--ft-wechat', '--ft-wechat-ink',
  ])
  for (const [name, modes] of Object.entries(FT_BRAND_TOKENS)) {
    assert.match(name, /^--ft-/, `${name} stays inside the FT namespace`)
    assert.equal(modes.light, modes.dark, `${name} must not flip with the palette`)
  }
})

test('every FT token read carries the canonical value as its fallback', () => {
  const seen = new Set()
  for (const file of packageSources()) {
    const label = relative(PACKAGES_ROOT, file).split(sep).join('/')
    for (const { name, fallback } of reads(readFileSync(file, 'utf8'))) {
      const canonical = FT_BRAND_TOKENS[name]
      assert.ok(canonical !== undefined, `${label} reads undeclared ${name}`)
      assert.ok(fallback !== undefined, `${label} reads ${name} without a fallback; fft-settings may be absent`)
      assert.equal(fallback.toLowerCase(), canonical.light.toLowerCase(), `${label} fallback for ${name} drifted from src/brand.ts`)
      seen.add(label)
    }
  }
  // A scan that finds nothing must fail: these are the current consumers, and a
  // move should show up here rather than silently drop the guard.
  for (const expected of ['dsh-fft-settings/src/core/styles.ts', 'dsh-newapi-wechat-sso/client.js']) {
    assert.ok(seen.has(expected), `${expected} no longer reads an --ft-* token; update the guard if that is intended`)
  }
})

test('the layer waits for the theme service and disposes with its fiber', () => {
  const calls = []
  const ctx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ['theme'])
      callback({
        theme: {
          overrideTokens(source, tokens) {
            calls.push({ source, tokens })
            return () => calls.push('disposed')
          },
        },
        effect(callback, label) {
          calls.push({ effect: label, dispose: callback() })
        },
      })
    },
  }
  applyBrandTokens(ctx)
  assert.equal(calls[0].source, FT_BRAND_SOURCE)
  assert.deepEqual(calls[0].tokens, FT_BRAND_TOKENS)
  assert.equal(calls[1].effect, 'ft-settings: FT brand tokens')
  calls[1].dispose()
  assert.equal(calls[2], 'disposed')
})
