/**
 * The kline rows in this bundle's patch are a copy of the two rows the kline
 * package inserts from its own `cordis.patch.yml`.
 *
 * The loader composes only the layers named in `dsh.profile.bundles`, and it
 * never loads a dependency's own patch transitively: installing kline as a
 * dependency of this bundle places its code in `node_modules` while leaving
 * its patch dead. The rows therefore have to be duplicated here, and this test
 * is what keeps the copy honest — an upstream edit to either row fails this
 * repo's test run instead of silently shipping a stale row.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { load } from 'js-yaml'
import { schema } from './lib/patch-yaml.mjs'
import { context, diffRows, evaluate } from './lib/patch-compare.mjs'

/** Rows this bundle must mirror from the kline package. */
const MIRRORED_ROWS = ['mcp-dsh-kline', 'dsh-kline-sidebar']

/**
 * The one row this bundle deliberately does not copy verbatim, and the fields
 * allowed to differ.
 *
 * Upstream builds kline's directory from `ctx.baseUrl` — the profile's
 * `cordis.yml` — which only reaches a top-level
 * `node_modules/@ftshare-lab/dsh-kline`. That is where a git or registry
 * install hoists the package, but a tarball install nests it inside this
 * bundle, so the derived `cwd` does not exist and `spawn` fails with a bare
 * `ENOENT`. Our copy runs `scripts/kline-mcp.mjs` from this package's own
 * directory instead — present in every layout — and the shim resolves kline
 * from there. The field list is what keeps the exception honest: any other
 * difference in this row still fails, and the checks below pin what the fields
 * have to resolve to.
 *
 * `env.DSH_KLINE_PACKAGE_ROOT` is forwarded because the MCP client scrubs every
 * `DSH_*` name out of the child environment: the shim reads the override, so
 * the row has to pass the host's value on.
 *
 * Upstream also names the row after its own launcher
 * (`./scripts/dsh-mcp-plugin.mjs`), which resolves Python from wherever the
 * kline package sits. This bundle keeps naming `@deepseek-ai/dsh-mcp-client` and
 * runs its own shim instead, so `name` is an allowed difference alongside the
 * config fields. Everywhere else the row still has to match verbatim.
 */
const OVERRIDDEN = new Map([['mcp-dsh-kline', ['name', 'config.args', 'config.cwd', 'config.env.DSH_KLINE_PACKAGE_ROOT']]])

/**
 * Key paths of the fields one row may differ in.
 *
 * Paths are rooted at the row id, so a top-level field is `<id>.<field>` while a
 * config field is `<id>.config.<field>`. Entries name the field the way the row
 * declares it, without the `<id>.` prefix.
 * @param id - row id.
 * @returns dotted field paths allowed to differ.
 */
function overridePaths(id) {
  return (OVERRIDDEN.get(id) ?? []).map(field => `${id}.${field}`)
}

/**
 * A copy of one evaluated row config without the overridden fields.
 * @param config - evaluated row config.
 * @param fields - dotted field paths to drop.
 * @returns the config with those fields removed.
 */
function withoutFields(config, fields) {
  const copy = structuredClone(config)
  for (const field of fields) {
    const keys = field.split('.')
    const last = keys.pop()
    const parent = keys.reduce((value, key) => value?.[key], copy)
    if (parent !== undefined) delete parent[last]
  }
  return copy
}

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const patchPath = resolve(root, manifest.dsh.bundle.patch)

/**
 * Locate the installed kline package's patch.
 *
 * The dependency is a git spec, so pnpm materializes it under whichever
 * `node_modules` it chooses; `import.meta.resolve` from this package follows
 * that placement, and the explicit fallbacks cover a pnpm store layout and the
 * sibling checkout used for development. A missing package is a failure rather
 * than a skip: the whole point of this test is the comparison.
 * @returns absolute path of kline's `cordis.patch.yml`.
 */
function findKlinePatch() {
  const candidates = []
  if (process.env.DSH_KLINE_PACKAGE_ROOT) {
    candidates.push(resolve(process.env.DSH_KLINE_PACKAGE_ROOT, 'cordis.patch.yml'))
  }
  try {
    const require = createRequire(import.meta.url)
    candidates.push(resolve(dirname(require.resolve('@ftshare-lab/dsh-kline/package.json')), 'cordis.patch.yml'))
  } catch {
    // Not installed in a place Node's resolver reaches; try the known layouts.
  }
  candidates.push(
    resolve(root, 'node_modules/@ftshare-lab/dsh-kline/cordis.patch.yml'),
    resolve(root, '../../../node_modules/@ftshare-lab/dsh-kline/cordis.patch.yml'),
    resolve(root, '../../../../dsh-ft/submodules/dsh_kline/cordis.patch.yml'),
  )
  const found = candidates.find(candidate => existsSync(candidate))
  assert.ok(
    found,
    'cannot find @ftshare-lab/dsh-kline; install the workspace (pnpm install) or set DSH_KLINE_PACKAGE_ROOT to the package directory',
  )
  return found
}

/**
 * Rows the patch declares, wherever they sit: a top-level insert, a nested
 * `cordis:group` list, or an agent preset's `plugins` composition. The kline
 * MCP row lives inside `preset-ft-finance` so that only that mode mounts it.
 * @param path - patch file to read.
 * @returns rows keyed by id.
 */
function rowsOf(path) {
  const parsed = load(readFileSync(path, 'utf8'), { schema })
  const rows = []
  const collect = (list) => {
    for (const row of list) {
      rows.push(row)
      if (Array.isArray(row.config)) collect(row.config)
      else if (Array.isArray(row.config?.plugins)) collect(row.config.plugins)
    }
  }
  for (const patch of parsed) collect(patch.insert ?? [])
  return new Map(rows.map(row => [row.id, row]))
}

describe('kline rows mirrored from the kline package', () => {
  const klinePatch = findKlinePatch()
  const bundleRows = rowsOf(patchPath)
  const klineRows = rowsOf(klinePatch)

  // The dependency edge itself is guarded by `third-party-edges.test.mjs`,
  // which accepts either the upstream tag or the fork build tagged onto it.
  // Pinning the exact address here as well would only duplicate that fact.

  for (const id of MIRRORED_ROWS) {
    it(`mirrors the upstream "${id}" row`, () => {
      const upstream = klineRows.get(id)
      assert.ok(upstream, `${klinePatch} must insert a "${id}" row`)
      const bundleRow = bundleRows.get(id)
      assert.ok(bundleRow, `this bundle's patch must insert a "${id}" row`)

      const allowed = overridePaths(id)
      const differences = diffRows(upstream, bundleRow, id)
        .filter(difference => !allowed.some(path => difference.startsWith(path)))
      assert.deepEqual(differences, [], `the "${id}" row drifted from the kline package outside ${allowed.join(', ') || 'any field'}`)
    })
  }

  it('launches kline from this package in both install layouts', () => {
    const mirrored = evaluate(bundleRows.get(MIRRORED_ROWS[0]), context())
    // `cwd` has to be this package: a tarball install nests kline inside it, and
    // the profile directory — the only base a `!!js` scalar can reach — is its
    // parent in every layout. Checked by shape so the assertion holds whatever
    // the profile is called.
    assert.ok(
      mirrored.config.cwd.replaceAll('\\', '/').endsWith('node_modules/@ft/dsh-fft-bundle/'),
      `the kline MCP row must run from this package, not ${mirrored.config.cwd}`,
    )
    assert.deepEqual(mirrored.config.args, ['scripts/kline-mcp.mjs'])
    assert.ok(existsSync(resolve(root, 'scripts', 'kline-mcp.mjs')), 'the shim the row launches must exist')

    // The win32 branch cannot be exercised here, so pin the parts that make it
    // work: `new URL(...).pathname` yields `/C:/…`, which Windows cannot resolve.
    const source = bundleRows.get(MIRRORED_ROWS[0]).config.cwd.source
    assert.match(source, /platform === 'win32'/, 'the cwd expression must keep the win32 drive-letter handling')
    assert.match(source, /slice\(1\)/, 'the win32 branch must strip the leading slash')
  })

  it('evaluates every mirrored expression through the upstream context', () => {
    const ctx = context()
    for (const id of MIRRORED_ROWS) {
      // Evaluating proves each `!!js` scalar runs with only `ctx` and `process`
      // in scope; comparing the results proves both copies resolve the same
      // package root. A row without a config is a plain plugin row and only
      // has to evaluate at all.
      const upstream = evaluate(klineRows.get(id), ctx)
      const mirrored = evaluate(bundleRows.get(id), ctx)
      assert.equal(mirrored.id, id)
      if (upstream.config === undefined) {
        assert.equal(mirrored.config, undefined, `the "${id}" row must not gain a config`)
        continue
      }
      // An overridden row is compared outside its declared fields: they are the
      // redirect itself, checked by the test above. `name` is not part of a
      // config, so only the `config.` entries narrow this comparison.
      const fields = OVERRIDDEN.get(id) ?? []
      const configFields = fields.filter(field => field.startsWith('config.')).map(field => field.slice('config.'.length))
      assert.deepEqual(
        withoutFields(mirrored.config, configFields),
        withoutFields(upstream.config, configFields),
        `the "${id}" row resolves differently outside ${configFields.join(', ') || 'any field'}`,
      )
    }
  })
})
