/**
 * Host entry for the FT gallery.
 *
 * Two routes, no state machine:
 *   GET  /api/ft-gallery/catalog  the merged catalog: the bundled baseline plus
 *                                 the remotely synced one (`?refresh=1` bypasses
 *                                 the cache TTL), failing back to the last good
 *                                 copy and then to the bundled file;
 *   GET  /api/ft-gallery/state    the user's shelf: favorites plus the personal
 *                                 launchers (bookmarked URLs and local pages);
 *   POST /api/ft-gallery/state    one mutation: favorite/unfavorite, or one of
 *                                 add/update/remove for a link or a page.
 *
 * The shelf lives in a file rather than in browser storage on purpose: the
 * desktop app serves the UI from a new port on every start, so a localStorage
 * origin does not survive a restart.
 *
 * Everything is dependency-injected, so the routes are testable without a host:
 * a test hands in its own fetch, clock and directories.
 * @module @dsh-ft/dsh-fft-gallery
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

/** Package name the Loader shows. */
export const name = '@dsh-ft/dsh-fft-gallery'

/** The catalog route the browser half reads. */
export const CATALOG_ROUTE = '/api/ft-gallery/catalog'

/** The shelf route the browser half reads and writes. */
export const STATE_ROUTE = '/api/ft-gallery/state'

/** Bundled catalog, resolved relative to this module (lib/ or src/). */
const CATALOG_FILE = new URL('../gallery/catalog.json', import.meta.url)

/**
 * The synced catalog lives on a branch of this repository. Two addresses serve
 * the same file: jsDelivr's GitHub endpoint (not the blockable raw host) first,
 * then raw itself for networks where the CDN is the unreachable one.
 */
const CATALOG_REPO = 'FTShare-Lab/dsh-plugin-fft-bundle'
const CATALOG_BRANCH = 'catalog'
const CATALOG_PATH = 'gallery/catalog.json'
const DEFAULT_REMOTE_CATALOG = `https://cdn.jsdelivr.net/gh/${CATALOG_REPO}@${CATALOG_BRANCH}/${CATALOG_PATH}`
const RAW_REMOTE_CATALOG = `https://raw.githubusercontent.com/${CATALOG_REPO}/${CATALOG_BRANCH}/${CATALOG_PATH}`

/**
 * Where the synced catalog may live, most reliable first. A source that answers
 * 404 is "not published yet"; the first source that answers a document wins.
 */
const DEFAULT_SOURCES = [DEFAULT_REMOTE_CATALOG, RAW_REMOTE_CATALOG]

/** How long a fetched catalog is trusted before another read. */
const DEFAULT_TTL_MS = 60 * 60 * 1000

/** How long one remote read may take before the bundled baseline answers. */
const DEFAULT_FETCH_TIMEOUT_MS = 8_000

/** JSON response helper. */
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** The DSH home this process uses; the shelf lives under it. */
export function dshHome() {
  const configured = process.env.DSH_HOME?.trim()
  return configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured
}

/** Absolute path of the shelf file. */
export function defaultStateFile() {
  return join(dshHome(), '.dsh-fft-gallery', 'state.json')
}

/** Absolute path of the remote catalog cache. */
export function defaultCacheFile() {
  return join(dshHome(), '.dsh-fft-gallery', 'cache', 'catalog.json')
}

/** Read and parse the bundled catalog. */
export async function readBundledCatalog() {
  const text = await readFile(CATALOG_FILE, 'utf8')
  const catalog = JSON.parse(text)
  assertCatalog(catalog, 'bundled catalog')
  return catalog
}

/** Fail early on a document this code cannot render. */
export function assertCatalog(catalog, label) {
  if (catalog === null || typeof catalog !== 'object') throw new Error(`${label} is not an object`)
  if (catalog.format !== 2) throw new Error(`${label} has unsupported format: ${String(catalog.format)}`)
  if (!Array.isArray(catalog.entries)) throw new Error(`${label} has no entries array`)
  for (const entry of catalog.entries) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') {
      throw new Error(`${label} has an entry without an id`)
    }
  }
}

/**
 * Merge the bundled baseline with the synced catalog: one entry per id, the
 * synced one winning, bundled-only entries retained so an offline install still
 * shows something.
 * @param bundled - the catalog shipped in this package.
 * @param remote - the catalog the daily sync published.
 * @returns one catalog document.
 */
export function mergeCatalogs(bundled, remote) {
  const byId = new Map()
  for (const entry of bundled.entries ?? []) byId.set(entry.id, entry)
  for (const entry of remote.entries ?? []) byId.set(entry.id, entry)
  return {
    format: 2,
    generatedAt: remote.generatedAt ?? bundled.generatedAt,
    categories: { ...bundled.categories, ...remote.categories },
    entries: [...byId.values()].sort((left, right) => {
      const order = (left.order ?? 100) - (right.order ?? 100)
      if (order !== 0) return order
      // Code point, not locale: the order must be identical on every machine.
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    }),
  }
}

/** Read JSON from a file, or fall back to a default. */
async function readJsonOr(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Write JSON through a temporary file, so a crash never leaves half a document. */
async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, file)
}

/**
 * One source, one attempt. Throws with `.status` when the source answered one.
 * @param source - an HTTPS URL to a format-2 catalog.
 * @returns the catalog, or `{ notModified: true }` when an ETag still matches.
 */
async function readSource(source, { fetchImpl, timeoutMs, etag }) {
  const headers = { accept: 'application/json' }
  if (etag !== undefined) headers['if-none-match'] = etag
  const response = await fetchImpl(source, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (response.status === 304) return { notModified: true }
  if (!response.ok) {
    const failure = new Error(`catalog source answered HTTP ${response.status}`)
    failure.status = response.status
    throw failure
  }
  const catalog = JSON.parse(await response.text())
  assertCatalog(catalog, 'remote catalog')
  return { catalog, etag: response.headers?.get?.('etag') ?? undefined }
}

/**
 * Route that answers with the merged catalog.
 *
 * @param options - injected collaborators; every one has a production default.
 * @returns the route the host connection registry accepts.
 */
export function createCatalogRoute(options = {}) {
  const {
    readBundled = readBundledCatalog,
    fetchRemote = (...args) => globalThis.fetch(...args),
    remoteUrl = process.env.DSH_FT_GALLERY_CATALOG_URL?.trim() || '',
    sources: sourcesOption,
    cacheFile = defaultCacheFile(),
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    now = () => Date.now(),
  } = options
  // A test or an operator names one URL, or an explicit list; production walks
  // the defaults. The older single-URL variable keeps working for one source.
  const configured = process.env.DSH_FT_GALLERY_CATALOG_SOURCES?.trim() || ''
  const sources = Array.isArray(sourcesOption)
    ? sourcesOption
    : typeof sourcesOption === 'string' && sourcesOption !== ''
      ? [sourcesOption]
      : configured !== ''
        ? configured.split(',').map(source => source.trim()).filter(source => source !== '')
        : remoteUrl !== ''
          ? [remoteUrl]
          : DEFAULT_SOURCES

  /** Last good synced catalog, with the source and tag it was fetched under. */
  async function readCache() {
    const cached = await readJsonOr(cacheFile, undefined)
    return cached !== null && typeof cached === 'object' && cached.catalog !== undefined ? cached : undefined
  }

  /**
   * One synced read, honouring the TTL and the ETag. Sources are tried in
   * order; the first document that arrives wins and is cached. Nothing
   * answering leaves the cached copy, then the bundled baseline.
   */
  async function readRemote({ refresh }) {
    const cached = await readCache()
    if (!refresh && cached !== undefined && now() - cached.fetchedAt < ttlMs) {
      return { catalog: cached.catalog, cached: true, source: cached.source }
    }
    const failures = []
    for (const source of sources) {
      try {
        const result = await readSource(source, {
          fetchImpl: fetchRemote,
          timeoutMs,
          etag: cached?.source === source ? cached.etag : undefined,
        })
        if (result.notModified === true && cached !== undefined) {
          return { catalog: cached.catalog, cached: true, source }
        }
        if (result.catalog === undefined) continue
        await writeJsonAtomic(cacheFile, {
          etag: result.etag,
          source,
          fetchedAt: now(),
          catalog: result.catalog,
        })
        return { catalog: result.catalog, cached: false, source }
      } catch (error) {
        failures.push({
          source,
          status: error?.status,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (cached !== undefined) return { catalog: cached.catalog, cached: true, stale: true, source: cached.source }
    // Every source saying "no such document" is the expected state before the
    // first sync publishes anything: the bundled baseline is the whole catalog.
    if (failures.length > 0 && failures.every(failure => failure.status === 404)) {
      return { notPublished: true }
    }
    throw new Error(failures.map(failure => `${failure.source}: ${failure.message}`).join('; '))
  }

  return {
    path: CATALOG_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'GET') {
        return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET' } })
      }
      const url = new URL(request.url)
      const refresh = url.searchParams.get('refresh') === '1'
      let bundled
      try {
        bundled = await readBundled()
      } catch (error) {
        return json(200, {
          ok: false,
          error: { code: 'CATALOG_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) },
        })
      }
      let remote
      let warning
      try {
        remote = await readRemote({ refresh })
      } catch (error) {
        warning = error instanceof Error ? error.message : String(error)
      }
      const catalog = remote?.catalog === undefined ? bundled : mergeCatalogs(bundled, remote.catalog)
      return json(200, {
        ok: true,
        catalog: {
          ...catalog,
          meta: {
            remote: remote?.catalog === undefined ? 'unavailable' : remote.cached ? 'cached' : 'fresh',
            stale: remote?.stale === true,
            ...remote?.source === undefined ? {} : { source: remote.source },
            ...remote?.notPublished === true ? { notPublished: true } : {},
            ...warning === undefined ? {} : { warning },
          },
        },
      })
    },
  }
}

/** The default shelf document: favorites plus the personal launchers. */
function emptyState() {
  return { version: 2, favorites: {}, links: [], pages: [], updatedAt: new Date(0).toISOString() }
}

/** A request the user can fix; answers 400 instead of a generic write failure. */
class ShelfError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

const MAX_TITLE = 80
const MAX_URL = 2048
const MAX_PATH = 1024

/** Bring a stored document to the current shape without dropping unknown fields. */
export function migrateState(input) {
  const state = input !== null && typeof input === 'object' ? input : {}
  const favorites = state.favorites !== null && typeof state.favorites === 'object' && !Array.isArray(state.favorites) ? state.favorites : {}
  return {
    ...state,
    version: 2,
    favorites,
    links: Array.isArray(state.links) ? state.links.filter(isLinkRow) : [],
    pages: Array.isArray(state.pages) ? state.pages.filter(isPageRow) : [],
  }
}

/** Whether a stored row is a link this code can render. */
function isLinkRow(row) {
  return row !== null && typeof row === 'object'
    && typeof row.id === 'string'
    && typeof row.url === 'string'
    && (row.title === undefined || typeof row.title === 'string')
    && typeof row.at === 'string'
}

/** Whether a stored row is a local page this code can render. */
function isPageRow(row) {
  return row !== null && typeof row === 'object'
    && typeof row.id === 'string'
    && typeof row.path === 'string'
    && (row.title === undefined || typeof row.title === 'string')
    && typeof row.at === 'string'
}

/** A display title: the caller's text, or the row's own fallback. */
function shelfTitle(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return fallback
  if ([...text].length > MAX_TITLE) throw new ShelfError(`标题不能超过 ${MAX_TITLE} 字`)
  return text
}

/** One http(s) URL, normalized; protocol is the only scheme a browser tab accepts. */
function shelfUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new ShelfError('需要填写网址')
  const text = value.trim()
  if (text.length > MAX_URL) throw new ShelfError('网址过长')
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new ShelfError('网址格式不正确')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ShelfError('只支持 http/https 网址')
  return parsed.href
}

/** The hostname a link falls back to when the user gives no title. */
function linkTitleFrom(url) {
  try {
    return new URL(url).hostname
  } catch {
    return '未命名网址'
  }
}

/** One absolute path to a static HTML file. */
function shelfPath(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new ShelfError('需要填写本地文件路径')
  const text = value.trim().replace(/\\/g, '/')
  if (text.length > MAX_PATH) throw new ShelfError('路径过长')
  if (!isAbsolute(text)) throw new ShelfError('本地页面需要绝对路径')
  if (!/\.html?$/iu.test(text)) throw new ShelfError('只支持 .html / .htm 文件')
  return text
}

/** One row id, namespaced so a link and a page can never collide. */
function newRowId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/gu, '').slice(0, 12)}`
}

/** Read a row list and replace it; removing an unknown id is an error, not a no-op. */
function replaceRow(rows, id) {
  const index = rows.findIndex(row => row.id === id)
  if (index === -1) throw new ShelfError('条目不存在')
  return index
}

/**
 * Route that answers with, and mutates, the user's shelf.
 *
 * Mutations are serialized through one chain so two clicks cannot interleave
 * reads and writes; each write goes through a temporary file. Local pages are
 * validated against the filesystem here — the browser half never reads them.
 * @param options - injected collaborators.
 * @returns the route the host connection registry accepts.
 */
export function createStateRoute(options = {}) {
  const {
    stateFile = defaultStateFile(),
    now = () => new Date().toISOString(),
    statFile = async path => stat(path),
  } = options
  let queue = Promise.resolve()

  const read = async () => migrateState(await readJsonOr(stateFile, emptyState()))
  const write = async (state) => {
    await writeJsonAtomic(stateFile, state)
    return state
  }

  /** Apply one validated mutation to a migrated state; throws ShelfError for user errors. */
  async function mutate(state, body, at) {
    const op = typeof body?.op === 'string' ? body.op : ''
    const id = typeof body?.id === 'string' ? body.id : ''
    if (op === 'favorite' || op === 'unfavorite') {
      if (id === '') throw new ShelfError('需要条目标识')
      const favorites = { ...state.favorites }
      if (op === 'favorite') favorites[id] = { at }
      else delete favorites[id]
      return { ...state, favorites }
    }
    if (op === 'add-link') {
      const url = shelfUrl(body?.url)
      const title = shelfTitle(body?.title, linkTitleFrom(url))
      return { ...state, links: [...state.links, { id: newRowId('link'), title, url, at }] }
    }
    if (op === 'update-link') {
      const index = replaceRow(state.links, id)
      const row = state.links[index]
      const url = body?.url === undefined ? row.url : shelfUrl(body.url)
      const title = body?.title === undefined ? row.title : shelfTitle(body.title, linkTitleFrom(url))
      const links = [...state.links]
      links[index] = { ...row, title, url }
      return { ...state, links }
    }
    if (op === 'remove-link') {
      const index = replaceRow(state.links, id)
      const links = [...state.links]
      links.splice(index, 1)
      return { ...state, links }
    }
    if (op === 'add-page') {
      const path = shelfPath(body?.path)
      const title = shelfTitle(body?.title, basename(path))
      await requireFile(path, statFile)
      return { ...state, pages: [...state.pages, { id: newRowId('page'), title, path, at }] }
    }
    if (op === 'update-page') {
      const index = replaceRow(state.pages, id)
      const row = state.pages[index]
      const path = body?.path === undefined ? row.path : shelfPath(body.path)
      const title = body?.title === undefined ? row.title : shelfTitle(body.title, basename(path))
      if (path !== row.path) await requireFile(path, statFile)
      const pages = [...state.pages]
      pages[index] = { ...row, title, path }
      return { ...state, pages }
    }
    if (op === 'remove-page') {
      const index = replaceRow(state.pages, id)
      const pages = [...state.pages]
      pages.splice(index, 1)
      return { ...state, pages }
    }
    throw new ShelfError('未知操作')
  }

  return {
    path: STATE_ROUTE,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'GET') {
        return json(200, { ok: true, state: await read() })
      }
      if (request.method !== 'POST') {
        return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET / POST' } })
      }
      let body
      try {
        body = JSON.parse(await request.text())
      } catch {
        return json(400, { ok: false, error: { code: 'BAD_BODY', message: '请求体不是 JSON' } })
      }
      const run = queue.then(async () => {
        const state = await read()
        const next = await mutate(state, body, now())
        return write({ ...next, version: 2, updatedAt: now() })
      })
      queue = run.catch(() => {})
      try {
        return json(200, { ok: true, state: await run })
      } catch (error) {
        if (error instanceof ShelfError) {
          return json(400, { ok: false, error: { code: 'BAD_REQUEST', message: error.message } })
        }
        return json(200, {
          ok: false,
          error: { code: 'STATE_WRITE_FAILED', message: error instanceof Error ? error.message : String(error) },
        })
      }
    },
  }
}

/** Refuse a path that is not an existing regular file; the browser never reads it. */
async function requireFile(path, statFile) {
  let info
  try {
    info = await statFile(path)
  } catch {
    throw new ShelfError('文件不存在或不可读')
  }
  if (info === undefined || typeof info.isFile !== 'function' || !info.isFile()) throw new ShelfError('路径不是文件')
}

/**
 * Attach both routes.
 *
 * The route appears with `connection`; a profile without that service has no
 * gallery routes instead of a failing plugin row.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection')
    if (connection === undefined || typeof connection.fetch?.register !== 'function') return
    scope.effect(
      () => connection.fetch.register(createCatalogRoute()),
      'dsh-fft-gallery: catalog route',
    )
    scope.effect(
      () => connection.fetch.register(createStateRoute()),
      'dsh-fft-gallery: state route',
    )
  })
}
