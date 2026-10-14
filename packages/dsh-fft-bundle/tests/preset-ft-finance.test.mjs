/**
 * The finance preset's composition is a snapshot of the official `standard`
 * preset's.
 *
 * A preset's `plugins` list is complete — it inherits nothing — so the finance
 * mode has to restate the 19 rows the web app ships and then append the FT
 * workstream. Nothing else in this repository would notice when DSH edits the
 * official composition: the copy would silently keep a retired plugin, or lose
 * a tool the moment the upstream list grows. This test is that guard, and it
 * reports drift by key path (`config.plugins[3].disabled: …`) so a failure
 * names the row and the field that moved.
 *
 * The official file is not tracked here — `thirdparty/` is ignored, and the
 * public branch ships no harness checkout at all — so the guard resolves a
 * reachable copy in the order a developer machine can offer one, and skips
 * with an explicit recipe when none is reachable.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { load } from 'js-yaml'
import { schema } from './lib/patch-yaml.mjs'
import { diffRows } from './lib/patch-compare.mjs'

/** The preset row this bundle owns. */
const PRESET_ID = 'preset-ft-finance'
/** The official preset row this bundle copies. */
const UPSTREAM_PRESET_ID = 'preset-standard'
/** The registry row whose `default` decides a new session's preset. */
const REGISTRY_ID = 'agent-preset-registry'
/** The one upstream plugin whose identity this bundle replaces on purpose. */
const PERSONA_ID = 'persona'
/** Plugin rows the finance preset appends after the official composition. */
const ADDED_PLUGINS = [
  'ft-guidance',
  'mcp-dsh-kline',
  'ft-research-cockpit-tools',
  'dsh-fft-factor-intake-standard',
]
/** Rows that must stay on the global plane, whatever the preset does. */
const GLOBAL_ROWS = ['dsh-fft-settings', 'newapi-wechat-sso', 'dsh-kline-sidebar', 'ft-research-cockpit']
/** Rows that must mount only from inside the finance preset. */
const PRESET_ONLY_ROWS = ['mcp-dsh-kline', 'dsh-fft-factor-intake-standard']
/** The official composition this copy was taken from; growing requires a re-sync. */
const UPSTREAM_PLUGIN_COUNT = 19

/** Path of the preset file, relative to the upstream `web-app` package. */
const PRESET_FILE = 'presets/standard.patch.yml'
/** Path of the upstream patch that declares the preset registry row. */
const WEB_APP_PATCH_FILE = 'cordis.patch.yml'
/** The desktop app's archive, the last place an installed harness is readable. */
const DEFAULT_ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const patchPath = resolve(root, manifest.dsh.bundle.patch)
const parsedPatch = load(readFileSync(patchPath, 'utf8'), { schema })

/**
 * Read a file under an upstream `web-app` directory, or `null` when absent.
 * @param webAppDir - directory holding the web app's patch files.
 * @param relative - path relative to that directory.
 * @returns the file's text, or `null`.
 */
function readIfPresent(webAppDir, relative) {
  const file = resolve(webAppDir, relative)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/**
 * A harness copy reachable as an unpacked directory.
 * @param label - human-readable origin, used in failure messages.
 * @param webAppDir - the `packages/bundle/web-app` directory.
 * @returns a source whose `read` yields text or `null`.
 */
function directorySource(label, webAppDir) {
  return { label, read: relative => readIfPresent(webAppDir, relative) }
}

/**
 * A harness copy reachable only inside the desktop app's `app.asar`.
 *
 * The archive is read through its own header (JSON length at byte 12, the JSON
 * at 16, file data after the header), and the content is checked against the
 * header's integrity hash: a wrong offset would otherwise hand the comparison
 * arbitrary bytes.
 * @param label - human-readable origin, used in failure messages.
 * @param asarPath - the archive to open.
 * @returns a source whose `read` yields text or `null`.
 */
function asarSource(label, asarPath) {
  return {
    label,
    read(relative) {
      const inner = `dsh/node_modules/@deepseek-ai/dsh-web-app/${relative}`
      let fd
      try {
        fd = openSync(asarPath, 'r')
      } catch {
        return null
      }
      try {
        const head = Buffer.alloc(16)
        readSync(fd, head, 0, 16, 0)
        const headerLength = head.readUInt32LE(12)
        const headerBytes = Buffer.alloc(headerLength)
        readSync(fd, headerBytes, 0, headerLength, 16)
        const header = JSON.parse(headerBytes.toString('utf8'))
        const entry = inner.split('/').reduce((node, part) => node?.files?.[part], header)
        if (!entry || entry.files) return null
        const content = Buffer.alloc(entry.size)
        readSync(fd, content, 0, entry.size, 8 + head.readUInt32LE(4) + Number(entry.offset))
        const hash = createHash('sha256').update(content).digest('hex')
        return hash === entry.integrity?.hash ? content.toString('utf8') : null
      } catch {
        return null
      } finally {
        closeSync(fd)
      }
    },
  }
}

/**
 * Reachable copies of the upstream harness, best first.
 *
 * `DSH_UPSTREAM_PRESET` names the preset file itself; `DSH_HARNESS_ROOT` names
 * a harness checkout; the rest are the layouts this workspace and an installed
 * desktop app produce. Every candidate is probed, and a candidate that cannot
 * supply the preset file is simply not the one.
 * @returns an array of sources in probe order.
 */
function upstreamSources() {
  const sources = []
  if (process.env.DSH_UPSTREAM_PRESET) {
    const file = resolve(process.env.DSH_UPSTREAM_PRESET)
    const webAppDir = dirname(dirname(file))
    sources.push({
      label: file,
      read: relative => (relative === PRESET_FILE
        ? (existsSync(file) ? readFileSync(file, 'utf8') : null)
        : readIfPresent(webAppDir, relative)),
    })
  }
  if (process.env.DSH_HARNESS_ROOT) {
    sources.push(directorySource(
      `${process.env.DSH_HARNESS_ROOT} (DSH_HARNESS_ROOT)`,
      resolve(process.env.DSH_HARNESS_ROOT, 'packages/bundle/web-app'),
    ))
  }
  sources.push(
    directorySource(
      'thirdparty/deepseek-harness',
      resolve(root, '../../thirdparty/deepseek-harness/packages/bundle/web-app'),
    ),
    directorySource(
      'the sibling dsh-ft checkout',
      resolve(root, '../../../dsh-ft/submodules/deepseek-harness/packages/bundle/web-app'),
    ),
    directorySource(
      'the sibling dsh-ft checkout',
      resolve(root, '../../../../dsh-ft/submodules/deepseek-harness/packages/bundle/web-app'),
    ),
    directorySource(
      'the installed @deepseek-ai/dsh-web-app',
      resolve(root, 'node_modules/@deepseek-ai/dsh-web-app'),
    ),
    directorySource(
      'the installed @deepseek-ai/dsh-web-app',
      resolve(root, '../../../node_modules/@deepseek-ai/dsh-web-app'),
    ),
  )
  const asarPath = process.env.DSH_DESKTOP_APP
    ? resolve(process.env.DSH_DESKTOP_APP, process.env.DSH_DESKTOP_APP.endsWith('.asar') ? '' : 'Contents/Resources/app.asar')
    : DEFAULT_ASAR
  if (existsSync(asarPath)) sources.push(asarSource(`${asarPath} (DSH_DESKTOP_APP)`, asarPath))
  return sources
}

/** The first upstream source that can supply the official preset, or `null`. */
function findUpstream() {
  for (const source of upstreamSources()) {
    const preset = source.read(PRESET_FILE)
    if (preset) return { ...source, preset }
  }
  return null
}

/**
 * The preset row a patch declares, or `undefined`.
 * @param parsed - a parsed patch list.
 * @param presetId - the row id to look for.
 * @returns the row, when the patch inserts it.
 */
function presetRowOf(parsed, presetId) {
  return parsed.flatMap(entry => entry.insert ?? []).find(entry => entry.id === presetId)
}

/**
 * The `plugins` composition of a preset row, or `null` when it is not one.
 * @param parsed - a parsed patch list.
 * @param presetId - the row id to look for.
 * @returns the plugin rows, when the row carries a list.
 */
function pluginsOf(parsed, presetId) {
  const plugins = presetRowOf(parsed, presetId)?.config?.plugins
  return Array.isArray(plugins) ? plugins : null
}

/**
 * The same, asserted: a missing composition is a defect, not an empty list.
 * @param parsed - a parsed patch list.
 * @param presetId - the row id to look for.
 * @param source - where the patch came from, for the failure message.
 * @returns the plugin rows.
 */
function requirePlugins(parsed, presetId, source) {
  const plugins = pluginsOf(parsed, presetId)
  assert.ok(plugins, `${source} must declare a "${presetId}" row with a config.plugins list`)
  return plugins
}

const upstream = findUpstream()
const SKIP_REASON = `cannot reach the official ${PRESET_FILE}: set DSH_UPSTREAM_PRESET to that file, or DSH_HARNESS_ROOT to a harness checkout, to run the drift guard`
/** Passed to every test that needs the official file, so an unreachable copy skips with the recipe. */
const skipUnreachable = upstream === null && SKIP_REASON

describe('the finance preset in this bundle', () => {
  const bundlePlugins = requirePlugins(parsedPatch, PRESET_ID, patchPath)

  it('carries the identity and the ordering a new-session default needs', () => {
    const config = presetRowOf(parsedPatch, PRESET_ID)?.config
    assert.ok(config, `${patchPath} must insert the "${PRESET_ID}" row`)
    assert.equal(config.id, 'ft-finance', 'the registry default names this preset by config.id')
    assert.equal(config.order, 5, 'the finance preset must sort after the official presets')
    // The manager renders both strings in the preset picker, so an empty or
    // untranslated value ships a blank card to a Chinese-only user base.
    for (const key of ['name', 'description']) {
      assert.equal(typeof config[key], 'string', `${PRESET_ID} needs a string ${key}`)
      assert.ok(config[key].trim() !== '', `${PRESET_ID} needs a non-empty ${key}`)
      assert.match(config[key], /\p{Script=Han}/u, `${PRESET_ID}.${key} must read in Chinese`)
    }
  })

  it('appends exactly the four finance rows, each id once', () => {
    const appended = bundlePlugins.slice(UPSTREAM_PLUGIN_COUNT).map(row => row.id)
    assert.deepEqual(
      appended,
      ADDED_PLUGINS,
      `the "${PRESET_ID}" composition must end with the four finance rows, in this order`,
    )
    const ids = bundlePlugins.map(row => row.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    assert.deepEqual(duplicates, [], `the "${PRESET_ID}" composition repeats row ids: ${duplicates.join(', ')}`)
  })

  it('mounts the finance-only rows nowhere but the preset', () => {
    const globalRows = parsedPatch.flatMap(entry => entry.insert ?? [])
    const globalIds = globalRows.map(row => row.id)
    for (const id of GLOBAL_ROWS) {
      assert.ok(globalIds.includes(id), `the global insert must keep the host row "${id}"`)
    }
    for (const id of PRESET_ONLY_ROWS) {
      assert.ok(
        !globalIds.includes(id),
        `"${id}" must mount only inside "${PRESET_ID}", not on the global plane`,
      )
      assert.ok(
        bundlePlugins.some(row => row.id === id),
        `"${id}" must be inserted by "${PRESET_ID}" now that it left the global plane`,
      )
    }
  })

  it('overrides the preset registry with only the durable default key', () => {
    // The loader replaces a row's whole config, so this override is only safe
    // while it restates every key the official row declares. The next test
    // checks that upstream condition against the official patch.
    const overrides = parsedPatch.filter(entry => entry.id === REGISTRY_ID && entry.insert === undefined)
    assert.equal(
      overrides.length,
      1,
      `${patchPath} must carry exactly one top-level "${REGISTRY_ID}" override, found ${overrides.length}`,
    )
    const override = overrides[0]
    assert.deepEqual(
      Object.keys(override).sort(),
      ['config', 'id'],
      `the "${REGISTRY_ID}" override must only replace config; other keys replace the row's own fields`,
    )
    assert.deepEqual(
      Object.keys(override.config ?? {}),
      ['default'],
      `the "${REGISTRY_ID}" override must restate the official row's keys, and add none`,
    )
    assert.equal(
      override.config.default,
      'ft-finance',
      `"${REGISTRY_ID}".config.default must select the finance preset`,
    )
  })

  describe('against the official standard composition', () => {
    const officialPatch = upstream ? load(upstream.preset, { schema }) : null

    it('is pinned to the official composition size', { skip: skipUnreachable }, () => {
      const official = requirePlugins(officialPatch, UPSTREAM_PRESET_ID, upstream.label)
      assert.equal(
        official.length,
        UPSTREAM_PLUGIN_COUNT,
        `the official standard preset changed size (${UPSTREAM_PLUGIN_COUNT} → ${official.length}); re-sync "${PRESET_ID}" and update this count`,
      )
      assert.equal(
        bundlePlugins.length,
        official.length + ADDED_PLUGINS.length,
        `"${PRESET_ID}" must hold the ${official.length} official rows plus the ${ADDED_PLUGINS.length} finance rows`,
      )
    })

    it('mirrors every official plugin row, field for field', { skip: skipUnreachable }, () => {
      const official = requirePlugins(officialPatch, UPSTREAM_PRESET_ID, upstream.label)
      const drift = []
      const shared = Math.min(official.length, bundlePlugins.length)
      for (let index = 0; index < shared; index += 1) {
        const upstreamRow = official[index]
        const bundleRow = bundlePlugins[index]
        const path = `config.plugins[${index}]`
        for (const difference of diffRows(upstreamRow, bundleRow, path)) {
          // The FT persona is the one field this bundle changes on purpose;
          // the next test pins that the change is real and FT-shaped.
          const personaIdentity = upstreamRow.id === PERSONA_ID
            && difference.startsWith(`${path}.config.prefix:`)
          if (!personaIdentity) {
            drift.push(`${difference}\n    (row "${bundleRow.id}" against official "${upstreamRow.id}")`)
          }
        }
      }
      assert.deepEqual(
        drift,
        [],
        `"${PRESET_ID}" drifted from ${upstream.label} ("${UPSTREAM_PRESET_ID}"); only the persona prefix may differ`,
      )
    })

    it('replaces the persona identity, and nothing else about that row', { skip: skipUnreachable }, () => {
      const official = requirePlugins(officialPatch, UPSTREAM_PRESET_ID, upstream.label)
      const index = official.findIndex(row => row.id === PERSONA_ID)
      assert.ok(index !== -1, `${upstream.label} must declare a "${PERSONA_ID}" plugin`)
      const upstreamPersona = official[index]
      const bundlePersona = bundlePlugins.find(row => row.id === PERSONA_ID)
      assert.ok(bundlePersona, `"${PRESET_ID}" must declare a "${PERSONA_ID}" plugin`)

      const path = `config.plugins[${index}]`
      assert.deepEqual(
        diffRows(upstreamPersona, bundlePersona, path).map(difference => difference.split(':')[0]),
        [`${path}.config.prefix`],
        `the "${PERSONA_ID}" row may differ from the official one only in config.prefix`,
      )
      assert.notEqual(
        bundlePersona.config.prefix,
        upstreamPersona.config.prefix,
        `"${PERSONA_ID}".config.prefix must state the FT identity, not the official wording`,
      )
      assert.match(
        bundlePersona.config.prefix,
        /非凸|FT/u,
        `"${PERSONA_ID}".config.prefix must name the FT identity it was changed for`,
      )
    })

    it('restates every key the official registry row declares', { skip: skipUnreachable }, t => {
      const upstreamPatch = upstream.read(WEB_APP_PATCH_FILE)
      if (!upstreamPatch) return t.skip(`${upstream.label} carries no ${WEB_APP_PATCH_FILE}`)
      const registry = parsed => parsed.flatMap(entry => entry.insert ?? []).find(entry => entry.id === REGISTRY_ID)
      const upstreamRegistry = registry(load(upstreamPatch, { schema }))
      assert.ok(upstreamRegistry, `${upstream.label} must insert a "${REGISTRY_ID}" row`)
      const keys = Object.keys(upstreamRegistry.config ?? {})
      assert.deepEqual(
        keys,
        ['default'],
        `the official "${REGISTRY_ID}" row now declares [${keys.join(', ')}]; the "${patchPath}" override replaces the whole config and must restate them`,
      )
    })
  })
})
