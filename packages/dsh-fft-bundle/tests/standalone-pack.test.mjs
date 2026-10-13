/**
 * The standalone tarball rewrites what a git install resolves at install time
 * into what the tarball carries: every edge into this repository becomes an
 * inlined plugin at a pinned version, and the plugins' own registry
 * dependencies survive as the bundle's dependencies.
 *
 * These are the pure decisions behind `scripts/pack-tarball.mjs`; the
 * packing run itself needs git, pnpm, and a staged payload.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { httpsUrl, patternToRegExp, pickRange, rewriteManifest } from '../../../scripts/pack-tarball.mjs'

const EDGE = 'git+ssh://git@github.com/FTShare-Lab/dsh-plugin-fft-bundle.git#path:packages/'

describe('files patterns', () => {
  it('ship a directory and its contents', () => {
    assert.ok(patternToRegExp('lib').test('lib'))
    assert.ok(patternToRegExp('lib').test('lib/index.js'))
    assert.ok(!patternToRegExp('lib').test('library/index.js'))
  })

  it('keep a wildcard inside one path segment', () => {
    assert.ok(patternToRegExp('locale/*.json').test('locale/zh.json'))
    assert.ok(!patternToRegExp('locale/*.json').test('locale/sub/zh.json'))
    assert.ok(patternToRegExp('lib/**/*.d.ts').test('lib/types/index.d.ts'))
  })
})

describe('registry ranges several plugins declare', () => {
  it('keep the only declaration', () => {
    assert.equal(pickRange([{ name: 'nunjucks', range: '3.2.4' }]), '3.2.4')
  })

  it('take the highest lower bound', () => {
    assert.equal(pickRange([
      { name: '@deepseek-ai/schemastery', range: '>=3.18.2' },
      { name: '@deepseek-ai/schemastery', range: '>=3.18.4' },
    ]), '>=3.18.4')
  })
})

describe('the standalone manifest', () => {
  const bundle = {
    name: '@ft/dsh-fft-bundle',
    version: '0.5.0',
    dependencies: {
      '@ft/dsh-fft-settings': `${EDGE}dsh-fft-settings`,
      '@ftshare-lab/dsh-kline': 'git+ssh://git@github.com/FTShare-Lab/dsh_kline.git#v0.3.5',
    },
  }
  const bundled = [
    {
      name: '@ft/dsh-fft-settings',
      manifest: {
        name: '@ft/dsh-fft-settings',
        version: '0.2.0',
        dependencies: { '@ft/dsh-fft-research-cockpit': `${EDGE}dsh-fft-research-cockpit`, '@deepseek-ai/schemastery': '>=3.18.4', nunjucks: '3.2.4' },
        peerDependencies: { react: '^18.2.0' },
      },
    },
    {
      name: '@ft/dsh-fft-research-cockpit',
      manifest: {
        name: '@ft/dsh-fft-research-cockpit',
        version: '0.2.0',
        dependencies: { '@ft/dsh-fft-settings': `${EDGE}dsh-fft-settings`, '@deepseek-ai/schemastery': '>=3.18.2', nunjucks: '3.2.4' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2' },
      },
    },
    { name: '@ftshare-lab/dsh-kline', manifest: { name: '@ftshare-lab/dsh-kline', version: '0.3.5' } },
  ]
  const manifest = rewriteManifest(bundle, bundled)

  it('inlines every plugin at the version the ref carries', () => {
    assert.equal(manifest.dependencies['@ft/dsh-fft-settings'], '0.2.0')
    assert.equal(manifest.dependencies['@ft/dsh-fft-research-cockpit'], '0.2.0')
    assert.equal(manifest.dependencies['@ftshare-lab/dsh-kline'], '0.3.5')
    assert.deepEqual(manifest.bundledDependencies, [
      '@ft/dsh-fft-settings', '@ft/dsh-fft-research-cockpit', '@ftshare-lab/dsh-kline',
    ])
  })

  it('leaves no git edge for pnpm to resolve', () => {
    assert.ok(Object.values(manifest.dependencies).every(spec => !spec.startsWith('git')))
  })

  it('keeps the plugins’ own registry dependencies, one range each', () => {
    assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '>=3.18.4')
    assert.equal(manifest.dependencies.nunjucks, '3.2.4')
  })

  it('carries the plugins’ peers so the profile compatibility gate sees them', () => {
    assert.deepEqual(manifest.peerDependencies, { react: '^18.2.0', '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2' })
  })

  it('keeps the bundle’s own fields', () => {
    assert.equal(manifest.name, '@ft/dsh-fft-bundle')
    assert.equal(manifest.version, '0.5.0')
  })
})

describe('clone URLs', () => {
  it('rewrite every git form a fresh machine cannot read without a key', () => {
    assert.equal(httpsUrl('git+ssh://git@github.com/FTShare-Lab/dsh_kline.git#v0.3.5'), 'https://github.com/FTShare-Lab/dsh_kline.git')
    assert.equal(httpsUrl('git@github.com:FTShare-Lab/dsh_kline.git#v0.3.5'), 'https://github.com/FTShare-Lab/dsh_kline.git')
    assert.equal(httpsUrl('git+https://github.com/FTShare-Lab/dsh_kline.git#v0.3.5'), 'https://github.com/FTShare-Lab/dsh_kline.git')
  })
})
