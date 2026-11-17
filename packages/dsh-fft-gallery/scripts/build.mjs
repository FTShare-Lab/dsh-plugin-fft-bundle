/**
 * Build the gallery package: validate the entry manifests, write the catalog
 * the browser half reads and the format-1 market index the Host Discover page
 * reads, then copy both halves into `lib/`.
 *
 * One source of truth, two projections:
 *   gallery/entries/*.json  →  gallery/catalog.json  (this product's shelf)
 *                           →  gallery/index.json    (Host plugin market index)
 *
 * The index only carries `plugin` entries: the Host format has no notion of a
 * web page, so a `web` entry exists in the catalog alone. Keeping the
 * projection here (instead of hand-maintaining a second file) is what keeps the
 * two surfaces from drifting.
 *
 * Run: `node scripts/build.mjs`
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entriesDir = resolve(root, 'gallery/entries')
const catalogFile = resolve(root, 'gallery/catalog.json')
const indexFile = resolve(root, 'gallery/index.json')

const KINDS = new Set(['web', 'plugin'])
const TRUST = new Set(['verified', 'community'])
const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/

/** Raise one validation failure with the entry it belongs to. */
function fail(id, message) {
  throw new Error(`gallery entry ${id}: ${message}`)
}

/** A localized field must carry both languages the UI renders. */
function localized(entry, field) {
  const value = entry[field]
  if (typeof value !== 'object' || value === null) fail(entry.id, `${field} must be a { zh, en } object`)
  for (const locale of ['zh', 'en']) {
    if (typeof value[locale] !== 'string' || value[locale].trim() === '') {
      fail(entry.id, `${field}.${locale} must be a non-empty string`)
    }
  }
  return { zh: value.zh.trim(), en: value.en.trim() }
}

/** An optional http(s) URL, trimmed; errors name the field. */
function url(entry, field, { optional = false } = {}) {
  const value = entry[field]
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') fail(entry.id, `${field} must be an https URL`)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(entry.id, `${field} is not a URL: ${value}`)
  }
  if (parsed.protocol !== 'https:') fail(entry.id, `${field} must use https: ${value}`)
  if (parsed.username !== '' || parsed.password !== '') fail(entry.id, `${field} must not embed credentials`)
  return value
}

/** Nothing but the fields this package defines may appear in an entry. */
const ALLOWED = new Set([
  'id', 'kind', 'trust', 'category', 'order', 'title', 'description', 'url', 'homepage',
  'repo', 'author', 'spec', 'publishTimestamp', 'engines', 'keywords',
])

/** Validate one entry and return the normalized record the catalog stores. */
function normalize(entry, file) {
  if (typeof entry.id !== 'string' || !ID.test(entry.id)) fail(file, 'id must match /^[a-z0-9][a-z0-9._-]{1,63}$/')
  for (const key of Object.keys(entry)) {
    if (!ALLOWED.has(key)) fail(entry.id, `unknown field: ${key}`)
  }
  if (!KINDS.has(entry.kind)) fail(entry.id, 'kind must be web or plugin')
  if (!TRUST.has(entry.trust)) fail(entry.id, 'trust must be verified or community')
  if (typeof entry.category !== 'string' || entry.category === '') fail(entry.id, 'category must be a non-empty string')
  const record = {
    id: entry.id,
    kind: entry.kind,
    trust: entry.trust,
    category: entry.category,
    order: typeof entry.order === 'number' ? entry.order : 100,
    title: localized(entry, 'title'),
    description: localized(entry, 'description'),
    ...typeof entry.author === 'string' && entry.author !== '' ? { author: entry.author } : {},
    ...typeof entry.repo === 'string' ? { repo: url(entry, 'repo', { optional: true }) } : {},
    ...entry.homepage !== undefined ? { homepage: url(entry, 'homepage', { optional: true }) } : {},
    ...Array.isArray(entry.keywords) && entry.keywords.every(word => typeof word === 'string')
      ? { keywords: entry.keywords.slice(0, 8) }
      : {},
    engines: typeof entry.engines?.dsh === 'string' ? { dsh: entry.engines.dsh } : {},
  }
  if (entry.kind === 'web') {
    return { ...record, url: url(entry, 'url') }
  }
  const spec = entry.spec
  if (typeof spec !== 'object' || spec === null) fail(entry.id, 'plugin entries need a spec object')
  if (spec.type === 'npm') {
    if (typeof spec.name !== 'string' || spec.name === '') fail(entry.id, 'spec.name must be a package name')
    if (typeof spec.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec.version)) {
      fail(entry.id, 'spec.version must be an exact SemVer version')
    }
    const registry = spec.registry === undefined ? undefined : (() => {
      let parsed
      try {
        parsed = new URL(spec.registry)
      } catch {
        fail(entry.id, `spec.registry is not a URL: ${spec.registry}`)
      }
      if (parsed.protocol !== 'https:') fail(entry.id, 'spec.registry must use https')
      return spec.registry
    })()
    if (typeof entry.publishTimestamp !== 'number' || !Number.isInteger(entry.publishTimestamp)) {
      fail(entry.id, 'plugin entries need publishTimestamp (Unix seconds)')
    }
    return {
      ...record,
      spec: {
        type: 'npm',
        name: spec.name,
        version: spec.version,
        ...registry === undefined ? {} : { registry },
      },
      publishTimestamp: entry.publishTimestamp,
    }
  }
  if (spec.type === 'git') {
    if (typeof spec.url !== 'string' || spec.url === '') fail(entry.id, 'spec.url must be a repository URL')
    if (typeof spec.commit !== 'string' || !/^[0-9a-f]{40}$/.test(spec.commit)) fail(entry.id, 'spec.commit must be a 40-hex commit')
    if (typeof entry.publishTimestamp !== 'number' || !Number.isInteger(entry.publishTimestamp)) {
      fail(entry.id, 'plugin entries need publishTimestamp (Unix seconds)')
    }
    return {
      ...record,
      spec: {
        type: 'git',
        url: url(entry, 'spec.url'),
        commit: spec.commit,
        ...typeof spec.path === 'string' && spec.path !== '' ? { path: spec.path } : {},
      },
      publishTimestamp: entry.publishTimestamp,
    }
  }
  fail(entry.id, 'spec.type must be npm or git')
}

/** Category display names, keyed by the category ids entries use. */
const CATEGORIES = {
  market: { zh: '行情', en: 'Market data' },
  research: { zh: '研究', en: 'Research' },
  chart: { zh: '图表', en: 'Charts' },
  tool: { zh: '工具', en: 'Tools' },
  panel: { zh: '面板', en: 'Panels' },
}

/** The Host market index for the plugin entries; web pages have no place in it. */
function marketIndex(entries, generatedAt) {
  const used = new Set(entries.map(entry => entry.category))
  const plugins = entries
    .filter(entry => entry.kind === 'plugin')
    .map(entry => ({
      name: entry.spec.type === 'npm' ? entry.spec.name : entry.id,
      title: entry.title,
      description: entry.description,
      ...entry.repo === undefined ? {} : { repository: { url: entry.repo } },
      ...entry.author === undefined ? {} : { author: entry.author },
      ...entry.homepage === undefined ? {} : { homepage: entry.homepage },
      metadata: {
        category: entry.category,
        keywords: entry.keywords ?? [],
        labels: [],
        sortKeys: {},
      },
      versions: [{
        version: entry.spec.type === 'npm' ? entry.spec.version : entry.id,
        publishTimestamp: entry.publishTimestamp,
        source: entry.spec.type === 'npm'
          ? { type: 'npm', ...entry.spec.registry === undefined ? {} : { registry: entry.spec.registry } }
          : { type: 'git', url: entry.spec.url, commit: entry.spec.commit, ...entry.spec.path === undefined ? {} : { path: entry.spec.path } },
        engines: entry.engines.dsh === undefined ? {} : { dsh: entry.engines.dsh },
      }],
    }))
  return {
    format: 1,
    title: { zh: 'FT 画廊', en: 'FT Gallery' },
    description: {
      zh: '非凸金融工作台的子插件与网页应用目录。',
      en: 'Panels and web apps for the FT financial workbench.',
    },
    metadata: {
      categories: Object.fromEntries(
        Object.entries(CATEGORIES).filter(([id]) => used.has(id)).map(([id, title]) => [id, { title }]),
      ),
      labels: {},
      sortKeys: {},
    },
    generatedAt,
    plugins,
  }
}

/** Read every entry file and validate it. */
async function readEntries() {
  const files = (await readdir(entriesDir)).filter(name => name.endsWith('.json')).sort()
  if (files.length === 0) throw new Error(`no entries under ${entriesDir}`)
  const seen = new Set()
  const entries = []
  for (const file of files) {
    const raw = JSON.parse(await readFile(resolve(entriesDir, file), 'utf8'))
    const entry = normalize(raw, file)
    if (seen.has(entry.id)) throw new Error(`duplicate entry id: ${entry.id}`)
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Copy a source file into lib/, keeping the two runtime guards the bundle uses. */
async function publish(source, target, { moduleId } = {}) {
  const text = await readFile(resolve(root, source), 'utf8')
  if (moduleId !== undefined && !text.includes(`id: '${moduleId}'`)) {
    throw new Error(`${source} must register id '${moduleId}'`)
  }
  await mkdir(dirname(resolve(root, target)), { recursive: true })
  await writeFile(resolve(root, target), text)
}

const entries = await readEntries()
const generatedAt = new Date().toISOString()
const usedCategories = new Set(entries.map(entry => entry.category))
const catalog = {
  format: 1,
  generatedAt,
  categories: Object.fromEntries(
    Object.entries(CATEGORIES).filter(([id]) => usedCategories.has(id)),
  ),
  entries,
}
await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`)
await writeFile(indexFile, `${JSON.stringify(marketIndex(entries, generatedAt), null, 2)}\n`)
await publish('src/index.js', 'lib/index.js')
await publish('src/client/index.js', 'lib/client.js', { moduleId: '@dsh-ft/dsh-fft-gallery' })

console.log(`gallery: ${entries.length} entries (${entries.filter(e => e.kind === 'web').length} web, ${entries.filter(e => e.kind === 'plugin').length} plugin)`)
console.log(`gallery: wrote ${catalogFile.replace(root + '/', '')} and ${indexFile.replace(root + '/', '')}`)
