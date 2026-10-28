/**
 * The plugin manager shows this bundle's components from each package's
 * `locale/<lang>.json`; the Host reads that file only through the package's
 * `exports` map and only when `en.json` exists. A missing export or title
 * silently degrades the card to a bare package name, so this test pins the
 * copy the workbench ships for its components.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packages = fileURLToPath(new URL('../../', import.meta.url))

/** Component package directories and the title each must show; `null` keeps the package name. */
const COMPONENTS = [
  ['dsh-fft-settings', 'FT 设置'],
  ['dsh-fft-ftshare', 'FTShare 数据'],
  ['dsh-newapi-wechat-sso', null],
  ['dsh-fft-research-cockpit', null],
  ['dsh-fft-factor-intake-standard', null],
]

/** Read one JSON file from disk. */
function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('plugin display metadata', () => {
  it('ships the workbench card text in both locales', () => {
    const root = resolve(packages, 'dsh-fft-bundle')
    assert.equal(read(resolve(root, 'locale/zh.json')).meta.title, '金融工作台')
    assert.equal(read(resolve(root, 'locale/en.json')).meta.title, 'Financial Workbench')
  })

  it('exposes component locales the Host can resolve', () => {
    for (const [name] of COMPONENTS) {
      const root = resolve(packages, name)
      const manifest = read(resolve(root, 'package.json'))
      assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', `${name} must export its locale files`)
      assert.ok(manifest.files.includes('locale/*.json'), `${name} must ship its locale files`)
      for (const lang of ['zh', 'en']) {
        assert.ok(existsSync(resolve(root, `locale/${lang}.json`)), `${name} needs locale/${lang}.json`)
      }
    }
  })

  it('gives every component a one-line introduction', () => {
    for (const [name, title] of COMPONENTS) {
      for (const lang of ['zh', 'en']) {
        const { meta } = read(resolve(packages, name, `locale/${lang}.json`))
        assert.equal(typeof meta.description, 'string', `${name} locale/${lang}.json needs a description`)
        assert.ok(meta.description.trim() !== '', `${name} locale/${lang}.json needs a description`)
        if (lang === 'zh') assert.ok(meta.description.length <= 40, `${name} description must fit one card line`)
      }
      const zh = read(resolve(packages, name, 'locale/zh.json')).meta
      if (title === null) assert.equal(zh.title, undefined, `${name} must keep its package name as the title`)
      else assert.equal(zh.title, title, `${name} shows the wrong title`)
    }
  })
})
