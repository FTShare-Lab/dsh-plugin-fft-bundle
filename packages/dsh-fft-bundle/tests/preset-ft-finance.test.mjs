/**
 * The finance preset mirrors the official `standard` composition of the
 * **lowest supported host**, DSH 0.2.2-rc.1 — not whatever checkout happens
 * to be on the developer's disk.
 *
 * A preset's `plugins` list is complete: it inherits nothing. Since this
 * bundle requires 0.2.2-rc.1 the whole delegated surface follows that host:
 * one `tool-subagent-control` instance registers send_message, interrupt_agent
 * and list_agents (0.2.2 folded the `/list-agents` subpath into it), and the
 * spawn tool carries the host's model-selection keys. The preset still keeps
 * the 0.2.0-era tooling surface: the rows 0.2.2 added to `standard` stay
 * omitted and are recorded in FLOOR_OMITTED_ROWS. Two guards therefore run:
 *
 * 1. the floor: the composition equals the `dsh-v0.2.2-rc.1` tag's preset,
 *    row for row, except the omitted rows above;
 * 2. the current host: every divergence from the reachable `standard`
 *    composition is one of the deltas recorded below, so a later host bump
 *    fails loudly instead of silently widening the compatibility gap.
 *
 * The official file is not tracked here — `thirdparty/` is ignored, and the
 * public branch ships no harness checkout at all. The floor is read from the
 * checkout's git tag; the current host falls back through the layouts a
 * developer machine can offer, and each guard skips with a recipe when its
 * source is unreachable.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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
  'ft-ftshare-tools',
  'ft-ftshare-mask',
  'ft-ftshare-project',
  'dsh-fft-factor-intake-standard',
]
/**
 * Rows that must stay on the global plane, whatever the preset does.
 *
 * `dsh-fft-ftshare` is the FTShare service provider: a `provide` inside a preset
 * throws ("Preset services require isolate realms"), and isolating it would hide
 * the service from every plugin outside the preset.
 */
const GLOBAL_ROWS = ['dsh-fft-settings', 'dsh-fft-ftshare', 'newapi-wechat-sso', 'dsh-kline-sidebar', 'ft-research-cockpit']
/**
 * Rows that must mount only from inside the finance preset.
 *
 * The last three are the FTShare tool surface, the kline FTShare-wrapper mask and
 * the P7/P8 projection hook: all of them must be absent from the standard mode,
 * which is exactly what mounting them from the preset (and nowhere else) buys.
 */
const PRESET_ONLY_ROWS = ['mcp-dsh-kline', 'ft-ftshare-tools', 'ft-ftshare-mask', 'ft-ftshare-project', 'dsh-fft-factor-intake-standard']
/** The host tag whose composition is the compatibility floor. */
const FLOOR_TAG = 'dsh-v0.2.2-rc.1'
/** The floor composition size at that tag; growing requires a re-sync. */
const FLOOR_PLUGIN_COUNT = 22
/** Floor rows this preset deliberately omits (it keeps the 0.2.0-era surface). */
const FLOOR_OMITTED_ROWS = ['time-context', 'tool-schedule']
/** Floor rows this bundle deliberately no longer carries. */
const RETIRED_FLOOR_ROWS = []
/** Rows the reachable host's standard carries and this preset omits. */
const CURRENT_ADDED_ROWS = ['tool-plugin-market']
/**
 * Rows inside a group the reachable host dropped while this preset keeps them.
 *
 * The rows are gone from the floor composition too: `tool-subagent-codex` and
 * `tool-subagent-claude-code` left `delegation` in 0.2.1, and the floor tag no
 * longer declares the group at all. They stay disabled so the 0.2.0-era
 * delegation surface keeps them addressable without activating them.
 */
const CURRENT_DROPPED_ROWS = ['tool-subagent-codex', 'tool-subagent-claude-code']

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
  return { label, dir: webAppDir, read: relative => readIfPresent(webAppDir, relative) }
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
      resolve(root, '../../../thirdparty/deepseek-harness/packages/bundle/web-app'),
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

/**
 * Read a file from a git ref of the checkout a directory source points at.
 * @param webAppDir - the `packages/bundle/web-app` directory.
 * @param relative - path relative to that directory.
 * @param ref - tag or commit to read.
 * @returns the file's text, or `null` when git or the ref is unavailable.
 */
function gitShow(webAppDir, relative, ref) {
  try {
    const repo = resolve(webAppDir, '../../..')
    if (!existsSync(resolve(repo, '.git'))) return null
    return execFileSync(
      'git',
      ['-C', repo, 'show', `${ref}:packages/bundle/web-app/${relative}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch {
    return null
  }
}

/**
 * The compatibility floor's preset: the official composition at `FLOOR_TAG`.
 *
 * Reading the tag rather than the working tree is what keeps this guard
 * meaningful after the checkout moves to a newer host.
 * @returns `{ label, preset }`, or `null` when no checkout carries the tag.
 */
function findFloor() {
  for (const source of upstreamSources()) {
    if (!source.dir) continue
    const preset = gitShow(source.dir, PRESET_FILE, FLOOR_TAG)
    if (preset) return { label: `${source.dir} @ ${FLOOR_TAG}`, preset }
  }
  return null
}

const isRow = value => value !== null && typeof value === 'object' && typeof value.id === 'string'

/**
 * Compare two row lists by id, so a row inserted or retired upstream does not
 * shift every following index and turn one change into a hundred differences.
 * @param expected - official rows.
 * @param actual - bundle rows.
 * @param path - key path of the list, used in the messages.
 * @param options - `dropped`/`added` id sets and an `except` predicate.
 * @returns human-readable differences; empty means the lists agree.
 */
function diffRowLists(expected, actual, path, options = {}) {
  const dropped = options.dropped ?? new Set()
  const added = options.added ?? new Set()
  const except = options.except ?? (() => false)
  const expectedIds = expected.map(row => row.id)
  const actualIds = actual.map(row => row.id)
  const drift = []

  for (const id of expectedIds) {
    if (dropped.has(id)) {
      if (actualIds.includes(id)) drift.push(`${path}: retired row "${id}" is still present`)
      continue
    }
    if (!actualIds.includes(id)) drift.push(`${path}: missing row "${id}"`)
  }
  for (const id of actualIds) {
    if (!expectedIds.includes(id) && !added.has(id)) drift.push(`${path}: unexpected row "${id}"`)
  }

  const expectedOrder = expectedIds.filter(id => !dropped.has(id) && actualIds.includes(id))
  const actualOrder = actualIds.filter(id => expectedIds.includes(id) && !dropped.has(id))
  if (expectedOrder.join('\0') !== actualOrder.join('\0')) {
    drift.push(`${path}: row order changed (official ${expectedOrder.join(', ')}; bundle ${actualOrder.join(', ')})`)
  }

  for (const id of expectedOrder) {
    const at = actualIds.indexOf(id)
    drift.push(...diffRow(
      expected.find(row => row.id === id),
      actual[at],
      `${path}[${at}]`,
      options,
    ))
  }
  return drift
}

/**
 * Compare two rows, descending into a `config` array when it is itself a row
 * list (the delegation group), and into a quoted name list otherwise.
 * @param expected - official row.
 * @param actual - bundle row.
 * @param path - key path of the row, used in the messages.
 * @param options - forwarded to `diffRowLists`.
 * @returns human-readable differences; empty means the rows agree.
 */
function diffRow(expected, actual, path, options = {}) {
  const expectedConfig = expected.config
  const actualConfig = actual.config
  const expectedRows = Array.isArray(expectedConfig) && expectedConfig.every(isRow)
  const actualRows = Array.isArray(actualConfig) && actualConfig.every(isRow)
  const except = options.except ?? (() => false)

  if (!expectedRows && !actualRows) {
    return diffRows(expected, actual, path)
      .filter(difference => !except(expected.id, path, difference))
  }

  const expectedRest = { ...expected }
  const actualRest = { ...actual }
  delete expectedRest.config
  delete actualRest.config
  const drift = diffRows(expectedRest, actualRest, path)
    .filter(difference => !except(expected.id, path, difference))
  if (expectedRows !== actualRows) {
    drift.push(`${path}.config: kind changed (official ${expectedRows ? 'row list' : 'value'}, bundle ${actualRows ? 'row list' : 'value'})`)
    return drift
  }
  drift.push(...diffRowLists(expectedConfig, actualConfig, `${path}.config`, options))
  return drift
}

const upstream = findUpstream()
const floor = findFloor()
const SKIP_REASON = `cannot reach the official ${PRESET_FILE}: set DSH_UPSTREAM_PRESET to that file, or DSH_HARNESS_ROOT to a harness checkout, to run the drift guard`
const FLOOR_SKIP_REASON = `cannot read ${FLOOR_TAG}:${PRESET_FILE} from a git checkout; run "git fetch --tags" in thirdparty/deepseek-harness, or set DSH_HARNESS_ROOT to one that has the tag`
/** Passed to every test that needs the official file, so an unreachable copy skips with the recipe. */
const skipUnreachable = upstream === null && SKIP_REASON
/** The floor guard needs a checkout that still carries the tag. */
const skipFloor = floor === null && FLOOR_SKIP_REASON

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

  it('appends exactly the seven finance rows, each id once', () => {
    const appended = bundlePlugins.slice(bundlePlugins.length - ADDED_PLUGINS.length).map(row => row.id)
    assert.deepEqual(
      appended,
      ADDED_PLUGINS,
      `the "${PRESET_ID}" composition must end with the seven finance rows, in this order`,
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

  describe('against the host floor composition', () => {
    const floorPatch = floor ? load(floor.preset, { schema }) : null
    /**
     * The persona identity is this bundle's one intended rewrite: the prefix
     * becomes the FT identity, and the `{{cwd}}` suffix is dropped because
     * DSH 0.2.1 rejects that unregistered variable.
     */
    const personaException = (id, path, difference) => id === PERSONA_ID
      && (difference.startsWith(`${path}.config.prefix:`)
        || difference.startsWith(`${path}.config.suffix:`))
    /**
     * The host dropped `toolFilter` support: DSH 0.2.1-rc.3 rejects the field
     * while validating a preset ("toolFilter is no longer supported"), which
     * makes the whole preset disappear. The alpha.1 floor composition still
     * carries it on the subagent rows, so the preset intentionally omits it.
     */
    const SUBAGENT_ROWS = ['tool-subagent', 'tool-subagent-fork']
    const toolFilterException = (id, path, difference) => SUBAGENT_ROWS.includes(id)
      && difference.startsWith(`${path}.config.toolFilter`)

    /** The floor's rows, or an empty list while its source is unreachable (the guards below skip then). */
    const floorRows = floor === null ? [] : requirePlugins(floorPatch, UPSTREAM_PRESET_ID, floor.label)
    /** The floor declares the `delegation` group only while it still ships it. */
    const floorCarriesDelegation = floorRows.some(row => row.id === 'delegation')
    /** Floor rows this preset does not mirror: retired rows plus the recorded group leftovers. */
    const floorDropped = () => new Set([
      ...RETIRED_FLOOR_ROWS,
      ...FLOOR_OMITTED_ROWS,
      ...(floorCarriesDelegation ? [] : CURRENT_DROPPED_ROWS),
    ])

    it('is pinned to the floor composition size', { skip: skipFloor }, () => {
      const official = floorRows
      assert.equal(
        official.length,
        FLOOR_PLUGIN_COUNT,
        `the ${FLOOR_TAG} standard preset changed size (${FLOOR_PLUGIN_COUNT} → ${official.length}); re-sync "${PRESET_ID}" and update this count`,
      )
      assert.equal(
        bundlePlugins.length,
        official.length - floorDropped().size + ADDED_PLUGINS.length,
        `"${PRESET_ID}" must hold the ${official.length} floor rows minus the ${floorDropped().size} not mirrored, plus the ${ADDED_PLUGINS.length} finance rows`,
      )
    })

    it('mirrors the floor composition, field for field', { skip: skipFloor }, () => {
      const official = floorRows
      const drift = diffRowLists(official, bundlePlugins, 'config.plugins', {
        dropped: floorDropped(),
        added: new Set(ADDED_PLUGINS),
        // A group the floor does not declare is compared by its rows alone.
        except: (id, path, difference) => personaException(id, path, difference)
          || toolFilterException(id, path, difference)
          || (!floorCarriesDelegation && id === 'delegation' && difference.includes('.config:') && difference.includes('missing row')),
      })
      assert.deepEqual(
        drift,
        [],
        `"${PRESET_ID}" drifted from ${floor.label} ("${UPSTREAM_PRESET_ID}"); only the persona prefix and suffix may differ, and only ${[...RETIRED_FLOOR_ROWS, ...FLOOR_OMITTED_ROWS].join(', ')} may be absent`,
      )
    })

    it('replaces the persona identity, and nothing else about that row', { skip: skipFloor }, () => {
      const official = floorRows
      const index = official.findIndex(row => row.id === PERSONA_ID)
      assert.ok(index !== -1, `${floor.label} must declare a "${PERSONA_ID}" plugin`)
      const upstreamPersona = official[index]
      const bundlePersona = bundlePlugins.find(row => row.id === PERSONA_ID)
      assert.ok(bundlePersona, `"${PRESET_ID}" must declare a "${PERSONA_ID}" plugin`)

      const path = `config.plugins[${index}]`
      const differences = diffRows(upstreamPersona, bundlePersona, path).map(difference => difference.split(':')[0])
      assert.deepEqual(
        differences.sort(),
        [`${path}.config.prefix`, `${path}.config.suffix`].sort(),
        `the "${PERSONA_ID}" row may differ from the official one only in config.prefix and the dropped config.suffix`,
      )
      assert.equal(
        bundlePersona.config.suffix,
        undefined,
        `"${PERSONA_ID}.config.suffix" must stay dropped; DSH 0.2.1 rejects "{{cwd}}" before a request is built`,
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
  })

  describe('against the reachable host composition', () => {
    const officialPatch = upstream ? load(upstream.preset, { schema }) : null

    it('records every newer-host delta instead of mirroring it', { skip: skipUnreachable }, () => {
      const official = requirePlugins(officialPatch, UPSTREAM_PRESET_ID, upstream.label)
      const officialIds = official.map(row => row.id)
      const bundleIds = bundlePlugins.map(row => row.id)

      // The reachable host's rows this preset does not carry: the omissions it
      // keeps on purpose, then the deltas recorded against the reachable host.
      // The omissions are always expected, so a host that stops shipping them
      // shows up here instead of hiding behind the delta list.
      const reachableMissing = officialIds.filter(id => !bundleIds.includes(id))
      const recorded = new Set([...FLOOR_OMITTED_ROWS, ...CURRENT_ADDED_ROWS])
      assert.deepEqual(
        reachableMissing.filter(id => !recorded.has(id)),
        [],
        `the host standard preset added rows this bundle does not carry; decide per row whether ${FLOOR_TAG} can load it, then record it in CURRENT_ADDED_ROWS`,
      )
      assert.deepEqual(
        bundleIds.filter(id => !officialIds.includes(id) && !ADDED_PLUGINS.includes(id)),
        [],
        `"${PRESET_ID}" carries a top-level row the reachable host no longer ships`,
      )

      const shared = officialIds.filter(id => bundleIds.includes(id))
      assert.deepEqual(
        bundleIds.filter(id => shared.includes(id)),
        shared,
        `"${PRESET_ID}" reordered the rows it shares with ${upstream.label}`,
      )

      const upstreamDelegation = official.find(row => row.id === 'delegation')
      const bundleDelegation = bundlePlugins.find(row => row.id === 'delegation')
      assert.ok(upstreamDelegation && bundleDelegation, 'both compositions must declare the "delegation" group')
      const upstreamNested = upstreamDelegation.config.map(row => row.id)
      const bundleNested = bundleDelegation.config.map(row => row.id)
      assert.deepEqual(
        upstreamNested.filter(id => !bundleNested.includes(id)),
        [],
        `the host "delegation" group added a row that the floor composition lacks`,
      )
      const nestedExtra = bundleNested.filter(id => !upstreamNested.includes(id))
      assert.deepEqual(
        nestedExtra.filter(id => !CURRENT_DROPPED_ROWS.includes(id)),
        [],
        `the bundle "delegation" group keeps a row the host dropped without recording it in CURRENT_DROPPED_ROWS`,
      )
      for (const id of nestedExtra) {
        const row = bundleDelegation.config.find(entry => entry.id === id)
        assert.equal(
          row.disabled,
          true,
          `"${id}" is absent from the reachable host, so it must stay disabled`,
        )
      }
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
