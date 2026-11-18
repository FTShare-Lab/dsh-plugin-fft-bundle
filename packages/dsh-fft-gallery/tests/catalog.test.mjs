/**
 * Contract tests for the catalog build.
 *
 * The build is offline and deterministic: given the same entries and clock it
 * must produce the same bytes. The tests run the pure builder against the
 * committed `gallery/entries/` files and against the built `catalog.json`, so a
 * hand edit to either side is caught here rather than in the UI.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { CATALOG_FORMAT, buildCatalog, projectEntry, renderCatalog, resolveGeneratedAt } from '../scripts/build.mjs'
import { CATEGORIES, readEntriesDir } from '../scripts/gallery-sync.mjs'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const FIXED_AT = '2026-11-17T00:00:00.000Z'

const { files } = await readEntriesDir(resolve(packageRoot, 'gallery/entries'))
const containers = files.map(file => file.record)
const built = buildCatalog(containers, { generatedAt: FIXED_AT })

/** A minimal container the sorting tests can order freely. */
function containerOf(entries) {
  return { source: 'github', repo: 'https://github.com/demo/repo', stars: 0, syncedAt: FIXED_AT, entries }
}

describe('catalog determinism', () => {
  it('renders byte-identical output for the same entries and clock', () => {
    const first = renderCatalog(buildCatalog(containers, { generatedAt: FIXED_AT }))
    const second = renderCatalog(buildCatalog(containers, { generatedAt: FIXED_AT }))
    assert.equal(first, second)
    assert.deepEqual(JSON.parse(first), JSON.parse(second))
  })

  it('pins generatedAt through SOURCE_DATE_EPOCH', () => {
    assert.equal(resolveGeneratedAt({ SOURCE_DATE_EPOCH: '1800000000' }), '2027-01-15T08:00:00.000Z')
    assert.equal(resolveGeneratedAt({}, () => new Date(FIXED_AT)), FIXED_AT)
    assert.throws(() => resolveGeneratedAt({ SOURCE_DATE_EPOCH: 'soon' }), /SOURCE_DATE_EPOCH/)
  })

  it('renders one trailing newline and re-parses', () => {
    const text = renderCatalog(built)
    assert.ok(text.endsWith('}\n'))
    assert.deepEqual(JSON.parse(text), built)
  })
})

describe('catalog shape', () => {
  it('declares format 2 and the fixed category table', () => {
    assert.equal(built.format, 2)
    assert.equal(CATALOG_FORMAT, 2)
    assert.equal(built.generatedAt, FIXED_AT)
    assert.deepEqual(built.categories, Object.fromEntries(Object.entries(CATEGORIES).map(([id, names]) => [id, { zh: names.zh, en: names.en }])))
    assert.equal(Object.keys(built.categories).length, 5)
  })

  it('covers every category an entry names', () => {
    for (const entry of built.entries) {
      if (entry.category === undefined) continue
      assert.ok(built.categories[entry.category] !== undefined, `${entry.id} names undeclared category ${entry.category}`)
    }
  })

  it('leaves an entry without a category out of the pills but keeps it in the catalog', () => {
    const catalog = buildCatalog([{ source: 'github', repo: 'https://example.com/r', stars: 0, syncedAt: FIXED_AT,
      entries: [{ id: 'no.category', kind: 'web', title: { zh: '无分类', en: 'No category' }, summary: { zh: '无', en: 'No' }, url: 'https://example.com/' }] }], { generatedAt: FIXED_AT })
    assert.equal(catalog.entries[0].category, undefined)
    assert.equal(Object.keys(catalog.categories).length, 5)
  })

  it('keeps ids unique', () => {
    const ids = built.entries.map(entry => entry.id)
    assert.deepEqual(ids, [...new Set(ids)])
    assert.deepEqual(ids, ['ftshare.etf-flow', 'ft.paper-trading'], 'order 10 sorts before order 20')
  })

  it('projects the repository snapshot onto every entry', () => {
    for (const entry of built.entries) {
      assert.equal(entry.source, 'github')
      assert.match(entry.repo, /^https:\/\/github\.com\//)
      assert.ok(Number.isInteger(entry.stars))
      assert.ok(Number.isInteger(entry.order))
      assert.notEqual(Date.parse(entry.syncedAt), Number.NaN)
    }
  })

  it('projects only the fields each kind carries', () => {
    const web = built.entries.find(entry => entry.id === 'ftshare.etf-flow')
    assert.equal(web.kind, 'web')
    assert.equal(new URL(web.url).protocol, 'https:')
    assert.equal(web.embeddable, true)
    assert.equal(web.spec, undefined)
    assert.equal(web.open, undefined)

    const plugin = built.entries.find(entry => entry.id === 'ft.paper-trading')
    assert.equal(plugin.kind, 'plugin')
    assert.deepEqual(plugin.spec, { type: 'npm', name: '@dsh-ft/dsh-fft-paper-trading', version: '0.7.2' })
    assert.deepEqual(plugin.open, { panel: 'ft-paper-trading' })
    assert.equal(plugin.url, undefined)
    assert.equal(plugin.embeddable, undefined)
    assert.equal(plugin.summary.en, 'Paper orders, positions and review for A-shares and commodity futures.')
  })

  it('does not leak fields the schema does not define', () => {
    const allowed = new Set([
      'id', 'kind', 'category', 'order', 'title', 'summary', 'details', 'cover', 'screenshots',
      'url', 'spec', 'open', 'homepage', 'author', 'engines', 'embeddable', 'source', 'repo', 'stars', 'syncedAt',
    ])
    for (const entry of built.entries) {
      for (const key of Object.keys(entry)) assert.ok(allowed.has(key), `${entry.id} leaks ${key}`)
    }
    assert.equal(built.entries[1].details.zh, '本地账本记录成交与持仓，内置 FTShare 行情与 K 线；安装后从右侧栏打开，和手工装的模拟交易完全一致。')
  })
})

describe('catalog ordering', () => {
  it('sorts by order first and id second', () => {
    const catalog = buildCatalog([containerOf([
      { id: 'b', kind: 'web', category: 'market', order: 30, title: { zh: 'B', en: 'B' }, summary: { zh: 'B', en: 'B' }, url: 'https://example.com/b' },
      { id: 'c', kind: 'web', category: 'market', order: 10, title: { zh: 'C', en: 'C' }, summary: { zh: 'C', en: 'C' }, url: 'https://example.com/c' },
      { id: 'a', kind: 'web', category: 'market', order: 10, title: { zh: 'A', en: 'A' }, summary: { zh: 'A', en: 'A' }, url: 'https://example.com/a' },
    ])], { generatedAt: FIXED_AT })
    assert.deepEqual(catalog.entries.map(entry => entry.id), ['a', 'c', 'b'])
  })

  it('places an entry without order at the default', () => {
    const catalog = buildCatalog([containerOf([
      { id: 'first', kind: 'web', category: 'market', order: 10, title: { zh: '1', en: '1' }, summary: { zh: '1', en: '1' }, url: 'https://example.com/1' },
      { id: 'default', kind: 'web', category: 'market', title: { zh: '2', en: '2' }, summary: { zh: '2', en: '2' }, url: 'https://example.com/2' },
    ])], { generatedAt: FIXED_AT })
    assert.deepEqual(catalog.entries.map(entry => entry.id), ['first', 'default'])
    assert.equal(catalog.entries[1].order, 100)
  })
})

describe('catalog errors', () => {
  it('refuses to publish an empty gallery', () => {
    assert.throws(() => buildCatalog([], { generatedAt: FIXED_AT }), /no gallery entries/)
    assert.throws(() => buildCatalog([containerOf([])], { generatedAt: FIXED_AT }), /no gallery entries/)
  })

  it('refuses duplicate ids from two files', () => {
    const entry = { id: 'same', kind: 'web', category: 'market', title: { zh: 'S', en: 'S' }, summary: { zh: 'S', en: 'S' }, url: 'https://example.com/s' }
    assert.throws(() => buildCatalog([containerOf([entry]), containerOf([entry])], { generatedAt: FIXED_AT }), /duplicate entry id: same/)
  })
})

describe('built catalog.json', () => {
  it('matches a fresh build of the committed entries', async () => {
    const onDisk = JSON.parse(await readFile(resolve(packageRoot, 'gallery/catalog.json'), 'utf8'))
    assert.equal(onDisk.format, 2)
    assert.deepEqual(onDisk.categories, built.categories)
    assert.deepEqual(onDisk.entries, built.entries)
    assert.notEqual(Date.parse(onDisk.generatedAt), Number.NaN)
  })

  it('is exactly the projection of the entries files', () => {
    const projected = containers.flatMap(container => container.entries.map(entry => projectEntry(entry, container)))
    assert.deepEqual(built.entries, projected)
  })
})

describe('lib build output', () => {
  it('copies both halves verbatim, keeping the client module id', async () => {
    for (const [source, target] of [['src/index.js', 'lib/index.js'], ['src/client/index.js', 'lib/client.js']]) {
      const [from, to] = await Promise.all([
        readFile(resolve(packageRoot, source), 'utf8'),
        readFile(resolve(packageRoot, target), 'utf8'),
      ])
      assert.equal(to, from, `${target} must be a verbatim copy of ${source}`)
    }
    const client = await readFile(resolve(packageRoot, 'lib/client.js'), 'utf8')
    assert.ok(client.includes("id: '@dsh-ft/dsh-fft-gallery'"))
  })
})
