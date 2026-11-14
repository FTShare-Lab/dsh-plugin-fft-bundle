/**
 * The plugin manager shows this bundle's components from each package's
 * `locale/<lang>.json`; the Host reads that file only through the package's
 * `exports` map and only when `en.json` exists. A missing export or title
 * silently degrades the card to a bare package name, so this test pins the
 * copy the workbench ships for its components.
 *
 * Components are located through Node's resolver, not by walking `packages/`:
 * settings and ftshare live in the `dsh-fft-base` repository and reach this
 * workspace as installed packages, so the thing worth checking is exactly what
 * the Host will read.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { schema } from './lib/patch-yaml.mjs'

const packages = fileURLToPath(new URL('../../', import.meta.url))
const bundleRoot = resolve(packages, 'dsh-fft-bundle')
const require = createRequire(join(bundleRoot, 'package.json'))

/**
 * The component packages this bundle installs, read from its patch layer.
 *
 * Components are read from the patch instead of being listed here: a literal
 * list would name the packages only `dev` carries, and the public tree has no
 * business carrying those names. The patch is the authority anyway — a
 * component that is not a row is not installed either.
 *
 * A row counts as a component only when it sits on the patch's top-level
 * `insert` list: a preset's own `plugins` list carries the rows it mounts
 * inside the preset (an MCP client among them), and those are not components of
 * the workbench. Rows whose package ships no locale at all are skipped — the
 * third-party K-line and another team's bundle keep their own card text — so
 * the guard covers exactly the packages this workbench localizes.
 * @returns {string[]} package names in row order.
 */
function componentNames() {
  const manifest = read(resolve(bundleRoot, 'package.json'))
  const source = readFileSync(resolve(bundleRoot, manifest.dsh.bundle.patch), 'utf8')
  const parsed = load(source, { schema })
  const names = []
  for (const entry of parsed) {
    if (!Array.isArray(entry?.insert)) continue
    for (const row of entry.insert) {
      if (typeof row?.name !== 'string' || !row.name.startsWith('@')) continue
      let root
      try {
        root = dirname(require.resolve(`${row.name}/package.json`))
      } catch {
        continue
      }
      if (!existsSync(resolve(root, 'locale/zh.json'))) continue
      names.push(row.name)
    }
  }
  return names
}

/**
 * Titles the workbench must show for a component, by package name; `null` keeps
 * the package name as the card title. A component that is not named here is only
 * checked for having a one-line introduction, so a package can be added to the
 * patch without touching this file.
 */
const TITLES = new Map([
  ['@dsh-ft/finance-all-in-one', '金融工作台'],
  ['@dsh-ft/dsh-fft-settings', 'FT 设置'],
  ['@dsh-ft/dsh-fft-ftshare', 'FTShare 数据'],
  ['@dsh-ft/dsh-fft-paper-trading', '模拟交易'],
])

/** Read one JSON file from disk. */
function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** The directory an installed package resolves from. */
function packageRoot(name) {
  return dirname(require.resolve(`${name}/package.json`))
}

describe('plugin display metadata', () => {
  it('ships the workbench card text in both locales', () => {
    assert.equal(read(resolve(bundleRoot, 'locale/zh.json')).meta.title, '金融工作台')
    assert.equal(read(resolve(bundleRoot, 'locale/en.json')).meta.title, 'Financial Workbench')
  })

  it('exposes component locales the Host can resolve', () => {
    const rows = componentNames()
    assert.ok(rows.length >= 3, `the patch lists ${rows.length} component packages; expected the plugin set`)
    for (const name of rows) {
      const root = packageRoot(name)
      const label = name.split('/')[1]
      const manifest = read(resolve(root, 'package.json'))
      assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', `${label} must export its locale files`)
      assert.ok(manifest.files.includes('locale/*.json'), `${label} must ship its locale files`)
      for (const lang of ['zh', 'en']) {
        assert.ok(existsSync(resolve(root, `locale/${lang}.json`)), `${label} needs locale/${lang}.json`)
      }
    }
  })

  it('gives every component a one-line introduction', () => {
    for (const name of componentNames()) {
      const root = packageRoot(name)
      const label = name.split('/')[1]
      for (const lang of ['zh', 'en']) {
        const { meta } = read(resolve(root, `locale/${lang}.json`))
        assert.equal(typeof meta.description, 'string', `${label} locale/${lang}.json needs a description`)
        assert.ok(meta.description.trim() !== '', `${label} locale/${lang}.json needs a description`)
        if (lang === 'zh') assert.ok(meta.description.length <= 40, `${label} description must fit one card line`)
      }
      const zh = read(resolve(root, 'locale/zh.json')).meta
      const title = TITLES.get(name) ?? null
      if (title === null) assert.equal(zh.title, undefined, `${label} must keep its package name as the title`)
      else assert.equal(zh.title, title, `${label} shows the wrong title`)
    }
  })
})
