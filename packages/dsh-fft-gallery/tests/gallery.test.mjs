/**
 * Contract tests for the gallery data and the catalog route.
 *
 * Two surfaces read one file: the browser half reads `catalog.json`, the Host
 * Discover page reads `index.json`. The tests below hold both projections to
 * their published shapes, so a hand edit to an entry cannot ship an index the
 * Host would reject.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createCatalogRoute, readBundledCatalog, CATALOG_ROUTE } from '../src/index.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalog = JSON.parse(await readFile(resolve(root, 'gallery/catalog.json'), 'utf8'))
const index = JSON.parse(await readFile(resolve(root, 'gallery/index.json'), 'utf8'))

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

describe('catalog.json', () => {
  it('declares the format the shelf reads', () => {
    assert.equal(catalog.format, 1)
    assert.ok(Array.isArray(catalog.entries))
    assert.ok(catalog.entries.length > 0)
  })

  it('keeps ids unique', () => {
    const ids = catalog.entries.map(entry => entry.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('gives every entry both languages of the two text fields', () => {
    for (const entry of catalog.entries) {
      for (const field of ['title', 'description']) {
        assert.equal(typeof entry[field]?.zh, 'string', `${entry.id}.${field}.zh`)
        assert.equal(typeof entry[field]?.en, 'string', `${entry.id}.${field}.en`)
        assert.notEqual(entry[field].zh.trim(), '', `${entry.id}.${field}.zh`)
        assert.notEqual(entry[field].en.trim(), '', `${entry.id}.${field}.en`)
      }
    }
  })

  it('gives every web entry an https url', () => {
    for (const entry of catalog.entries.filter(item => item.kind === 'web')) {
      assert.equal(new URL(entry.url).protocol, 'https:', entry.id)
    }
  })

  it('gives every plugin entry an exact version and a publish time', () => {
    for (const entry of catalog.entries.filter(item => item.kind === 'plugin')) {
      assert.equal(entry.spec.type, 'npm')
      assert.match(entry.spec.version, SEMVER)
      assert.ok(Number.isInteger(entry.publishTimestamp), `${entry.id}.publishTimestamp`)
    }
  })

  it('covers every category an entry names', () => {
    for (const entry of catalog.entries) {
      assert.ok(catalog.categories[entry.category] !== undefined, `${entry.id} names undeclared category ${entry.category}`)
    }
  })
})

describe('index.json', () => {
  it('is a format-1 market index with declared categories', () => {
    assert.equal(index.format, 1)
    assert.equal(typeof index.title.en, 'string')
    assert.equal(typeof index.metadata, 'object')
    assert.equal(typeof index.metadata.categories, 'object')
  })

  it('projects only plugin entries', () => {
    const plugins = index.plugins.map(plugin => plugin.name)
    assert.deepEqual(plugins, ['@dsh-ft/dsh-fft-plot'])
  })

  it('orders versions by descending SemVer precedence', () => {
    for (const plugin of index.plugins) {
      assert.ok(plugin.versions.length > 0)
      for (const version of plugin.versions) assert.match(version.version, SEMVER)
      for (let position = 1; position < plugin.versions.length; position += 1) {
        const previous = plugin.versions[position - 1].version.split('-')[0].split('.').map(Number)
        const current = plugin.versions[position].version.split('-')[0].split('.').map(Number)
        const compared = previous[0] - current[0] || previous[1] - current[1] || previous[2] - current[2]
        assert.ok(compared >= 0, `${plugin.name} versions out of order`)
      }
    }
  })

  it('names an installable source for every version', () => {
    for (const plugin of index.plugins) {
      for (const version of plugin.versions) {
        assert.ok(Number.isInteger(version.publishTimestamp))
        if (version.source.type === 'npm') {
          if (version.source.registry !== undefined) {
            assert.equal(new URL(version.source.registry).protocol, 'https:')
          }
        } else {
          assert.match(version.source.commit, /^[0-9a-f]{40}$/)
        }
      }
    }
  })
})

describe('catalog route', () => {
  it('serves the bundled catalog on the one path', async () => {
    const route = createCatalogRoute(readBundledCatalog)
    assert.equal(route.path, CATALOG_ROUTE)
    assert.deepEqual(route.methods, ['GET'])
    const response = await route.fetch(new Request(`http://127.0.0.1${CATALOG_ROUTE}`))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.catalog.source, 'bundled')
    assert.deepEqual(body.catalog.entries.map(entry => entry.id), catalog.entries.map(entry => entry.id))
  })

  it('refuses anything but GET', async () => {
    const route = createCatalogRoute(readBundledCatalog)
    const response = await route.fetch(new Request(`http://127.0.0.1${CATALOG_ROUTE}`, { method: 'POST' }))
    assert.equal(response.status, 405)
    assert.equal((await response.json()).ok, false)
  })

  it('reports a broken read instead of throwing at the caller', async () => {
    const route = createCatalogRoute(async () => { throw new Error('boom') })
    const response = await route.fetch(new Request(`http://127.0.0.1${CATALOG_ROUTE}`))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'CATALOG_UNAVAILABLE')
    assert.match(body.error.message, /boom/)
  })
})
