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
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { load } from 'js-yaml'
import { schema } from './lib/patch-yaml.mjs'
import { context, diffRows, evaluate } from './lib/patch-compare.mjs'

/** Rows this bundle must mirror from the kline package. */
const MIRRORED_ROWS = ['mcp-dsh-kline', 'dsh-kline-sidebar']

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

  it('declares the kline dependency', () => {
    assert.equal(
      manifest.dependencies['@ftshare-lab/dsh-kline'],
      'git+ssh://git@github.com/FTShare-Lab/dsh_kline.git#v0.3.5',
      'the kline dependency must stay a pinned tag',
    )
  })

  for (const id of MIRRORED_ROWS) {
    it(`mirrors the upstream "${id}" row`, () => {
      const upstream = klineRows.get(id)
      assert.ok(upstream, `${klinePatch} must insert a "${id}" row`)
      const bundleRow = bundleRows.get(id)
      assert.ok(bundleRow, `this bundle's patch must insert a "${id}" row`)

      const differences = diffRows(upstream, bundleRow, id)
      assert.deepEqual(differences, [], `the "${id}" row drifted from the kline package`)
    })
  }

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
      assert.deepEqual(mirrored.config, upstream.config, `the "${id}" row resolves differently`)
    }
  })
})
