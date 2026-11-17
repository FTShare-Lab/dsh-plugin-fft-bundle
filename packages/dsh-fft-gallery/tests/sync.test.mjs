/**
 * Contract tests for the entry schema and the GitHub sync.
 *
 * The fixtures are fragments of real files: `manifest-valid.json` is the
 * example from the design doc, `manifest-legacy-v1.json` is a v1 entry that
 * must now be rejected, and `entries-*` are copies of the files the sync
 * writes. Nothing here touches the network: every fetch is injected.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import {
  CATEGORIES,
  SEARCH_URL,
  buildEntries,
  checkEntries,
  entriesFileName,
  manifestUrl,
  parseArgs,
  parseEntriesFile,
  parseManifest,
  probeImage,
  probePage,
  readEntriesDir,
  resolveAsset,
  searchRepositories,
  syncFromGitHub,
  validateEntry,
} from '../scripts/gallery-sync.mjs'

const run = promisify(execFile)
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixtures = resolve(packageRoot, 'tests/fixtures')
const MANIFEST_URL = 'https://raw.githubusercontent.com/Example-Lab/dsh-ft-demo/main/dsh-ft-gallery.json'
const REPO_URL = 'https://github.com/Example-Lab/dsh-ft-demo'

const readFixture = name => readFile(resolve(fixtures, name), 'utf8')

/** A web entry already in the shape the validator wants (assets absolute). */
function webEntry(overrides = {}) {
  return {
    id: 'demo.web',
    kind: 'web',
    title: { zh: '示例', en: 'Demo' },
    summary: { zh: '一个网页条目', en: 'A web entry' },
    url: 'https://demo.example.com/',
    category: 'market',
    ...overrides,
  }
}

/** A plugin entry already in the shape the validator wants. */
function pluginEntry(overrides = {}) {
  return {
    id: 'demo.plugin',
    kind: 'plugin',
    title: { zh: '示例插件', en: 'Demo plugin' },
    summary: { zh: '一个插件条目', en: 'A plugin entry' },
    spec: { type: 'npm', name: '@demo/plugin', version: '1.2.3' },
    category: 'tool',
    ...overrides,
  }
}

/** A JSON response for the injected fetch. */
function reply(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers })
}

describe('parseManifest', () => {
  it('validates the design-doc manifest and resolves its relative assets', async () => {
    const entries = parseManifest(await readFixture('manifest-valid.json'), {
      file: 'dsh-ft-gallery.json',
      repoUrl: REPO_URL,
      baseManifestUrl: MANIFEST_URL,
      knownIds: new Set(),
    })
    assert.deepEqual(entries.map(entry => entry.id), ['ftshare.etf-flow', 'ft.paper-trading'])

    const [web, plugin] = entries
    assert.equal(web.kind, 'web')
    assert.equal(web.cover, 'https://raw.githubusercontent.com/Example-Lab/dsh-ft-demo/main/assets/cover.png')
    assert.equal(web.screenshots[0].src, 'https://raw.githubusercontent.com/Example-Lab/dsh-ft-demo/main/assets/shot-flow.png')
    assert.equal(web.screenshots[0].alt.zh, '资金流看板')
    assert.equal(web.order, 100, 'an entry without order sorts at the default')
    assert.equal(web.details.en, 'Split by sector and broad index.')
    assert.equal(web.embeddable, undefined, 'embeddable is observed by the sync, never declared')

    assert.equal(plugin.kind, 'plugin')
    assert.deepEqual(plugin.spec, { type: 'npm', name: '@dsh-ft/dsh-fft-paper-trading', version: '0.7.2' })
    assert.deepEqual(plugin.open, { kind: 'paper-trading' })
    assert.equal(plugin.cover, 'https://raw.githubusercontent.com/Example-Lab/dsh-ft-demo/main/assets/cover-paper.png')
  })

  it('rejects unparseable JSON', async () => {
    const text = await readFixture('manifest-invalid-json.json')
    assert.throws(() => parseManifest(text, { file: 'broken.json' }), /broken\.json: invalid JSON/)
  })

  it('rejects an entry missing a required localized field', async () => {
    const text = await readFixture('manifest-missing-summary.json')
    assert.throws(
      () => parseManifest(text, { file: 'manifest.json', baseManifestUrl: MANIFEST_URL }),
      /summary must be a \{ zh, en \} object/,
    )
  })

  it('rejects the retired v1 fields of a real old entry', async () => {
    const text = await readFixture('manifest-legacy-v1.json')
    assert.throws(
      () => parseManifest(text, { file: 'manifest.json', baseManifestUrl: MANIFEST_URL }),
      /unknown field\(s\): trust/,
    )
  })

  it('rejects a duplicate id inside one manifest', async () => {
    const text = await readFixture('manifest-id-conflict.json')
    assert.throws(
      () => parseManifest(text, { file: 'manifest.json', baseManifestUrl: MANIFEST_URL, knownIds: new Set() }),
      /duplicate entry id: ft\.paper-trading/,
    )
  })

  it('rejects an empty manifest and unknown top-level fields', () => {
    assert.throws(() => parseManifest('{"entries":[]}'), /entries must be a non-empty array/)
    assert.throws(
      () => parseManifest('{"entries":[],"trust":"verified"}', { file: 'm.json' }),
      /unknown top-level field\(s\): trust/,
    )
  })

  it('rejects an id already taken by another repository', () => {
    const text = JSON.stringify({ entries: [webEntry()] })
    assert.throws(
      () => parseManifest(text, { file: 'm.json', baseManifestUrl: MANIFEST_URL, knownIds: new Set(['demo.web']) }),
      /duplicate entry id: demo\.web/,
    )
  })
})

describe('validateEntry', () => {
  it('accepts web and plugin entries and normalizes them', () => {
    const web = validateEntry(webEntry({ title: { zh: ' 示例 ', en: 'Demo' }, order: 5 }))
    assert.deepEqual(web.title, { zh: '示例', en: 'Demo' })
    assert.equal(web.order, 5)
    assert.equal(web.url, 'https://demo.example.com/')

    const plugin = validateEntry(pluginEntry())
    assert.deepEqual(plugin.spec, { type: 'npm', name: '@demo/plugin', version: '1.2.3' })
    assert.equal(plugin.order, 100)
  })

  it('records each id in knownIds and refuses a repeat', () => {
    const knownIds = new Set()
    validateEntry(webEntry(), { knownIds })
    assert.ok(knownIds.has('demo.web'))
    assert.throws(() => validateEntry(webEntry(), { knownIds }), /duplicate entry id: demo\.web/)
  })

  it('holds the id grammar', () => {
    assert.throws(() => validateEntry(webEntry({ id: 'Demo.Web' })), /id must match/)
    assert.throws(() => validateEntry(webEntry({ id: 'a' })), /id must match/)
    assert.throws(() => validateEntry(webEntry({ id: '-bad' })), /id must match/)
  })

  it('holds the summary and details limits', () => {
    assert.throws(() => validateEntry(webEntry({ summary: { zh: '长'.repeat(81), en: 'ok' } })), /longer than 80 characters/)
    assert.throws(() => validateEntry(webEntry({ details: { zh: '长'.repeat(801), en: 'ok' } })), /longer than 800 characters/)
  })

  it('refuses a non-HTTPS url, embedded credentials and cross-kind fields', () => {
    assert.throws(() => validateEntry(webEntry({ url: 'http://demo.example.com/' })), /url must use https/)
    assert.throws(() => validateEntry(webEntry({ url: 'https://user:pass@demo.example.com/' })), /must not embed credentials/)
    assert.throws(() => validateEntry(webEntry({ spec: pluginEntry().spec })), /spec belongs to a plugin entry/)
    assert.throws(() => validateEntry(pluginEntry({ url: 'https://demo.example.com/' })), /url belongs to a web entry/)
    assert.throws(() => validateEntry(webEntry({ kind: 'app' })), /kind must be web or plugin/)
    assert.throws(() => validateEntry(webEntry({ category: 'news' })), /category must be one of/)
  })

  it('refuses the banned asset shapes', () => {
    assert.throws(() => validateEntry(webEntry({ cover: 'data:image/png;base64,AAAA' })), /must use https/)
    assert.throws(() => validateEntry(webEntry({ cover: 'https://demo.example.com/cover.svg' })), /svg is not allowed/)
    assert.throws(
      () => validateEntry(webEntry({ screenshots: Array.from({ length: 5 }, () => ({ src: 'https://demo.example.com/a.png', alt: { zh: '图', en: 'Shot' } })) })),
      /at most 4 images/,
    )
    assert.throws(
      () => validateEntry(webEntry({ screenshots: [{ src: 'https://demo.example.com/a.png' }] })),
      /screenshots\[0\]\.alt must be a \{ zh, en \} object/,
    )
  })

  it('holds the npm and git spec rules', () => {
    assert.throws(() => validateEntry(pluginEntry({ spec: { type: 'npm', name: '@demo/plugin', version: '^1.2.3' } })), /exact SemVer/)
    assert.throws(() => validateEntry(pluginEntry({ spec: { type: 'npm', name: 'Bad Name', version: '1.2.3' } })), /package name/)
    assert.throws(() => validateEntry(pluginEntry({ spec: { type: 'npm', name: '@demo/plugin', version: '1.2.3', registry: 'https://registry.npmjs.org' } })), /spec has unknown field\(s\): registry/)
    assert.throws(
      () => validateEntry(pluginEntry({ spec: { type: 'git', url: 'https://github.com/demo/plugin', commit: 'abc' } })),
      /40-character hex commit/,
    )
    const git = validateEntry(pluginEntry({ spec: { type: 'git', url: 'https://github.com/demo/plugin', commit: 'a'.repeat(40), path: 'packages/plugin' } }))
    assert.deepEqual(git.spec, { type: 'git', url: 'https://github.com/demo/plugin', commit: 'a'.repeat(40), path: 'packages/plugin' })
  })

  it('holds the engines range', () => {
    assert.deepEqual(validateEntry(webEntry({ engines: { dsh: '>=0.2.1-rc.2' } })).engines, { dsh: '>=0.2.1-rc.2' })
    assert.throws(() => validateEntry(webEntry({ engines: { dsh: 'latest' } })), /SemVer range/)
    assert.throws(() => validateEntry(webEntry({ engines: { node: '>=22' } })), /engines has unknown field/)
  })
})

describe('resolveAsset', () => {
  it('resolves a relative asset against the manifest URL', () => {
    assert.equal(
      resolveAsset(MANIFEST_URL, './assets/cover.png'),
      'https://raw.githubusercontent.com/Example-Lab/dsh-ft-demo/main/assets/cover.png',
    )
    assert.equal(
      resolveAsset(MANIFEST_URL, 'assets/cover.webp'),
      'https://raw.githubusercontent.com/Example-Lab/dsh-ft-demo/main/assets/cover.webp',
    )
  })

  it('keeps an absolute HTTPS asset', () => {
    assert.equal(resolveAsset(MANIFEST_URL, 'https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg')
  })

  it('refuses http, data: and svg assets', () => {
    assert.throws(() => resolveAsset(MANIFEST_URL, 'http://cdn.example.com/a.png'), /asset must use https/)
    assert.throws(() => resolveAsset(MANIFEST_URL, 'data:image/png;base64,AAAA'), /data: URL/)
    assert.throws(() => resolveAsset(MANIFEST_URL, './assets/a.svg'), /svg is not allowed/)
  })

  it('refuses a relative asset without an HTTPS base', () => {
    assert.throws(() => resolveAsset(undefined, './assets/a.png'), /without the manifest URL/)
    assert.throws(() => resolveAsset('http://example.com/main/dsh-ft-gallery.json', './a.png'), /manifest URL must use https/)
  })
})

describe('probeImage', () => {
  it('accepts the three image content types', async () => {
    for (const contentType of ['image/png', 'image/jpeg', 'image/webp']) {
      const calls = []
      const observation = await probeImage('https://cdn.example.com/a.png', async (url, init) => {
        calls.push({ url, init })
        return reply(null, { headers: { 'content-type': `${contentType}; charset=binary` } })
      })
      assert.equal(observation.ok, true, contentType)
      assert.equal(observation.contentType, contentType)
      assert.equal(calls[0].init.method, 'HEAD')
    }
  })

  it('refuses other content types and unreachable images', async () => {
    const svg = await probeImage('https://cdn.example.com/a.png', async () => reply(null, { headers: { 'content-type': 'image/svg+xml' } }))
    assert.equal(svg.ok, false)
    assert.match(svg.error, /image\/svg\+xml/)
    const page = await probeImage('https://cdn.example.com/a.png', async () => reply('<html>', { headers: { 'content-type': 'text/html' } }))
    assert.equal(page.ok, false)
    const missing = await probeImage('https://cdn.example.com/a.png', async () => reply(null, { status: 404 }))
    assert.equal(missing.ok, false)
    assert.match(missing.error, /HTTP 404/)
  })

  it('reports a network failure instead of throwing', async () => {
    const observation = await probeImage('https://cdn.example.com/a.png', async () => { throw new Error('boom') })
    assert.equal(observation.ok, false)
    assert.equal(observation.status, 0)
    assert.match(observation.error, /boom/)
  })

  it('falls back to a ranged GET when HEAD is refused', async () => {
    const methods = []
    const observation = await probeImage('https://cdn.example.com/a.png', async (url, init) => {
      methods.push(init.method)
      return init.method === 'HEAD'
        ? reply(null, { status: 405 })
        : reply(null, { headers: { 'content-type': 'image/png' } })
    })
    assert.deepEqual(methods, ['HEAD', 'GET'])
    assert.equal(observation.ok, true)
  })
})

describe('probePage', () => {
  it('marks a plain page embeddable', async () => {
    const observation = await probePage('https://demo.example.com/', async () => reply(null, { headers: { 'content-type': 'text/html' } }))
    assert.equal(observation.reachable, true)
    assert.equal(observation.embeddable, true)
    assert.equal(observation.xfo, null)
  })

  it('honours X-Frame-Options', async () => {
    for (const value of ['DENY', 'SAMEORIGIN', 'ALLOW-FROM https://other.example']) {
      const observation = await probePage('https://demo.example.com/', async () => reply(null, { headers: { 'x-frame-options': value } }))
      assert.equal(observation.embeddable, false, value)
      assert.equal(observation.reachable, true, value)
    }
  })

  it('honours a restrictive CSP frame-ancestors', async () => {
    const blocked = await probePage('https://demo.example.com/', async () => reply(null, { headers: { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" } }))
    assert.equal(blocked.embeddable, false)
    assert.equal(blocked.cspFrameAncestors, "'none'")
    const open = await probePage('https://demo.example.com/', async () => reply(null, { headers: { 'content-security-policy': 'frame-ancestors *' } }))
    assert.equal(open.embeddable, true)
  })

  it('records an unreachable page', async () => {
    const observation = await probePage('https://demo.example.com/', async () => reply(null, { status: 502 }))
    assert.equal(observation.reachable, false)
    assert.equal(observation.embeddable, false)
    assert.match(observation.error, /HTTP 502/)
  })
})

describe('buildEntries', () => {
  const repo = { url: REPO_URL, stars: 42, syncedAt: '2026-11-17T00:00:00.000Z' }

  it('writes the repository snapshot and the observed embeddability', async () => {
    const entries = parseManifest(await readFixture('manifest-valid.json'), { file: 'm.json', repoUrl: REPO_URL, baseManifestUrl: MANIFEST_URL })
    const file = buildEntries(repo, entries, {
      images: {},
      pages: { 'https://ftshare-etf-flow.zippymarshmallow.chatgpt.site/': { reachable: true, embeddable: true, status: 200 } },
    })
    assert.equal(file.source, 'github')
    assert.equal(file.repo, REPO_URL)
    assert.equal(file.stars, 42)
    assert.equal(file.syncedAt, '2026-11-17T00:00:00.000Z')
    const [web, plugin] = file.entries
    assert.equal(web.embeddable, true)
    assert.equal(plugin.embeddable, undefined, 'only a web entry carries embeddable')
  })

  it('defaults embeddable to false and keeps assets when nothing was probed', async () => {
    const entries = parseManifest(await readFixture('manifest-valid.json'), { file: 'm.json', repoUrl: REPO_URL, baseManifestUrl: MANIFEST_URL })
    const file = buildEntries(repo, entries, { images: {}, pages: {} })
    assert.equal(file.entries[0].embeddable, false)
    assert.ok(file.entries[0].cover !== undefined, 'an unprobed cover survives')
  })

  it('drops an image that failed its probe and says why', async () => {
    const entries = parseManifest(await readFixture('manifest-valid.json'), { file: 'm.json', repoUrl: REPO_URL, baseManifestUrl: MANIFEST_URL })
    const warnings = []
    const cover = entries[0].cover
    const shot = entries[0].screenshots[0].src
    const file = buildEntries(repo, entries, {
      images: {
        [cover]: { ok: false, error: 'content-type text/html' },
        [shot]: { ok: true, contentType: 'image/png' },
      },
      pages: { 'https://ftshare-etf-flow.zippymarshmallow.chatgpt.site/': { reachable: false, embeddable: false, status: 0, error: 'getaddrinfo ENOTFOUND' } },
      warn: message => warnings.push(message),
    })
    assert.equal(file.entries[0].cover, undefined)
    assert.equal(file.entries[0].screenshots.length, 1)
    assert.equal(file.entries[0].embeddable, false)
    assert.ok(warnings.some(message => message.includes('dropping cover')), warnings.join('\n'))
    assert.ok(warnings.some(message => message.includes('unreachable')), warnings.join('\n'))
  })

  it('warns about an oversized image but keeps it', () => {
    const entry = webEntry({ cover: 'https://cdn.example.com/cover.png' })
    const warnings = []
    const file = buildEntries(repo, [entry], {
      images: { [entry.cover]: { ok: true, contentType: 'image/png', size: 2 * 1024 * 1024 } },
      pages: {},
      warn: message => warnings.push(message),
    })
    assert.ok(file.entries[0].cover !== undefined)
    assert.ok(warnings.some(message => message.includes('2.0 MB')), warnings.join('\n'))
  })
})

describe('parseEntriesFile / checkEntries', () => {
  it('parses one real synced file', async () => {
    const text = await readFixture('entries-valid/FTShare-Lab__FtShare_fincase.json')
    const record = parseEntriesFile(text, { file: 'FTShare-Lab__FtShare_fincase.json' })
    assert.equal(record.source, 'github')
    assert.equal(record.stars, 35)
    assert.deepEqual(record.entries.map(entry => entry.id), ['ftshare.etf-flow'])
  })

  it('rejects a file without the repository snapshot', () => {
    const text = JSON.stringify({ source: 'github', repo: REPO_URL, syncedAt: '2026-11-17T00:00:00.000Z', entries: [webEntry()] })
    assert.throws(() => parseEntriesFile(text, { file: 'x.json' }), /stars must be a non-negative integer/)
    assert.throws(() => parseEntriesFile('{"entries":[]}', { file: 'x.json' }), /source must be "github"/)
  })

  it('accepts the valid fixtures and reads both bodies', async () => {
    const read = await readEntriesDir(resolve(fixtures, 'entries-valid'))
    assert.equal(read.files.length, 2)
    assert.deepEqual([...read.ids].sort(), ['ft.plot', 'ftshare.etf-flow'])
  })

  it('collects every problem in an invalid directory', async () => {
    const report = await checkEntries(resolve(fixtures, 'entries-invalid'))
    assert.equal(report.ok, false)
    assert.ok(report.errors.some(message => /duplicate entry id: ft\.plot/.test(message)), report.errors.join('\n'))
    assert.ok(report.errors.some(message => /broken\.json: invalid JSON/.test(message)), report.errors.join('\n'))
  })

  it('passes the committed gallery/entries directory', async () => {
    const report = await checkEntries(resolve(packageRoot, 'gallery/entries'))
    assert.deepEqual(report.errors, [])
    assert.equal(report.ok, true)
    assert.equal(report.entries, 2)
  })
})

describe('parseArgs', () => {
  it('defaults to a full online sync with GITHUB_TOKEN', () => {
    assert.deepEqual(parseArgs([]), { check: false, offline: false, dryRun: false, tokenEnv: 'GITHUB_TOKEN', help: false })
  })

  it('reads every flag, including --token', () => {
    assert.deepEqual(parseArgs(['--check', '--offline', '--dry-run', '--token', 'GH_PAT']), {
      check: true, offline: true, dryRun: true, tokenEnv: 'GH_PAT', help: false,
    })
    assert.equal(parseArgs(['--token=GH_PAT']).tokenEnv, 'GH_PAT')
  })

  it('rejects unknown or incomplete arguments', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown argument/)
    assert.throws(() => parseArgs(['--token']), /--token needs the name/)
    assert.throws(() => parseArgs(['--token=']), /--token needs the name/)
  })
})

describe('searchRepositories', () => {
  const item = (owner, name, stars) => ({
    owner: { login: owner },
    name,
    default_branch: 'main',
    html_url: `https://github.com/${owner}/${name}`,
    stargazers_count: stars,
  })

  it('pages through the topic search and maps the fields the sync needs', async () => {
    const urls = []
    const repositories = await searchRepositories({
      perPage: 2,
      fetchImpl: async url => {
        urls.push(url)
        const page = Number(new URL(url).searchParams.get('page'))
        return reply(JSON.stringify({ total_count: 3, items: page === 1 ? [item('a', 'one', 1), item('b', 'two', 2)] : [item('c', 'three', 3)] }))
      },
    })
    assert.equal(urls.length, 2)
    assert.match(urls[0], new RegExp(`^${SEARCH_URL.replace('?', '\\?')}\\?q=topic%3Adsh-ft-gallery`))
    assert.deepEqual(repositories, [
      { owner: 'a', name: 'one', branch: 'main', url: 'https://github.com/a/one', stars: 1 },
      { owner: 'b', name: 'two', branch: 'main', url: 'https://github.com/b/two', stars: 2 },
      { owner: 'c', name: 'three', branch: 'main', url: 'https://github.com/c/three', stars: 3 },
    ])
  })

  it('sends the token and survives a rate limit with a warning', async () => {
    const warnings = []
    const headers = []
    const repositories = await searchRepositories({
      token: 'secret',
      warn: message => warnings.push(message),
      fetchImpl: async (url, init) => {
        headers.push(init.headers)
        return reply('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } })
      },
    })
    assert.deepEqual(repositories, [])
    assert.equal(headers[0].authorization, 'Bearer secret')
    assert.ok(warnings.some(message => /rate limited/.test(message)), warnings.join('\n'))
  })

  it('fails only when the search itself cannot be read', async () => {
    await assert.rejects(
      () => searchRepositories({ fetchImpl: async () => reply('{}', { status: 500 }) }),
      /GitHub search answered HTTP 500/,
    )
  })
})

describe('syncFromGitHub', () => {
  const REPOSITORY = {
    owner: { login: 'Example-Lab' },
    name: 'dsh-ft-demo',
    default_branch: 'main',
    html_url: REPO_URL,
    stargazers_count: 7,
  }

  /** Fetch that answers the topic search and the raw manifest only. */
  function offlineFetch({ manifest } = {}) {
    const calls = []
    const fetchImpl = async (url, init = {}) => {
      calls.push(url)
      if (url.startsWith(SEARCH_URL)) return reply(JSON.stringify({ total_count: 1, items: [REPOSITORY] }))
      if (url === manifestUrl({ owner: 'Example-Lab', name: 'dsh-ft-demo', branch: 'main' })) {
        if (manifest === null) return reply('not found', { status: 404 })
        return reply(manifest ?? JSON.stringify({ entries: [webEntry()] }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    }
    return { fetchImpl, calls }
  }

  it('writes one entries file per repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ftg-sync-'))
    const { fetchImpl } = offlineFetch()
    const summary = await syncFromGitHub({ offline: true, tokenEnv: undefined }, {
      entriesDir: dir,
      fetchImpl,
      now: () => new Date('2026-11-17T00:00:00.000Z'),
      log: () => {},
      warn: () => {},
    })
    assert.deepEqual(summary, { written: 1, skipped: 0, failed: 0, dryRun: false })
    const names = await readdir(dir)
    assert.deepEqual(names, ['Example-Lab__dsh-ft-demo.json'])
    const written = JSON.parse(await readFile(join(dir, names[0]), 'utf8'))
    assert.equal(written.source, 'github')
    assert.equal(written.repo, REPO_URL)
    assert.equal(written.stars, 7)
    assert.equal(written.syncedAt, '2026-11-17T00:00:00.000Z')
    assert.equal(written.entries[0].embeddable, false)
    assert.equal(written.entries[0].id, 'demo.web')
  })

  it('writes nothing on --dry-run but still reports it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ftg-sync-dry-'))
    const summary = await syncFromGitHub({ offline: true, dryRun: true, tokenEnv: undefined }, {
      entriesDir: dir,
      fetchImpl: offlineFetch().fetchImpl,
      log: () => {},
      warn: () => {},
    })
    assert.equal(summary.written, 1)
    assert.deepEqual(await readdir(dir), [])
  })

  it('warns and continues past a repository without a manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ftg-sync-404-'))
    const warnings = []
    const summary = await syncFromGitHub({ offline: true, tokenEnv: undefined }, {
      entriesDir: dir,
      fetchImpl: offlineFetch({ manifest: null }).fetchImpl,
      log: () => {},
      warn: message => warnings.push(message),
    })
    assert.equal(summary.skipped, 1)
    assert.equal(summary.written, 0)
    assert.ok(warnings.some(message => /no dsh-ft-gallery\.json/.test(message)), warnings.join('\n'))
  })

  it('warns and continues past an invalid manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ftg-sync-bad-'))
    const warnings = []
    const summary = await syncFromGitHub({ offline: true, tokenEnv: undefined }, {
      entriesDir: dir,
      fetchImpl: offlineFetch({ manifest: '{"entries":[]}' }).fetchImpl,
      log: () => {},
      warn: message => warnings.push(message),
    })
    assert.equal(summary.failed, 1)
    assert.equal(summary.written, 0)
    assert.ok(warnings.some(message => /entries must be a non-empty array/.test(message)), warnings.join('\n'))
  })

  it('names the output file and the manifest URL from the repository', () => {
    const repository = { owner: 'FTShare-Lab', name: 'FtShare_fincase', branch: 'main' }
    assert.equal(entriesFileName(repository), 'FTShare-Lab__FtShare_fincase.json')
    assert.equal(manifestUrl(repository), 'https://raw.githubusercontent.com/FTShare-Lab/FtShare_fincase/main/dsh-ft-gallery.json')
  })
})

describe('gallery-sync CLI', () => {
  it('--check validates the committed entries and exits 0', async () => {
    const { stdout } = await run(process.execPath, ['scripts/gallery-sync.mjs', '--check'], { cwd: packageRoot })
    assert.match(stdout, /checked 2 file\(s\), 2 entry\(ies\)/)
  })

  it('exits 1 on an unknown argument', async () => {
    await assert.rejects(
      () => run(process.execPath, ['scripts/gallery-sync.mjs', '--nope'], { cwd: packageRoot }),
      error => error.code === 1 && /unknown argument/.test(error.stderr),
    )
  })

  it('declares the categories the catalog publishes', () => {
    assert.deepEqual(Object.keys(CATEGORIES), ['market', 'research', 'chart', 'tool', 'panel'])
    for (const names of Object.values(CATEGORIES)) {
      assert.equal(typeof names.zh, 'string')
      assert.equal(typeof names.en, 'string')
    }
  })
})
