/**
 * The remote catalog channel: two addresses for the same branch file.
 *
 * jsDelivr's GitHub endpoint answers first because raw.githubusercontent.com is
 * blockable on its own; raw stays as the fallback for networks where the CDN is
 * the unreachable one. These tests pin the order, the fallback, and the "nothing
 * published yet" answer the bundled baseline relies on.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createCatalogRoute } from '../src/index.js'

const BUNDLED = {
  format: 2,
  generatedAt: '2026-01-01T00:00:00.000Z',
  categories: { tool: { zh: '工具', en: 'Tool' } },
  entries: [{
    id: 'bundled.one', kind: 'web', category: 'tool',
    title: { zh: '内置', en: 'Bundled' }, summary: { zh: '内置', en: 'Bundled' },
    url: 'https://example.com/',
  }],
}

const REMOTE = {
  format: 2,
  generatedAt: '2026-01-02T00:00:00.000Z',
  categories: { tool: { zh: '工具', en: 'Tool' } },
  entries: [{
    id: 'remote.one', kind: 'web', category: 'tool',
    title: { zh: '远端', en: 'Remote' }, summary: { zh: '远端', en: 'Remote' },
    url: 'https://example.com/remote',
  }],
}

const FIRST = 'https://cdn.jsdelivr.net/gh/o/r@catalog/gallery/catalog.json'
const SECOND = 'https://raw.githubusercontent.com/o/r/catalog/gallery/catalog.json'

describe('remote catalog sources', () => {
  let dir
  before(async () => { dir = await mkdtemp(join(tmpdir(), 'gallery-sources-')) })
  after(async () => { await rm(dir, { recursive: true, force: true }) })

  it('falls through to raw when the CDN cannot answer', async () => {
    const seen = []
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      sources: [FIRST, SECOND],
      fetchRemote: async (url) => {
        seen.push(url)
        if (url === FIRST) throw new Error('network down')
        return new Response(JSON.stringify(REMOTE))
      },
      cacheFile: join(dir, 'fallback.json'),
    })
    const body = await (await route.fetch(new Request('http://host/api/ft-gallery/catalog'))).json()
    assert.equal(body.catalog.meta.remote, 'fresh')
    assert.equal(body.catalog.meta.source, SECOND)
    assert.deepEqual(seen, [FIRST, SECOND])
    assert.equal(body.catalog.entries.some(entry => entry.id === 'remote.one'), true)
  })

  it('serves the cached copy when every source then goes away', async () => {
    const cacheFile = join(dir, 'sticky.json')
    const first = createCatalogRoute({
      readBundled: async () => BUNDLED,
      sources: [FIRST],
      fetchRemote: async () => new Response(JSON.stringify(REMOTE)),
      cacheFile,
      ttlMs: 0,
    })
    await first.fetch(new Request('http://host/api/ft-gallery/catalog'))
    const second = createCatalogRoute({
      readBundled: async () => BUNDLED,
      sources: [FIRST],
      fetchRemote: async () => { throw new Error('offline') },
      cacheFile,
      ttlMs: 0,
    })
    const body = await (await second.fetch(new Request('http://host/api/ft-gallery/catalog'))).json()
    assert.equal(body.catalog.meta.remote, 'cached')
    assert.equal(body.catalog.meta.stale, true)
    assert.equal(body.catalog.entries.some(entry => entry.id === 'remote.one'), true)
  })

  it('treats every source answering 404 as not published', async () => {
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      sources: [FIRST, SECOND],
      fetchRemote: async () => new Response('missing', { status: 404 }),
      cacheFile: join(dir, 'missing.json'),
    })
    const body = await (await route.fetch(new Request('http://host/api/ft-gallery/catalog'))).json()
    assert.equal(body.catalog.meta.notPublished, true)
    assert.equal(body.catalog.meta.remote, 'unavailable')
    assert.equal(body.catalog.entries.length, 1)
    assert.equal(body.catalog.entries[0].id, 'bundled.one')
  })

  it('reports every failing source when none is a plain 404', async () => {
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      sources: [FIRST, SECOND],
      fetchRemote: async (url) => {
        if (url === FIRST) return new Response('nope', { status: 503 })
        throw new Error('timeout')
      },
      cacheFile: join(dir, 'broken.json'),
    })
    const body = await (await route.fetch(new Request('http://host/api/ft-gallery/catalog'))).json()
    assert.equal(body.catalog.meta.remote, 'unavailable')
    assert.match(body.catalog.meta.warning, /cdn\.jsdelivr\.net.*503/)
    assert.match(body.catalog.meta.warning, /raw\.githubusercontent\.com.*timeout/)
  })
})
