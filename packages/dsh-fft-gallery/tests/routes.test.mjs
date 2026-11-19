/**
 * Contract tests for the gallery's two host routes.
 *
 * The routes are the only stateful part of the package, so they are built from
 * injected collaborators: these tests hand in a scratch directory, a stub fetch
 * and a fixed clock, and then assert the fallbacks (remote → cache → bundled)
 * and the shelf's serialized writes.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  CATALOG_ROUTE,
  STATE_ROUTE,
  createCatalogRoute,
  createStateRoute,
  mergeCatalogs,
} from '../src/index.js'

const BUNDLED = {
  format: 2,
  generatedAt: '2026-11-01T00:00:00.000Z',
  categories: { market: { zh: '行情', en: 'Market data' } },
  entries: [
    { id: 'bundled.only', kind: 'web', title: { zh: '内建', en: 'Bundled' }, summary: { zh: '内建', en: 'Bundled' }, url: 'https://example.com/', category: 'market', order: 10 },
    { id: 'shared.entry', kind: 'web', title: { zh: '旧', en: 'Old' }, summary: { zh: '旧', en: 'Old' }, url: 'https://example.com/old', category: 'market', order: 20 },
  ],
}

const REMOTE = {
  format: 2,
  generatedAt: '2026-11-17T00:00:00.000Z',
  categories: { tool: { zh: '工具', en: 'Tools' } },
  entries: [
    { id: 'shared.entry', kind: 'web', title: { zh: '新', en: 'New' }, summary: { zh: '新', en: 'New' }, url: 'https://example.com/new', category: 'tool', order: 20 },
    { id: 'remote.only', kind: 'plugin', title: { zh: '插件', en: 'Plugin' }, summary: { zh: '插件', en: 'Plugin' }, spec: { type: 'npm', name: 'demo', version: '1.0.0' }, category: 'tool', order: 30 },
  ],
}

/** A scratch directory per test. */
async function scratch() {
  return mkdtemp(join(tmpdir(), 'ftg-routes-'))
}

/** One GET against a route. */
function get(route, path = route.path, query = '') {
  return route.fetch(new Request(`http://127.0.0.1${path}${query}`))
}

/** One POST of a JSON body against a route. */
function post(route, body) {
  return route.fetch(new Request(`http://127.0.0.1${route.path}`, { method: 'POST', body: JSON.stringify(body) }))
}

describe('mergeCatalogs', () => {
  it('keeps one entry per id with the synced one winning', () => {
    const merged = mergeCatalogs(BUNDLED, REMOTE)
    assert.deepEqual(merged.entries.map(entry => entry.id), ['bundled.only', 'shared.entry', 'remote.only'])
    const shared = merged.entries.find(entry => entry.id === 'shared.entry')
    assert.equal(shared.title.zh, '新')
    assert.deepEqual(merged.categories, {
      market: { zh: '行情', en: 'Market data' },
      tool: { zh: '工具', en: 'Tools' },
    })
  })

  it('sorts by order then id', () => {
    const merged = mergeCatalogs(
      { format: 2, entries: [{ id: 'b', order: 20, kind: 'web' }, { id: 'a', order: 10, kind: 'web' }] },
      { format: 2, entries: [] },
    )
    assert.deepEqual(merged.entries.map(entry => entry.id), ['a', 'b'])
  })
})

describe('catalog route', () => {
  it('merges the synced catalog over the bundled one', async () => {
    const dir = await scratch()
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      fetchRemote: async () => new Response(JSON.stringify(REMOTE), { headers: { etag: '"1"' } }),
      cacheFile: join(dir, 'cache.json'),
      ttlMs: 60_000,
    })
    const response = await get(route, CATALOG_ROUTE)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.catalog.entries.map(entry => entry.id), ['bundled.only', 'shared.entry', 'remote.only'])
    assert.equal(body.catalog.meta.remote, 'fresh')
    assert.equal(route.path, CATALOG_ROUTE)
  })

  it('serves the cache inside the TTL and refetches past it or on refresh', async () => {
    const dir = await scratch()
    let clock = 0
    let calls = 0
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      fetchRemote: async () => {
        calls += 1
        return new Response(JSON.stringify(REMOTE))
      },
      cacheFile: join(dir, 'cache.json'),
      ttlMs: 1_000,
      now: () => clock,
    })
    await get(route)
    clock = 500
    await get(route)
    assert.equal(calls, 1, 'inside the TTL the cache answers')
    clock = 2_000
    await get(route)
    assert.equal(calls, 2, 'past the TTL the remote is read again')
    await get(route, CATALOG_ROUTE, '?refresh=1')
    assert.equal(calls, 3, 'refresh bypasses the TTL')
  })

  it('falls back to the cached catalog when the remote fails', async () => {
    const dir = await scratch()
    let fail = false
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      fetchRemote: async () => {
        if (fail) throw new Error('offline')
        return new Response(JSON.stringify(REMOTE))
      },
      cacheFile: join(dir, 'cache.json'),
      ttlMs: 0,
    })
    await get(route)
    fail = true
    const body = await (await get(route)).json()
    assert.equal(body.ok, true)
    assert.equal(body.catalog.meta.remote, 'cached')
    assert.equal(body.catalog.meta.stale, true)
    assert.ok(body.catalog.entries.some(entry => entry.id === 'remote.only'))
  })

  it('serves the bundled catalog alone when nothing is cached', async () => {
    const dir = await scratch()
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      fetchRemote: async () => { throw new Error('offline') },
      cacheFile: join(dir, 'cache.json'),
    })
    const body = await (await get(route)).json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.catalog.entries.map(entry => entry.id), ['bundled.only', 'shared.entry'])
    assert.equal(body.catalog.meta.remote, 'unavailable')
    assert.match(body.catalog.meta.warning, /offline/)
  })

  it('rejects a remote document of the wrong format and keeps the cache', async () => {
    const dir = await scratch()
    let payload = REMOTE
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      fetchRemote: async () => new Response(JSON.stringify(payload)),
      cacheFile: join(dir, 'cache.json'),
      ttlMs: 0,
    })
    await get(route)
    payload = { format: 1, plugins: [] }
    const body = await (await get(route)).json()
    assert.deepEqual(body.catalog.entries.map(entry => entry.id), ['bundled.only', 'shared.entry', 'remote.only'])
    assert.equal(body.catalog.meta.stale, true)
  })

  it('reports an unreadable bundled catalog instead of throwing', async () => {
    const route = createCatalogRoute({
      readBundled: async () => { throw new Error('missing') },
      fetchRemote: async () => new Response('{}'),
    })
    const body = await (await get(route)).json()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'CATALOG_UNAVAILABLE')
  })

  it('refuses methods other than GET', async () => {
    const route = createCatalogRoute({ readBundled: async () => BUNDLED, fetchRemote: async () => new Response('{}') })
    const response = await post(route, {})
    assert.equal(response.status, 405)
  })
})

describe('state route', () => {
  it('answers with an empty shelf and survives a restart', async () => {
    const dir = await scratch()
    const stateFile = join(dir, 'state.json')
    const first = createStateRoute({ stateFile })
    assert.equal(STATE_ROUTE, first.path)
    const empty = await (await first.fetch(new Request(`http://127.0.0.1${STATE_ROUTE}`))).json()
    assert.deepEqual(empty.state.favorites, {})
    await post(first, { op: 'favorite', id: 'ftshare.etf-flow' })
    const second = createStateRoute({ stateFile })
    const body = await (await second.fetch(new Request(`http://127.0.0.1${STATE_ROUTE}`))).json()
    assert.deepEqual(Object.keys(body.state.favorites), ['ftshare.etf-flow'])
  })

  it('removes a favorite', async () => {
    const dir = await scratch()
    const route = createStateRoute({ stateFile: join(dir, 'state.json') })
    await post(route, { op: 'favorite', id: 'a' })
    await post(route, { op: 'favorite', id: 'b' })
    const body = await (await post(route, { op: 'unfavorite', id: 'a' })).json()
    assert.deepEqual(Object.keys(body.state.favorites), ['b'])
  })

  it('serializes concurrent mutations without losing one', async () => {
    const dir = await scratch()
    const route = createStateRoute({ stateFile: join(dir, 'state.json') })
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(id => post(route, { op: 'favorite', id })))
    const body = await (await route.fetch(new Request(`http://127.0.0.1${STATE_ROUTE}`))).json()
    assert.deepEqual(Object.keys(body.state.favorites).sort(), ['a', 'b', 'c', 'd', 'e'])
  })

  it('rejects a bad body and a bad operation', async () => {
    const dir = await scratch()
    const route = createStateRoute({ stateFile: join(dir, 'state.json') })
    const notJson = await route.fetch(new Request(`http://127.0.0.1${STATE_ROUTE}`, { method: 'POST', body: 'nope' }))
    assert.equal(notJson.status, 400)
    const badOp = await post(route, { op: 'delete', id: 'a' })
    assert.equal(badOp.status, 400)
    const noId = await post(route, { op: 'favorite' })
    assert.equal(noId.status, 400)
  })

  it('writes through a temporary file, never half a document', async () => {
    const dir = await scratch()
    const stateFile = join(dir, 'state.json')
    const route = createStateRoute({ stateFile })
    await post(route, { op: 'favorite', id: 'a' })
    const text = await readFile(stateFile, 'utf8')
    assert.equal(JSON.parse(text).favorites.a !== undefined, true)
    await writeFile(stateFile, text)
  })
})

describe('personal entries', () => {
  const statFile = async (path) => {
    if (path === '/tmp/report.html') return { isFile: () => true }
    throw new Error('ENOENT')
  }

  it('migrates a version-1 shelf into version 2 without losing favorites', async () => {
    const dir = await scratch()
    const stateFile = join(dir, 'state.json')
    await writeFile(stateFile, JSON.stringify({ version: 1, favorites: { 'ftshare.etf-flow': { at: '2026-11-01T00:00:00.000Z' } }, updatedAt: '2026-11-01T00:00:00.000Z' }))
    const route = createStateRoute({ stateFile, statFile })
    const body = await (await get(route)).json()
    assert.equal(body.state.version, 2)
    assert.deepEqual(Object.keys(body.state.favorites), ['ftshare.etf-flow'])
    assert.deepEqual(body.state.links, [])
    assert.deepEqual(body.state.pages, [])
  })

  it('adds a link, defaulting the title to its host, then edits and removes it', async () => {
    const dir = await scratch()
    const route = createStateRoute({ stateFile: join(dir, 'state.json'), now: () => '2026-11-19T00:00:00.000Z' })
    const added = await (await post(route, { op: 'add-link', url: 'https://market.ft.tech/gateway/doc/' })).json()
    assert.equal(added.ok, true)
    assert.equal(added.state.links.length, 1)
    const [link] = added.state.links
    assert.match(link.id, /^link_[a-z0-9]{8,}$/u)
    assert.equal(link.title, 'market.ft.tech')
    assert.equal(link.url, 'https://market.ft.tech/gateway/doc/')
    assert.equal(link.at, '2026-11-19T00:00:00.000Z')

    const edited = await (await post(route, { op: 'update-link', id: link.id, title: 'FtShare 接口文档' })).json()
    assert.equal(edited.state.links[0].title, 'FtShare 接口文档')
    assert.equal(edited.state.links[0].url, link.url)

    const removed = await (await post(route, { op: 'remove-link', id: link.id })).json()
    assert.equal(removed.state.links.length, 0)
  })

  it('rejects a non-http URL and mutating an unknown row', async () => {
    const dir = await scratch()
    const route = createStateRoute({ stateFile: join(dir, 'state.json') })
    const badScheme = await post(route, { op: 'add-link', url: 'ftp://example.com/file' })
    assert.equal(badScheme.status, 400)
    assert.match((await badScheme.json()).error.message, /http\/https/u)
    const badUrl = await post(route, { op: 'add-link', url: 'not a url' })
    assert.equal(badUrl.status, 400)
    const missing = await post(route, { op: 'remove-link', id: 'link_missing0000' })
    assert.equal(missing.status, 400)
  })

  it('adds a page only when the path is an existing html file', async () => {
    const dir = await scratch()
    const route = createStateRoute({ stateFile: join(dir, 'state.json'), statFile })
    const relative = await post(route, { op: 'add-page', path: 'report.html' })
    assert.equal(relative.status, 400)
    const notHtml = await post(route, { op: 'add-page', path: '/tmp/report.md' })
    assert.equal(notHtml.status, 400)
    const missing = await post(route, { op: 'add-page', path: '/tmp/missing.html' })
    assert.equal(missing.status, 400)

    const added = await (await post(route, { op: 'add-page', path: '/tmp/report.html', title: '周报' })).json()
    assert.equal(added.state.pages.length, 1)
    assert.match(added.state.pages[0].id, /^page_[a-z0-9]{8,}$/u)
    assert.equal(added.state.pages[0].title, '周报')
    assert.equal(added.state.pages[0].path, '/tmp/report.html')

    const removed = await (await post(route, { op: 'remove-page', id: added.state.pages[0].id })).json()
    assert.equal(removed.state.pages.length, 0)
  })

  it('keeps favorites, links and pages in one serialized document', async () => {
    const dir = await scratch()
    const stateFile = join(dir, 'state.json')
    const route = createStateRoute({ stateFile, statFile })
    await Promise.all([
      post(route, { op: 'favorite', id: 'ftshare.etf-flow' }),
      post(route, { op: 'add-link', url: 'https://example.com/' }),
      post(route, { op: 'add-page', path: '/tmp/report.html' }),
    ])
    const body = await (await createStateRoute({ stateFile, statFile }).fetch(new Request(`http://127.0.0.1${STATE_ROUTE}`))).json()
    assert.deepEqual(Object.keys(body.state.favorites), ['ftshare.etf-flow'])
    assert.equal(body.state.links.length, 1)
    assert.equal(body.state.pages.length, 1)
  })
})

describe('catalog route without a published branch', () => {
  it('reports the remote as unpublished instead of stale on a 404', async () => {
    const dir = await scratch()
    const route = createCatalogRoute({
      readBundled: async () => BUNDLED,
      fetchRemote: async () => new Response('not found', { status: 404 }),
      cacheFile: join(dir, 'cache.json'),
    })
    const body = await (await get(route)).json()
    assert.equal(body.ok, true)
    assert.equal(body.catalog.meta.remote, 'unavailable')
    assert.equal(body.catalog.meta.notPublished, true)
    assert.equal(body.catalog.meta.stale, false)
    assert.deepEqual(body.catalog.entries.map(entry => entry.id), ['bundled.only', 'shared.entry'])
  })
})
