/**
 * The gallery's entry schema and its GitHub discovery channel.
 *
 * An author publishes a repository manifest `dsh-ft-gallery.json` and tags the
 * repository with the topic `dsh-ft-gallery`; the daily sync reads both, checks
 * every declared entry, and writes one file per repository under
 * `gallery/entries/`. Nothing here installs or vets an author's code: the only
 * promises are shape (this file), HTTPS, and reachability.
 *
 * The module is two layers. The pure functions (`parseManifest`,
 * `validateEntry`, `resolveAsset`, `buildEntries`, the probes) take their
 * inputs and return their outputs; the CLI at the bottom injects the network,
 * the clock and the directory. Tests use only the first layer, so they never
 * touch the network.
 *
 * Run: `node scripts/gallery-sync.mjs [--check] [--offline] [--dry-run] [--token ENV]`
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** GitHub topic an author tags the repository with. */
export const TOPIC = 'dsh-ft-gallery'

/** Manifest file at the root of the author's repository. */
export const MANIFEST_FILE = 'dsh-ft-gallery.json'

/** GitHub search endpoint the topic scan starts from. */
export const SEARCH_URL = 'https://api.github.com/search/repositories'

/** Raw file host the manifest and its relative assets resolve against. */
export const RAW_BASE = 'https://raw.githubusercontent.com'

/** Catalog categories; the ids are the only values an entry may name. */
export const CATEGORIES = Object.freeze({
  market: Object.freeze({ zh: '行情', en: 'Market data' }),
  research: Object.freeze({ zh: '研究', en: 'Research' }),
  chart: Object.freeze({ zh: '图表', en: 'Charts' }),
  tool: Object.freeze({ zh: '工具', en: 'Tools' }),
  panel: Object.freeze({ zh: '面板', en: 'Panels' }),
})

/** Entry id grammar: the build fails rather than render an id nobody can link. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/

/** Order an entry without an explicit `order` sorts at. */
export const DEFAULT_ORDER = 100

/** One image larger than this only warns; the entry stays. */
export const IMAGE_SIZE_HINT = 1024 * 1024

const KINDS = new Set(['web', 'plugin'])
const CATEGORY_IDS = new Set(Object.keys(CATEGORIES))
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const SUMMARY_MAX = 80
const DETAILS_MAX = 800
const MAX_SCREENSHOTS = 4
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const RANGE = /^[0-9A-Za-z.*+<>=~^|\s-]+$/
const COMMIT = /^[0-9a-f]{40}$/
const SVG = /\.svg$/i

/** Every field an entry may carry after sync; nothing else survives validation. */
const ENTRY_FIELDS = new Set([
  'id', 'kind', 'title', 'summary', 'details', 'cover', 'screenshots', 'url',
  'spec', 'open', 'category', 'order', 'homepage', 'author', 'engines', 'embeddable',
])

/** Fields an author may declare; `embeddable` is observed by the sync, not declared. */
const MANIFEST_FIELDS = new Set([...ENTRY_FIELDS].filter(field => field !== 'embeddable'))

/** Top-level fields of one file under `gallery/entries/`. */
const CONTAINER_FIELDS = new Set(['source', 'repo', 'owner', 'stars', 'syncedAt', 'entries'])

/** One validation failure; the CLI catches it per repository and moves on. */
export class GalleryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GalleryError'
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Count characters the way a reader would, not UTF-16 code units. */
const characters = value => [...value].length

/** A non-empty trimmed string, or a validation failure named by `label`. */
function text(fail, value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`)
  return value.trim()
}

/**
 * An HTTPS URL, normalized. Credentials are refused: this package only ever
 * links, never authenticates, and a URL with a password would leak into the
 * published catalog.
 */
function httpsUrl(fail, value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty https URL`)
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    fail(`${label} is not a URL: ${value}`)
  }
  if (parsed.protocol !== 'https:') fail(`${label} must use https: ${value}`)
  if (parsed.username !== '' || parsed.password !== '') fail(`${label} must not embed credentials`)
  return parsed.href
}

/**
 * An HTTPS image URL. SVG is refused: the shelf renders `<img>` only, and the
 * spec bans it outright (an SVG can carry script).
 */
function imageUrl(fail, value, label) {
  const href = httpsUrl(fail, value, label)
  if (SVG.test(new URL(href).pathname)) fail(`${label} must be png, jpeg or webp (svg is not allowed)`)
  return href
}

/** A localized `{ zh, en }` field, both languages required. */
function localized(fail, value, label, max) {
  if (!isObject(value)) fail(`${label} must be a { zh, en } object`)
  const unknown = Object.keys(value).filter(key => key !== 'zh' && key !== 'en')
  if (unknown.length > 0) fail(`${label} has unknown language(s): ${unknown.join(', ')}`)
  const normalized = {}
  for (const locale of ['zh', 'en']) {
    const rendered = text(fail, value[locale], `${label}.${locale}`)
    if (max !== undefined && characters(rendered) > max) fail(`${label}.${locale} is longer than ${max} characters`)
    normalized[locale] = rendered
  }
  return normalized
}

/** An optional field: `undefined` stays absent, anything else must validate. */
function optional(fail, value, label, normalize) {
  return value === undefined ? undefined : normalize(fail, value, label)
}

/** The install source of a plugin entry. */
function normalizeSpec(fail, spec) {
  if (!isObject(spec)) fail('spec must be an object')
  if (spec.type === 'npm') {
    const unknown = Object.keys(spec).filter(key => !['type', 'name', 'version'].includes(key))
    if (unknown.length > 0) fail(`spec has unknown field(s): ${unknown.join(', ')}`)
    if (typeof spec.name !== 'string' || !NPM_NAME.test(spec.name)) fail('spec.name must be a package name')
    if (typeof spec.version !== 'string' || !SEMVER.test(spec.version)) fail('spec.version must be an exact SemVer version')
    return { type: 'npm', name: spec.name, version: spec.version }
  }
  if (spec.type === 'git') {
    const unknown = Object.keys(spec).filter(key => !['type', 'url', 'commit', 'path'].includes(key))
    if (unknown.length > 0) fail(`spec has unknown field(s): ${unknown.join(', ')}`)
    const url = httpsUrl(fail, spec.url, 'spec.url')
    if (typeof spec.commit !== 'string' || !COMMIT.test(spec.commit)) fail('spec.commit must be a 40-character hex commit')
    const record = { type: 'git', url, commit: spec.commit }
    if (spec.path !== undefined) {
      const path = text(fail, spec.path, 'spec.path')
      if (path.startsWith('/') || path.includes('..')) fail(`spec.path must be a repository-relative path: ${path}`)
      record.path = path
    }
    return record
  }
  fail('spec.type must be npm or git')
}

/** The optional surface a plugin entry opens: a sidebar tab kind or a main panel. */
function normalizeOpen(fail, open) {
  if (!isObject(open)) fail('open must be an object')
  const unknown = Object.keys(open).filter(key => key !== 'kind' && key !== 'panel')
  if (unknown.length > 0) fail(`open has unknown field(s): ${unknown.join(', ')}`)
  if (open.kind !== undefined && open.panel !== undefined) fail('open carries either kind or panel, not both')
  if (open.kind === undefined && open.panel === undefined) fail('open needs kind or panel')
  return open.kind === undefined
    ? { panel: text(fail, open.panel, 'open.panel') }
    : { kind: text(fail, open.kind, 'open.kind') }
}

/** An optional SemVer range; kept loose so a future range syntax is not rejected. */
function normalizeEngines(fail, engines) {
  if (!isObject(engines)) fail('engines must be an object')
  const unknown = Object.keys(engines).filter(key => key !== 'dsh')
  if (unknown.length > 0) fail(`engines has unknown field(s): ${unknown.join(', ')}`)
  if (engines.dsh === undefined) return undefined
  const range = text(fail, engines.dsh, 'engines.dsh')
  if (!RANGE.test(range) || !/[0-9*]/.test(range)) fail(`engines.dsh must be a SemVer range: ${range}`)
  return { dsh: range }
}

/**
 * Resolve an asset the author wrote relative to the manifest (or gave absolutely).
 *
 * @param baseManifestUrl - the URL the manifest was read from; its directory is
 *   the base of every relative asset.
 * @param src - what the manifest declared (e.g. `./assets/cover.png`).
 * @returns the absolute HTTPS URL.
 */
export function resolveAsset(baseManifestUrl, src) {
  if (typeof src !== 'string' || src.trim() === '') throw new GalleryError('asset src must be a non-empty string')
  const trimmed = src.trim()
  if (/^data:/i.test(trimmed)) throw new GalleryError(`asset must not use a data: URL: ${trimmed}`)
  let base
  try {
    base = new URL(baseManifestUrl)
  } catch {
    throw new GalleryError(`cannot resolve asset without the manifest URL: ${trimmed}`)
  }
  if (base.protocol !== 'https:') throw new GalleryError(`manifest URL must use https: ${baseManifestUrl}`)
  let parsed
  try {
    parsed = new URL(trimmed, base)
  } catch {
    throw new GalleryError(`asset is not a URL: ${trimmed}`)
  }
  if (parsed.protocol !== 'https:') throw new GalleryError(`asset must use https: ${trimmed}`)
  if (parsed.username !== '' || parsed.password !== '') throw new GalleryError(`asset must not embed credentials: ${trimmed}`)
  if (SVG.test(parsed.pathname)) throw new GalleryError(`asset must be png, jpeg or webp (svg is not allowed): ${trimmed}`)
  return parsed.href
}

/**
 * Validate one entry and return the normalized record that gets written.
 *
 * @param entry - the entry, with assets already absolute.
 * @param options.knownIds - ids already taken; a duplicate fails and a valid id
 *   is added, so callers can validate a whole batch with one set.
 * @param options.file - label used in error messages.
 */
export function validateEntry(entry, { knownIds, file } = {}) {
  if (!isObject(entry)) {
    throw new GalleryError(`${file === undefined ? 'entry' : file}: entry must be an object`)
  }
  const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : '(missing id)'
  const scope = file === undefined ? `entry ${id}` : `${file}: entry ${id}`
  const fail = message => { throw new GalleryError(`${scope}: ${message}`) }

  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
    fail('id must match /^[a-z0-9][a-z0-9._-]{1,63}$/')
  }
  const unknown = Object.keys(entry).filter(key => !ENTRY_FIELDS.has(key))
  if (unknown.length > 0) fail(`unknown field(s): ${unknown.join(', ')}`)
  if (knownIds !== undefined && knownIds.has(entry.id)) fail(`duplicate entry id: ${entry.id}`)
  if (!KINDS.has(entry.kind)) fail('kind must be web or plugin')
  if (entry.category !== undefined && !CATEGORY_IDS.has(entry.category)) {
    fail(`category must be one of ${[...CATEGORY_IDS].join(', ')} when present`)
  }
  if (entry.order !== undefined && (!Number.isInteger(entry.order) || entry.order < 0)) {
    fail('order must be a non-negative integer')
  }
  if (entry.embeddable !== undefined && typeof entry.embeddable !== 'boolean') fail('embeddable must be a boolean')

  const record = {
    id: entry.id,
    kind: entry.kind,
    ...entry.category === undefined ? {} : { category: entry.category },
    order: entry.order ?? DEFAULT_ORDER,
    title: localized(fail, entry.title, 'title'),
    summary: localized(fail, entry.summary, 'summary', SUMMARY_MAX),
  }
  const details = optional(fail, entry.details, 'details', (fail, value, label) => localized(fail, value, label, DETAILS_MAX))
  if (details !== undefined) record.details = details
  const cover = optional(fail, entry.cover, 'cover', imageUrl)
  if (cover !== undefined) record.cover = cover
  if (entry.screenshots !== undefined) {
    if (!Array.isArray(entry.screenshots)) fail('screenshots must be an array')
    if (entry.screenshots.length > MAX_SCREENSHOTS) fail(`screenshots allows at most ${MAX_SCREENSHOTS} images`)
    const screenshots = entry.screenshots.map((shot, index) => {
      if (!isObject(shot)) fail(`screenshots[${index}] must be an object`)
      const extra = Object.keys(shot).filter(key => key !== 'src' && key !== 'alt')
      if (extra.length > 0) fail(`screenshots[${index}] has unknown field(s): ${extra.join(', ')}`)
      return { src: imageUrl(fail, shot.src, `screenshots[${index}].src`), alt: localized(fail, shot.alt, `screenshots[${index}].alt`) }
    })
    if (screenshots.length > 0) record.screenshots = screenshots
  }
  if (entry.homepage !== undefined) record.homepage = httpsUrl(fail, entry.homepage, 'homepage')
  if (entry.author !== undefined) record.author = text(fail, entry.author, 'author')
  const engines = optional(fail, entry.engines, 'engines', normalizeEngines)
  if (engines !== undefined) record.engines = engines
  if (entry.embeddable !== undefined) record.embeddable = entry.embeddable

  if (entry.kind === 'web') {
    if (entry.spec !== undefined) fail('spec belongs to a plugin entry')
    if (entry.open !== undefined) fail('open belongs to a plugin entry')
    record.url = httpsUrl(fail, entry.url, 'url')
  } else {
    if (entry.url !== undefined) fail('url belongs to a web entry')
    record.spec = normalizeSpec(fail, entry.spec)
    const open = optional(fail, entry.open, 'open', normalizeOpen)
    if (open !== undefined) record.open = open
  }

  if (knownIds !== undefined) knownIds.add(entry.id)
  return record
}

/**
 * Parse and validate an author's repository manifest.
 *
 * Every entry is normalized and every relative asset is resolved against the
 * manifest's own URL, so a later probe sees the real HTTPS address.
 *
 * @param text - the manifest file.
 * @param options.file - label used in error messages.
 * @param options.repoUrl - repository page URL (kept for messages).
 * @param options.baseManifestUrl - URL the manifest was read from; relative
 *   assets resolve against it. Falls back to `repoUrl`.
 * @param options.knownIds - ids already taken by other repositories.
 * @returns the validated entries, in declaration order.
 */
export function parseManifest(text, { file = MANIFEST_FILE, repoUrl = '', baseManifestUrl, knownIds } = {}) {
  const base = baseManifestUrl ?? repoUrl
  const where = file === undefined ? MANIFEST_FILE : file
  const fail = message => { throw new GalleryError(`${where}: ${message}`) }

  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    fail(`invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!isObject(data)) fail('manifest must be a JSON object')
  const unknown = Object.keys(data).filter(key => key !== 'entries')
  if (unknown.length > 0) fail(`unknown top-level field(s): ${unknown.join(', ')}`)
  if (!Array.isArray(data.entries) || data.entries.length === 0) fail('entries must be a non-empty array')

  return data.entries.map((raw, index) => {
    if (!isObject(raw)) fail(`entry #${index + 1} must be an object`)
    const extra = Object.keys(raw).filter(key => !MANIFEST_FIELDS.has(key))
    if (extra.length > 0) fail(`entry #${index + 1} has unknown field(s): ${extra.join(', ')}`)
    const entry = { ...raw }
    if (raw.cover !== undefined) entry.cover = resolveAsset(base, raw.cover)
    if (Array.isArray(raw.screenshots)) {
      entry.screenshots = raw.screenshots.map((shot, shotIndex) => {
        if (!isObject(shot) || shot.src === undefined) return shot
        return { ...shot, src: resolveAsset(base, shot.src) }
      })
    }
    return validateEntry(entry, { file: where, knownIds })
  })
}

/**
 * One file under `gallery/entries/`: the repository-level snapshot plus its
 * entries.
 *
 * @param text - the file contents.
 * @param options.file - label used in error messages.
 */
export function parseEntriesFile(text, { file = 'entries.json' } = {}) {
  const fail = message => { throw new GalleryError(`${file}: ${message}`) }
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    fail(`invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!isObject(data)) fail('file must be a JSON object')
  const unknown = Object.keys(data).filter(key => !CONTAINER_FIELDS.has(key))
  if (unknown.length > 0) fail(`unknown field(s): ${unknown.join(', ')}`)
  if (data.source !== 'github') fail('source must be "github"')
  const repo = httpsUrl(fail, data.repo, 'repo')
  if (!Number.isInteger(data.stars) || data.stars < 0) fail('stars must be a non-negative integer')
  if (typeof data.syncedAt !== 'string' || Number.isNaN(Date.parse(data.syncedAt))) {
    fail('syncedAt must be an ISO timestamp')
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) fail('entries must be a non-empty array')
  const knownIds = new Set()
  const entries = data.entries.map(entry => validateEntry(entry, { file, knownIds }))
  return { source: 'github', repo, owner: data.owner, stars: data.stars, syncedAt: data.syncedAt, entries }
}

/**
 * Read and validate every file under an entries directory, enforcing global id
 * uniqueness. A broken file fails the whole read: that is what `--check` and
 * the build want.
 */
export async function readEntriesDir(entriesDir) {
  const names = (await readdir(entriesDir)).filter(name => name.endsWith('.json')).sort()
  const seen = new Set()
  const files = []
  for (const name of names) {
    const record = parseEntriesFile(await readFile(join(entriesDir, name), 'utf8'), { file: name })
    for (const entry of record.entries) {
      if (seen.has(entry.id)) throw new GalleryError(`${name}: duplicate entry id: ${entry.id}`)
      seen.add(entry.id)
    }
    files.push({ name, record })
  }
  return { files, ids: seen }
}

/**
 * Validate the entries directory without touching the network and without
 * throwing: every problem is collected so one run reports them all.
 */
export async function checkEntries(entriesDir) {
  let names
  try {
    names = (await readdir(entriesDir)).filter(name => name.endsWith('.json')).sort()
  } catch (error) {
    return { ok: false, files: 0, entries: 0, errors: [`cannot read ${entriesDir}: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const errors = []
  const owners = new Map()
  let entryCount = 0
  for (const name of names) {
    try {
      const record = parseEntriesFile(await readFile(join(entriesDir, name), 'utf8'), { file: name })
      for (const entry of record.entries) {
        if (owners.has(entry.id)) {
          errors.push(`${name}: duplicate entry id: ${entry.id} (also declared in ${owners.get(entry.id)})`)
        } else {
          owners.set(entry.id, name)
        }
        entryCount += 1
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (names.length === 0) errors.push(`no entry files under ${entriesDir}`)
  return { ok: errors.length === 0, files: names.length, entries: entryCount, errors }
}

/** HEAD, falling back to a ranged GET for servers that refuse HEAD. */
async function head(url, fetchImpl) {
  let response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
  if (response.status === 405 || response.status === 501) {
    response = await fetchImpl(url, { method: 'GET', redirect: 'follow', headers: { range: 'bytes=0-0' } })
  }
  return response
}

/** Drain a body we only wanted the headers of. */
async function discard(response) {
  try {
    await response.body?.cancel?.()
  } catch {
    // The mock in tests has no stream; a real response is drained best-effort.
  }
}

/**
 * Probe one image: it must answer and it must be png, jpeg or webp.
 *
 * @returns the observation, never a failure: the caller decides what a bad
 *   image costs the entry.
 */
export async function probeImage(url, fetchImpl = globalThis.fetch) {
  try {
    const response = await head(url, fetchImpl)
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const size = Number(response.headers.get('content-length') ?? '') || undefined
    await discard(response)
    const ok = response.ok && IMAGE_TYPES.has(contentType)
    const observation = { url, ok, status: response.status, contentType }
    if (size !== undefined) observation.size = size
    if (!ok) {
      observation.error = response.ok
        ? `content-type ${contentType === '' ? '(none)' : contentType} is not png, jpeg or webp`
        : `HTTP ${response.status}`
    }
    return observation
  } catch (error) {
    return { url, ok: false, status: 0, contentType: '', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Read the `frame-ancestors` directive out of a CSP header. */
function frameAncestors(csp) {
  if (typeof csp !== 'string') return null
  for (const directive of csp.split(';')) {
    const trimmed = directive.trim()
    if (/^frame-ancestors\b/i.test(trimmed)) return trimmed.replace(/^frame-ancestors\s*/i, '').trim()
  }
  return null
}

/** Whether a page refuses to be framed by another origin. */
function framingBlocked(xfo, ancestors) {
  if (typeof xfo === 'string' && xfo.trim() !== '' && xfo.trim().toLowerCase() !== 'allowall') return true
  if (ancestors !== null && ancestors !== '') return ancestors.trim() !== '*'
  return false
}

/**
 * Probe one web page: is it up, and may the host frame it? A page that sets
 * `X-Frame-Options` or a restrictive `frame-ancestors` still gets listed, with
 * `embeddable: false`, so the shelf can offer a plain browser tab instead.
 */
export async function probePage(url, fetchImpl = globalThis.fetch) {
  try {
    const response = await head(url, fetchImpl)
    const xfo = response.headers.get('x-frame-options')
    const ancestors = frameAncestors(response.headers.get('content-security-policy'))
    await discard(response)
    const embeddable = response.ok && !framingBlocked(xfo, ancestors)
    const observation = { url, reachable: response.ok, status: response.status, xfo, cspFrameAncestors: ancestors, embeddable }
    if (!response.ok) observation.error = `HTTP ${response.status}`
    return observation
  } catch (error) {
    return {
      url,
      reachable: false,
      status: 0,
      xfo: null,
      cspFrameAncestors: null,
      embeddable: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Turn validated entries plus their probe observations into the file that is
 * written to `gallery/entries/`.
 *
 * Network observations only ever subtract: an image that failed its probe is
 * dropped (the shelf falls back to a screenshot or a gradient) and a page that
 * refused the HEAD only loses `embeddable`. Warnings go through
 * `probes.warn`, so the function itself stays free of console output.
 *
 * @param repo - `{ url, stars, syncedAt }` snapshot for the repository.
 * @param manifest - validated entries (the `parseManifest` result) or a
 *   manifest-shaped `{ entries }` object.
 * @param probes - `{ images: { [url]: observation }, pages: { [url]: observation }, warn? }`.
 * @returns the on-disk file object.
 */
export function buildEntries(repo, manifest, probes = {}) {
  const warn = typeof probes.warn === 'function' ? probes.warn : () => {}
  const images = probes.images ?? {}
  const pages = probes.pages ?? {}
  const list = Array.isArray(manifest) ? manifest : manifest.entries
  if (!isObject(repo) || typeof repo.url !== 'string') throw new GalleryError('buildEntries: repo.url is required')
  if (typeof repo.owner !== 'string' || repo.owner === '') throw new GalleryError('buildEntries: repo.owner is required')
  if (!Array.isArray(list) || list.length === 0) throw new GalleryError('buildEntries: no entries to write')

  const entries = list.map(entry => {
    const built = { ...entry }
    if (built.cover !== undefined) {
      const observation = images[built.cover]
      if (observation !== undefined && !observation.ok) {
        warn(`${built.id}: dropping cover ${built.cover} (${observation.error ?? 'failed the image probe'})`)
        delete built.cover
      } else if (observation?.size !== undefined && observation.size > IMAGE_SIZE_HINT) {
        warn(`${built.id}: cover ${built.cover} is ${(observation.size / 1024 / 1024).toFixed(1)} MB`)
      }
    }
    if (built.screenshots !== undefined) {
      const kept = built.screenshots.filter(shot => {
        const observation = images[shot.src]
        if (observation !== undefined && !observation.ok) {
          warn(`${built.id}: dropping screenshot ${shot.src} (${observation.error ?? 'failed the image probe'})`)
          return false
        }
        return true
      })
      if (kept.length > 0) built.screenshots = kept
      else delete built.screenshots
    }
    if (built.kind === 'web') {
      const observation = pages[built.url]
      built.embeddable = observation?.embeddable === true
      if (observation !== undefined && !observation.reachable) {
        warn(`${built.id}: page ${built.url} is unreachable (${observation.error ?? `HTTP ${observation.status}`})`)
      }
    } else {
      delete built.embeddable
    }
    // The ecosystem convention names the repository owner as the author; a
    // manifest may override the display name.
    if (typeof built.author !== 'string' || built.author === '') built.author = repo.owner
    return built
  })

  return {
    source: 'github',
    repo: repo.url,
    owner: repo.owner,
    stars: Number.isInteger(repo.stars) && repo.stars >= 0 ? repo.stars : 0,
    syncedAt: typeof repo.syncedAt === 'string' && repo.syncedAt !== '' ? repo.syncedAt : new Date().toISOString(),
    entries,
  }
}

/** Run `worker` over `items`, at most `limit` at a time. */
async function eachLimited(items, limit, worker) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) await worker(queue.shift())
  })
  await Promise.all(runners)
}

/**
 * Probe everything one repository declared: each distinct image once, each
 * distinct web page once.
 */
async function probeEntries(entries, { fetchImpl, warn }) {
  const images = {}
  const pages = {}
  const imageUrls = new Set()
  const pageUrls = new Set()
  for (const entry of entries) {
    if (entry.cover !== undefined) imageUrls.add(entry.cover)
    for (const shot of entry.screenshots ?? []) imageUrls.add(shot.src)
    if (entry.kind === 'web') pageUrls.add(entry.url)
  }
  await eachLimited([...imageUrls], 4, async url => { images[url] = await probeImage(url, fetchImpl) })
  await eachLimited([...pageUrls], 4, async url => { pages[url] = await probePage(url, fetchImpl) })
  const failed = Object.values(images).filter(observation => !observation.ok).length
  if (failed > 0) warn(`${failed} image(s) did not pass the probe`)
  return { images, pages }
}

/** Map one GitHub search item to the fields the sync needs. */
function repositoryOf(item) {
  return {
    owner: item.owner.login,
    name: item.name,
    branch: item.default_branch,
    url: item.html_url,
    stars: Number(item.stargazers_count) || 0,
  }
}

/**
 * Page through the topic search. A rate-limited answer ends pagination with a
 * warning instead of failing the run: whatever was found still gets synced.
 */
export async function searchRepositories({ topic = TOPIC, fetchImpl = globalThis.fetch, token, perPage = 100, maxPages = 10, warn = () => {} } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-ft-gallery-sync' }
  if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
  const repositories = []
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(`topic:${topic}`)}&per_page=${perPage}&page=${page}`
    const response = await fetchImpl(url, { headers })
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining')
      const reset = Number(response.headers.get('x-ratelimit-reset'))
      const when = Number.isFinite(reset) && reset > 0 ? `, resets ${new Date(reset * 1000).toISOString()}` : ''
      warn(`GitHub API rate limited (HTTP ${response.status}${remaining === null ? '' : `, remaining ${remaining}`}${when}); stopping the scan`)
      break
    }
    if (!response.ok) throw new GalleryError(`GitHub search answered HTTP ${response.status}`)
    const body = await response.json()
    const items = Array.isArray(body.items) ? body.items : []
    repositories.push(...items.map(repositoryOf))
    const total = Number(body.total_count) || 0
    if (items.length < perPage || repositories.length >= total) break
  }
  return repositories
}

/** One repository's raw manifest URL on its default branch. */
export function manifestUrl(repository) {
  return `${RAW_BASE}/${repository.owner}/${repository.name}/${repository.branch}/${MANIFEST_FILE}`
}

/** The file name a repository's entries are stored under. */
export function entriesFileName(repository) {
  return `${repository.owner}__${repository.name}.json`
}

/** Tolerant scan of the ids already on disk, used to keep new entries unique. */
async function existingIds(entriesDir, warn) {
  const ids = new Map()
  let names
  try {
    names = (await readdir(entriesDir)).filter(name => name.endsWith('.json'))
  } catch {
    return ids
  }
  for (const name of names) {
    try {
      const record = parseEntriesFile(await readFile(join(entriesDir, name), 'utf8'), { file: name })
      ids.set(name, new Set(record.entries.map(entry => entry.id)))
    } catch (error) {
      warn(`${name} is not a valid entries file and was ignored for id checks (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  return ids
}

/** Write JSON through a temporary file, so a crash never leaves half a document. */
async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, file)
}

/**
 * The whole discovery run: search the topic, fetch every manifest, validate,
 * probe, and write one entries file per repository.
 *
 * A broken repository (no manifest, invalid entries, network failure) is a
 * warning; the run continues. Only a failure to search at all is fatal.
 *
 * @returns `{ written, skipped, failed, dryRun }` counts for the caller.
 */
export async function syncFromGitHub(options = {}, context = {}) {
  const {
    entriesDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'gallery/entries'),
    env = process.env,
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => new Date(),
    log = message => { console.log(`gallery-sync: ${message}`) },
    warn = message => { console.warn(`gallery-sync: warning: ${message}`) },
  } = context
  const dryRun = options.dryRun === true
  const offline = options.offline === true
  const token = options.tokenEnv === undefined ? undefined : env[options.tokenEnv]
  if (options.tokenEnv !== undefined && (typeof token !== 'string' || token === '')) {
    warn(`environment variable ${options.tokenEnv} is not set; using the unauthenticated GitHub API`)
  }

  const repositories = await searchRepositories({ fetchImpl, token, warn })
  log(`topic ${TOPIC}: ${repositories.length} repositories`)

  const knownIds = await existingIds(entriesDir, warn)
  const summary = { written: 0, skipped: 0, failed: 0, dryRun }
  for (const repository of repositories) {
    const name = `${repository.owner}/${repository.name}`
    const target = entriesFileName(repository)
    const rawUrl = manifestUrl(repository)
    let manifest
    try {
      const response = await fetchImpl(rawUrl, { headers: { 'user-agent': 'dsh-ft-gallery-sync' } })
      if (response.status === 404) {
        warn(`${name}: no ${MANIFEST_FILE} on branch ${repository.branch}; skipped`)
        summary.skipped += 1
        continue
      }
      if (!response.ok) throw new GalleryError(`manifest answered HTTP ${response.status}`)
      manifest = await response.text()
    } catch (error) {
      warn(`${name}: could not read ${rawUrl} (${error instanceof Error ? error.message : String(error)}); skipped`)
      summary.failed += 1
      continue
    }

    const taken = new Set()
    for (const [file, ids] of knownIds) if (file !== target) for (const id of ids) taken.add(id)
    let entries
    try {
      entries = parseManifest(manifest, { file: `${name}/${MANIFEST_FILE}`, repoUrl: repository.url, baseManifestUrl: rawUrl, knownIds: taken })
    } catch (error) {
      warn(`${name}: ${error instanceof Error ? error.message : String(error)}; skipped`)
      summary.failed += 1
      continue
    }

    let probes = { images: {}, pages: {} }
    if (!offline) probes = await probeEntries(entries, { fetchImpl, warn })
    const file = buildEntries({ url: repository.url, owner: repository.owner, stars: repository.stars, syncedAt: now().toISOString() }, entries, { ...probes, warn })
    if (dryRun) {
      log(`would write gallery/entries/${target} (${file.entries.length} entries)`)
    } else {
      await writeJson(join(entriesDir, target), file)
      log(`wrote gallery/entries/${target} (${file.entries.length} entries)`)
    }
    knownIds.set(target, new Set(file.entries.map(entry => entry.id)))
    summary.written += 1
  }

  if (summary.written === 0) warn('no repository produced an entries file')
  log(`${dryRun ? 'dry run' : 'sync'}: ${summary.written} written, ${summary.skipped} skipped, ${summary.failed} failed`)
  return summary
}

/**
 * Parse the CLI flags.
 *
 * @returns `{ check, offline, dryRun, tokenEnv, help }`.
 */
export function parseArgs(argv) {
  const options = { check: false, offline: false, dryRun: false, tokenEnv: 'GITHUB_TOKEN', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') options.check = true
    else if (argument === '--offline') options.offline = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--token') {
      const value = argv[index + 1]
      if (value === undefined || value === '' || value.startsWith('--')) throw new GalleryError('--token needs the name of an environment variable')
      options.tokenEnv = value
      index += 1
    } else if (argument.startsWith('--token=')) {
      const value = argument.slice('--token='.length)
      if (value === '') throw new GalleryError('--token needs the name of an environment variable')
      options.tokenEnv = value
    } else {
      throw new GalleryError(`unknown argument: ${argument}`)
    }
  }
  return options
}

const USAGE = `Usage: node scripts/gallery-sync.mjs [options]

Scan the GitHub topic ${TOPIC}, validate every repository manifest
(${MANIFEST_FILE}) and write gallery/entries/<owner>__<repo>.json.

Options:
  --check           validate the existing entries only (no network)
  --offline         fetch manifests but skip image and URL probes
  --dry-run         do everything except write the entries files
  --token <ENV>     environment variable holding a GitHub token (default GITHUB_TOKEN)
  -h, --help        show this help`

/** Run the CLI. */
async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const entriesDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'gallery/entries')
  if (options.check) {
    const report = await checkEntries(entriesDir)
    for (const error of report.errors) console.error(`gallery-sync: ${error}`)
    console.log(`gallery-sync: checked ${report.files} file(s), ${report.entries} entry(ies)`)
    return report.ok ? 0 : 1
  }
  const summary = await syncFromGitHub(options, { entriesDir })
  return summary.failed > 0 && summary.written === 0 ? 1 : 0
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code },
    error => {
      console.error(`gallery-sync: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    },
  )
}
