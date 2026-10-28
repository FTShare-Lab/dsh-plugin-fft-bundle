/**
 * The standalone tarball inlines the bundle's plugin set: the unpublished
 * packages at the ref's commit, the published packages at their pinned registry
 * version, and the cross-repository plugin at its tag. The rewritten manifest
 * lists the whole set in `bundledDependencies`, so a consumer never resolves one
 * of the bundle's own edges.
 *
 * These are the pure decisions behind `scripts/pack-tarball.mjs`; the packing run
 * itself needs git, npm and a staged payload.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  httpsUrl, patternToRegExp, pickRange, registryVersionOf, rewriteManifest, satisfiesRange, assertBundledRanges,
} from '../../../scripts/pack-tarball.mjs'

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
      '@dsh-ft/dsh-fft-settings': `${EDGE}dsh-fft-settings`,
      '@ftshare-lab/dsh-kline': 'git+ssh://git@github.com/FTShare-Lab/dsh_kline.git#v0.3.5',
    },
  }
  const bundled = [
    {
      name: '@dsh-ft/dsh-fft-settings',
      manifest: {
        name: '@dsh-ft/dsh-fft-settings',
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
        dependencies: { '@dsh-ft/dsh-fft-settings': `${EDGE}dsh-fft-settings`, '@deepseek-ai/schemastery': '>=3.18.2', nunjucks: '3.2.4' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2' },
      },
    },
    { name: '@ftshare-lab/dsh-kline', manifest: { name: '@ftshare-lab/dsh-kline', version: '0.3.5' } },
  ]
  const manifest = rewriteManifest(bundle, bundled)

  it('inlines every plugin at the version the ref carries', () => {
    assert.equal(manifest.dependencies['@dsh-ft/dsh-fft-settings'], '0.2.0')
    assert.equal(manifest.dependencies['@ft/dsh-fft-research-cockpit'], '0.2.0')
    assert.equal(manifest.dependencies['@ftshare-lab/dsh-kline'], '0.3.5')
    assert.deepEqual(manifest.bundledDependencies, [
      '@dsh-ft/dsh-fft-settings', '@ft/dsh-fft-research-cockpit', '@ftshare-lab/dsh-kline',
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

  it('inlines a registry-pinned plugin at the exact version it names', () => {
    const pinned = rewriteManifest(
      { name: '@ft/dsh-fft-bundle', version: '0.9.0', dependencies: { '@dsh-ft/dsh-fft-settings': '0.5.0' } },
      [{ name: '@dsh-ft/dsh-fft-settings', manifest: { name: '@dsh-ft/dsh-fft-settings', version: '0.5.0' } }],
    )
    assert.equal(pinned.dependencies['@dsh-ft/dsh-fft-settings'], '0.5.0')
    assert.deepEqual(pinned.bundledDependencies, ['@dsh-ft/dsh-fft-settings'])
  })
})

describe('clone URLs', () => {
  it('rewrite every git form a fresh machine cannot read without a key', () => {
    assert.equal(httpsUrl('git+ssh://git@github.com/FTShare-Lab/dsh_kline.git#v0.3.5'), 'https://github.com/FTShare-Lab/dsh_kline.git')
    assert.equal(httpsUrl('git@github.com:FTShare-Lab/dsh_kline.git#v0.3.5'), 'https://github.com/FTShare-Lab/dsh_kline.git')
    assert.equal(httpsUrl('git+https://github.com/FTShare-Lab/dsh_kline.git#v0.3.5'), 'https://github.com/FTShare-Lab/dsh_kline.git')
  })
})

describe('registry pins', () => {
  it('recognise an exact version and nothing else', () => {
    assert.equal(registryVersionOf('0.6.0'), '0.6.0')
    assert.equal(registryVersionOf('0.6.0-rc.1'), '0.6.0-rc.1')
    assert.equal(registryVersionOf('^0.6.0'), undefined, 'a range must not be treated as a pinned version')
    assert.equal(registryVersionOf('git+ssh://git@example.invalid/repo.git#v0.6.0'), undefined)
  })
})

describe('the inlined-pair guard', () => {
  /** One bundled plugin, as the packer assembles it. */
  const plugin = (name, version, dependencies = {}) => ({ name, manifest: { name, version, dependencies } })

  it('understand the range forms the manifests use', () => {
    assert.ok(satisfiesRange('0.5.0', '0.5.0'))
    assert.ok(satisfiesRange('0.5.1', '^0.5.0'))
    assert.ok(!satisfiesRange('0.6.0', '^0.5.0'), 'a caret range caps the major version')
    assert.ok(satisfiesRange('0.3.4', '~0.3.1'))
    assert.ok(!satisfiesRange('0.4.0', '~0.3.1'))
    assert.ok(satisfiesRange('3.18.4', '>=3.18.2'))
    assert.ok(!satisfiesRange('3.18.1', '>=3.18.2'))
    assert.ok(satisfiesRange('0.0.3', '^0.0.3'))
    assert.ok(!satisfiesRange('0.0.4', '^0.0.3'), 'a 0.0.x caret range is exact')
  })

  it('accept a payload whose inlined versions satisfy every declaration', () => {
    assert.doesNotThrow(() => assertBundledRanges([
      plugin('@dsh-ft/dsh-fft-settings', '0.5.0'),
      plugin('@dsh-ft/dsh-fft-paper-trading', '0.6.0', { '@dsh-ft/dsh-fft-settings': '^0.5.0' }),
    ]))
  })

  it('refuse a payload whose inlined version cannot satisfy a declaration', () => {
    assert.throws(
      () => assertBundledRanges([
        plugin('@dsh-ft/dsh-fft-settings', '0.4.5'),
        plugin('@dsh-ft/dsh-fft-paper-trading', '0.6.0', { '@dsh-ft/dsh-fft-settings': '^0.5.0' }),
      ]),
      /requires @dsh-ft\/dsh-fft-settings@\^0\.5\.0/,
    )
  })

  it('ignore git and workspace specs, which select a commit rather than a range', () => {
    assert.doesNotThrow(() => assertBundledRanges([
      plugin('@ftshare-lab/dsh-kline', '0.4.0'),
      plugin('@ft/dsh-fft-research-cockpit', '0.2.5', { '@dsh-ft/dsh-fft-settings': `${EDGE}dsh-fft-settings` }),
    ]))
  })

  it('refuse an unsupported range instead of guessing', () => {
    assert.throws(() => satisfiesRange('1.0.0', '>1.0.0 <2.0.0'), /unsupported dependency range/)
  })
})
