/**
 * The workbench status is read-only observation, so its rules are pure: given a
 * loader table, a package table and a preset registry, what does the card say?
 *
 * The fakes here are deliberately structural (plain objects) — the collector is
 * written against the slices of `ctx.loader`, `ctx.pluginPackages` and
 * `ctx.agentPresets` that it reads, not against the host packages, so the test
 * needs no DSH install.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUNDLE_NAME,
  GLOBAL_ROW_TARGETS,
  collectWorkbenchStatus,
  presetStatus,
  specAllows,
} from '../lib/status.js'
import { manifest as generatedManifest } from '../lib/manifest.js'

/** One Loader entry, shaped like the host's. */
function entry(id, name, { disabled = false } = {}) {
  return { options: { id, name, disabled }, disabled, fiber: {} }
}

/**
 * A host whose package table answers `versions` and whose manifest pins
 * `dependencies`. Services arrive through `get`, the only reflection path a
 * plugin may use without declaring that service in its inject list.
 */
function host({ dependencies = {}, versions = {}, entries = [], preset } = {}) {
  const services = {
    agentPresets: preset,
    loader: { entries: () => entries },
    pluginPackages: {
      packageOf: name => {
        if (name === BUNDLE_NAME) return { name, version: '1.0.2', manifest: { dependencies } }
        const version = versions[name]
        return version === undefined ? undefined : { name, version }
      },
    },
  }
  return { get: name => services[name] }
}

describe('specAllows', () => {
  it('compares exact and lower-bound ranges', () => {
    assert.equal(specAllows('0.7.1', '0.7.1'), true)
    assert.equal(specAllows('0.7.1', '0.7.2'), false)
    assert.equal(specAllows('>=0.7.1', '0.7.2'), true)
    assert.equal(specAllows('>=0.7.1', '0.6.9'), false)
  })

  it('applies caret semantics, including the 0.x minor rule', () => {
    assert.equal(specAllows('^0.7.1', '0.7.9'), true)
    assert.equal(specAllows('^0.7.1', '0.8.0'), false)
    assert.equal(specAllows('^1.2.3', '1.9.0'), true)
    assert.equal(specAllows('^1.2.3', '2.0.0'), false)
  })

  it('leaves repository edges and unknown shapes unchecked', () => {
    assert.equal(specAllows('git+ssh://git@example.com/repo.git#v1.0.0&path:packages/x', '1.0.0'), undefined)
    assert.equal(specAllows('link:packages/x', '1.0.0'), undefined)
    assert.equal(specAllows('latest', '1.0.0'), undefined)
  })
})

describe('collectWorkbenchStatus', () => {
  it('reports aligned, mismatched and missing dependencies of the real generated manifest', async () => {
    // The declared specifiers are the generated manifest's: the fake host only
    // answers installed versions, exactly like the profile does at runtime.
    const declared = generatedManifest.dependencies
    const names = Object.keys(declared)
    const floorOf = name => (/^>=\s*(\d+\.\d+\.\d+)/u.exec(declared[name]) ?? [null, '1.0.0'])[1]
    const versions = Object.fromEntries(names.map(name => [name, floorOf(name)]))
    // One dependency drifts below its floor, another does not resolve.
    const mismatched = names.find(name => declared[name].includes('paper')) ?? names[0]
    versions[mismatched] = `${floorOf(mismatched).replace(/\d+$/u, value => String(Math.max(0, Number(value) - 1)))}`
    const missing = names.find(name => name !== mismatched)
    delete versions[missing]

    const probe = host({ dependencies: declared, versions })
    const status = await collectWorkbenchStatus(probe, 'file:///bundle/lib/index.js')
    const byName = Object.fromEntries(status.packages.map(pkg => [pkg.name, pkg]))
    assert.equal(byName[mismatched].state, 'mismatch')
    assert.equal(byName[missing].state, 'missing')
    for (const name of names) {
      if (name === mismatched || name === missing) continue
      assert.equal(byName[name].state, 'aligned', `${name} should be aligned`)
    }
    assert.equal(status.bundle.version, generatedManifest.version)
  })
  it('resolves display titles through the profile, not the linked checkout', async () => {
    const seen = []
    const probe = host({})
    const base = probe.get
    probe.get = name => {
      if (name === 'profileContext') return { dir: '/tmp/profile home' }
      const services = base(name)
      return services
    }
    const lookup = probe.get('pluginPackages')
    probe.get = name => {
      if (name === 'profileContext') return { dir: '/tmp/profile home' }
      if (name === 'pluginPackages') {
        return {
          ...lookup,
          metaOf: (specifier, parentUrl) => {
            seen.push({ specifier, parentUrl })
            return { title: { zh: '名字' } }
          },
        }
      }
      return undefined
    }
    const status = await collectWorkbenchStatus(probe, 'file:///checkout/lib/index.js')
    assert.ok(seen.length > 0, 'metadata must be read for the dependencies')
    for (const call of seen) assert.match(call.parentUrl, /^file:\/\/\/tmp\/profile%20home\/package\.json$/u)
    assert.equal(status.packages[0].title?.zh, '名字')
  })

  it('distinguishes mounted, disabled and missing rows', async () => {
    const probe = host({
      entries: [
        entry('dsh-fft-settings', '@dsh-ft/dsh-fft-settings'),
        entry('dsh-fft-ftshare', '@dsh-ft/dsh-fft-ftshare', { disabled: true }),
      ],
    })
    const status = await collectWorkbenchStatus(probe, 'file:///bundle/lib/index.js')
    const states = Object.fromEntries(status.rows.map(row => [row.id, row.state]))
    assert.equal(states['dsh-fft-settings'], 'mounted')
    assert.equal(states['dsh-fft-ftshare'], 'disabled')
    assert.equal(states['ft-paper-trading'], 'missing')
    assert.equal(states['preset-ft-finance'], 'missing')
    // Every configured row target is reported exactly once.
    assert.deepEqual(status.rows.map(row => row.id), GLOBAL_ROW_TARGETS.map(row => row.id))
  })

  it('never rejects when the preset registry is absent or slow', async () => {
    const absent = await presetStatus(host())
    assert.equal(absent.state, 'unavailable')

    const slow = await presetStatus(host({ preset: { list: () => new Promise(() => {}), defaultId: 'ft-finance' } }))
    assert.equal(slow.state, 'unavailable')
    assert.match(slow.detail ?? '', /did not answer/u)
  })

  it('reads the preset through the registry diagnostic rather than guessing', async () => {
    const ready = await presetStatus(host({
      preset: { list: async () => [{ id: 'ft-finance' }], defaultId: 'ft-finance' },
    }))
    assert.equal(ready.state, 'ready')
    assert.equal(ready.isDefault, true)

    const broken = await presetStatus(host({
      preset: { list: async () => [{ id: 'ft-finance', broken: 'row tool-fs is unusable' }], defaultId: 'standard' },
    }))
    assert.equal(broken.state, 'broken')
    assert.equal(broken.isDefault, false)
    assert.match(broken.detail ?? '', /tool-fs/u)

    const missing = await presetStatus(host({ preset: { list: async () => [], defaultId: 'standard' } }))
    assert.equal(missing.state, 'missing')
  })
})

describe('workbench route', () => {
  it('answers GET with the collected status and rejects other methods', async () => {
    const { createWorkbenchRoute } = await import('../lib/index.js')
    const status = { checkedAt: '2026-11-14T00:00:00.000Z', bundle: { name: BUNDLE_NAME }, packages: [], rows: [], preset: { id: 'ft-finance', state: 'ready', isDefault: true } }
    const route = createWorkbenchRoute(async () => status)
    assert.equal(route.methods.join(','), 'GET')
    const ok = await route.fetch(new Request('http://local/api/ft-workbench'))
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { ok: true, status })
    const rejected = await route.fetch(new Request('http://local/api/ft-workbench', { method: 'POST' }))
    assert.equal(rejected.status, 405)
  })

  it('reports a failed collection inside the payload instead of a 5xx', async () => {
    const { createWorkbenchRoute } = await import('../lib/index.js')
    const route = createWorkbenchRoute(async () => { throw new Error('boom') })
    const response = await route.fetch(new Request('http://local/api/ft-workbench'))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.match(body.error.message, /boom/u)
  })
})
