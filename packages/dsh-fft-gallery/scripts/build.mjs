/**
 * Build the gallery package: validate the synced entries, write the catalog the
 * browser half reads, and copy both halves into `lib/`.
 *
 * One source of truth, one projection:
 *   gallery/entries/*.json  →  gallery/catalog.json  (format 2, shipped in the package)
 *
 * The per-repository files come from `gallery-sync.mjs`; this script is offline
 * and only enforces the same schema again (a hand edit must not ship). The
 * catalog is deterministic: the only clock-derived field is `generatedAt`, and
 * SOURCE_DATE_EPOCH pins it when a byte-identical rebuild matters.
 *
 * Run: `node scripts/build.mjs`
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, DEFAULT_ORDER, GalleryError, readEntriesDir } from './gallery-sync.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entriesDir = resolve(root, 'gallery/entries')
const catalogFile = resolve(root, 'gallery/catalog.json')

/** Catalog format this build writes and the host half reads. */
export const CATALOG_FORMAT = 2

/** Fields a catalog entry carries, in the order they are written. */
const CATALOG_FIELDS = [
  'id', 'kind', 'category', 'order', 'title', 'summary', 'details', 'cover', 'screenshots',
  'url', 'spec', 'open', 'homepage', 'author', 'engines', 'embeddable',
  'source', 'repo', 'owner', 'stars', 'syncedAt',
]

/**
 * Project one validated entry plus its repository snapshot into the catalog.
 * An empty `details`/`cover`/`screenshots` never appears; a web entry always
 * carries `embeddable` so the shelf can decide between the in-app browser tab
 * and a plain window.
 */
export function projectEntry(entry, container) {
  const record = {
    id: entry.id,
    kind: entry.kind,
    category: entry.category,
    order: entry.order ?? DEFAULT_ORDER,
    title: entry.title,
    summary: entry.summary,
    ...entry.details === undefined ? {} : { details: entry.details },
    ...entry.cover === undefined ? {} : { cover: entry.cover },
    ...entry.screenshots === undefined ? {} : { screenshots: entry.screenshots },
    ...entry.kind === 'web'
      ? { url: entry.url, embeddable: entry.embeddable === true }
      : { spec: entry.spec, ...entry.open === undefined ? {} : { open: entry.open } },
    ...entry.homepage === undefined ? {} : { homepage: entry.homepage },
    ...entry.author === undefined ? {} : { author: entry.author },
    ...entry.engines === undefined ? {} : { engines: entry.engines },
    source: container.source,
    repo: container.repo,
    ...container.owner === undefined ? {} : { owner: container.owner },
    stars: container.stars,
    syncedAt: container.syncedAt,
  }
  return record
}

/**
 * Compare two entries the way the catalog orders them: explicit `order` first,
 * then id by code point (not locale, so the output is byte-identical anywhere).
 */
export function compareEntries(left, right) {
  const order = (left.order ?? DEFAULT_ORDER) - (right.order ?? DEFAULT_ORDER)
  if (order !== 0) return order
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/**
 * Build the catalog document from the validated entries files.
 *
 * @param containers - the `record` of every `gallery/entries/*.json` file.
 * @param options.generatedAt - ISO timestamp; defaults to now (or SOURCE_DATE_EPOCH).
 * @throws when there is nothing to publish.
 */
export function buildCatalog(containers, { generatedAt = resolveGeneratedAt() } = {}) {
  if (!Array.isArray(containers)) throw new GalleryError('buildCatalog: containers must be an array')
  const entries = containers.flatMap(container => container.entries.map(entry => projectEntry(entry, container)))
  if (entries.length === 0) {
    throw new GalleryError('no gallery entries to publish: gallery/entries has no entries')
  }
  entries.sort(compareEntries)
  const ids = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new GalleryError(`duplicate entry id: ${entry.id}`)
    ids.add(entry.id)
  }
  return {
    format: CATALOG_FORMAT,
    generatedAt,
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, names]) => [id, { zh: names.zh, en: names.en }])),
    entries: entries.map(entry => Object.fromEntries(CATALOG_FIELDS.filter(field => entry[field] !== undefined).map(field => [field, entry[field]]))),
  }
}

/** Serialize a catalog exactly the way it is committed. */
export function renderCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

/**
 * The build timestamp: wall clock normally, SOURCE_DATE_EPOCH when a
 * reproducible build pins it.
 */
export function resolveGeneratedAt(env = process.env, now = () => new Date()) {
  const epoch = env.SOURCE_DATE_EPOCH
  if (epoch !== undefined && epoch.trim() !== '') {
    const seconds = Number(epoch)
    if (!Number.isFinite(seconds) || seconds < 0) throw new GalleryError('SOURCE_DATE_EPOCH must be a non-negative number of seconds')
    return new Date(Math.floor(seconds) * 1000).toISOString()
  }
  return now().toISOString()
}

/** Copy a source file into lib/, keeping the client module-id guard. */
async function publish(source, target, { moduleId } = {}) {
  const text = await readFile(resolve(root, source), 'utf8')
  if (moduleId !== undefined && !text.includes(`id: '${moduleId}'`)) {
    throw new Error(`${source} must register id '${moduleId}'`)
  }
  await mkdir(dirname(resolve(root, target)), { recursive: true })
  await writeFile(resolve(root, target), text)
}

/** Read + validate the synced entries, write the catalog, publish lib/. */
async function main() {
  const { files } = await readEntriesDir(entriesDir)
  if (files.length === 0) throw new GalleryError(`no entries under ${entriesDir}`)
  const catalog = buildCatalog(files.map(file => file.record), { generatedAt: resolveGeneratedAt() })
  // Copy first: the lib/ guards are the last thing that can fail, and a failed
  // build must not leave a catalog that no matching lib/ was shipped with.
  await publish('src/index.js', 'lib/index.js')
  await publish('src/client/index.js', 'lib/client.js', { moduleId: '@dsh-ft/dsh-fft-gallery' })
  await writeFile(catalogFile, renderCatalog(catalog))
  const web = catalog.entries.filter(entry => entry.kind === 'web').length
  console.log(`gallery: ${catalog.entries.length} entries (${web} web, ${catalog.entries.length - web} plugin) from ${files.length} file(s)`)
  console.log(`gallery: wrote ${catalogFile.replace(`${root}/`, '')} and lib/`)
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch(error => {
    console.error(`gallery: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
