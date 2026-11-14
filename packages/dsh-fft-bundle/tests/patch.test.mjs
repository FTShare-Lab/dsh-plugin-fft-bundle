/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list, and every inserted row must
 * be wired by a dependency of this package.
 *
 * It also guards the client-half plane, which no other check can see. DSH's
 * browser module scan walks the ROOT loader's entries only, and a preset
 * mounts its rows in a detached subtree that is absent from
 * `ctx.loader.entries()` — so a preset row whose package declares `dsh.client`
 * reaches the host half and silently loses its browser half (report cards,
 * the session "报告" view, the sidebar tab). The package root therefore has to
 * carry the browser half from a global row, and a preset row may only name a
 * subpath entry that registers host-side behaviour.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { load } from 'js-yaml'
import { schema } from './lib/patch-yaml.mjs'
import { PUBLISH_TARGETS, publishManifest, readWorkspace } from '../../../scripts/pack-npm.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const patchPath = resolve(root, manifest.dsh.bundle.patch)

/**
 * The intranet rows live in a second patch file of this package, which only the
 * internal tarball declares. The public npm artifact does not ship it (`files`
 * excludes it), so nothing in that layer can reach a public install.
 */
const INTRANET_PATCH = resolve(root, 'cordis.intranet.patch.yml')

/**
 * Rows of the intranet layer, read from the file itself.
 *
 * Nothing here names those packages literally: the public branch carries neither
 * this file nor those plugin names, and any literal would make the public tree
 * fail its no-internal-names gate. An absent file means an empty layer, which
 * every assertion below treats as "nothing to check".
 */
const intranetPatchRows = existsSync(INTRANET_PATCH)
  ? load(readFileSync(INTRANET_PATCH, 'utf8'), { schema }).flatMap(patch => patch.insert ?? [])
  : []
/**
 * Plugin packages the intranet layer mounts and this bundle depends on. Host
 * packages (`@deepseek-ai/*`) the layer also names are supplied by the
 * installation, so they carry no edge and are not what this file is about.
 */
const INTRANET_PACKAGES = intranetPatchRows
  .map(row => row.name)
  .filter(name => typeof name === 'string' && manifest.dependencies?.[name] !== undefined)
/** Row ids the intranet layer inserts. */
const INTRANET_ROW_IDS = intranetPatchRows.map(row => row.id).filter(id => typeof id === 'string')

/**
 * Packages the DSH installation supplies to every profile, so a row may name
 * one without this bundle depending on it. The row's `name` is resolved at
 * boot against the app's own installation first.
 */
const HOST_PACKAGES = new Set([
  '@deepseek-ai/dsh-mcp-client',
  // The finance preset row names the official preset plugin; the app supplies it.
  '@deepseek-ai/dsh-agent-preset',
])

/** Recipe for a checkout whose dependencies are not installed yet. */
const INSTALL_RECIPE = 'run `pnpm install` (the guards read each dependency\'s package.json)'

/**
 * The bare package-root specifier `specifier` names, or `undefined` for a
 * subpath, a path, or any scheme-qualified specifier (`cordis:` builtins,
 * `node:` modules, URLs).
 *
 * The same boundary DSH draws in
 * `packages/client/modules/src/client/manifest.ts` (`exactPackageSpecifier`):
 * a subpath row never produces a browser module source, so only a bare name
 * can carry a package's client half.
 * @param specifier - a Loader row name.
 * @returns the package name, or `undefined`.
 */
function barePackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined
  }
  return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':') ? specifier : undefined
}

/**
 * Read a package's manifest as this bundle would resolve it at boot.
 *
 * The manifest is read straight out of the `node_modules` directory that holds
 * it (walking up from this package, so both an isolated and a hoisted layout
 * work). Resolving through `require.resolve` would fail for packages that do
 * not export `./package.json` — one of our own dependencies does not.
 * @param name - package name to resolve.
 * @returns the parsed manifest, or `null` when the package is not installed here.
 */
function readManifest(name) {
  for (let dir = root; ; dir = dirname(dir)) {
    const file = resolve(dir, 'node_modules', name, 'package.json')
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
    if (dirname(dir) === dir) return null
  }
}

/**
 * Whether a manifest publishes a browser module.
 *
 * An empty `dsh.client.inject` is still a declaration — the package ships a
 * client bundle and DSH composes a module row for it.
 * @param pkg - a parsed package manifest, or `null`.
 * @returns `true` when the package declares `dsh.client`.
 */
function declaresClient(pkg) {
  return pkg?.dsh?.client !== undefined && pkg.dsh.client !== null
}

/** Manifests of every declared dependency, keyed by package name (`null` when unreadable). */
function dependencyManifests() {
  const names = Object.keys(manifest.dependencies ?? {})
  return new Map(names.map(name => [name, readManifest(name)]))
}

const parsedPatch = load(readFileSync(patchPath, 'utf8'), { schema })
/** Rows on the global plane: direct children of a top-level `insert`. */
const globalRows = parsedPatch.flatMap(patch => patch.insert ?? [])

describe('dsh-fft-bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(existsSync(patchPath))
    assert.ok(Array.isArray(parsedPatch), 'patch must parse to a patch list')
    const rows = parsedPatch.flatMap(patch => patch.insert ?? [])
    assert.ok(rows.length > 0, 'patch must insert at least one plugin row')
    for (const row of rows) {
      assert.equal(typeof row.id, 'string', `row ${row.id} needs a string id`)
      assert.equal(typeof row.name, 'string', `row ${row.id} needs a string name`)
      // The bundle's own row names this package, which is not its own dependency.
      const wired = manifest.dependencies[row.name] !== undefined
        || HOST_PACKAGES.has(row.name)
        || row.name === manifest.name
      assert.ok(wired, `row ${row.id} names ${row.name} but it is not a dependency`)
    }
  })

  /**
   * The SSO plugin reads its deployment config once at startup and refuses to
   * open an authorization window without it. The row now lives in the intranet
   * layer, so this asserts on that file instead of the public patch.
   */
  it('supplies the SSO deployment config in the intranet layer', t => {
    // Absent on the public branch, where the intranet layer is not tracked at
    // all: nothing there reads this config, so there is nothing to assert.
    if (!existsSync(INTRANET_PATCH)) return t.skip('intranet layer not present in this tree')
    // Located by what the row must carry, not by name: that keeps this file free
    // of the plugin's name, which the public branch must not contain.
    const row = intranetPatchRows.find(entry => typeof entry.config?.redirectUri === 'string')
    assert.ok(row, 'the SSO row must be inserted by the intranet layer')
    const config = row.config
    assert.ok(config, 'the SSO row must carry the deployment config')
    // Shape, not the literal hosts: this file also ships on the public branch,
    // where those hosts must not appear at all. The values themselves live in
    // the intranet layer, which is what the row above just read.
    for (const key of ['baseUrl', 'redirectUri']) {
      assert.match(config[key], /^https:\/\//u, `${key} must be the registered public URL`)
    }
    assert.ok(
      config.redirectUri.startsWith(config.baseUrl),
      'the redirect URI must sit under the deployment the row names',
    )
  })

  /**
   * The public artifact is this package's `files` whitelist plus its declared
   * patch. An intranet row or package name in either one would ship a plugin the
   * public channel must never carry — and would break `dsh plugin add` for a
   * registry install, because the name resolves to nothing there.
   */
  it('keeps every intranet-only row out of the public patch', () => {
    const publicPatch = readFileSync(patchPath, 'utf8')
    for (const name of INTRANET_PACKAGES) {
      assert.ok(!publicPatch.includes(name), `${name} must not be inserted by ${patchPath}`)
    }
    for (const id of INTRANET_ROW_IDS) {
      const found = globalRows.some(row => row.id === id)
      assert.ok(!found, `intranet row ${id} must live in ${INTRANET_PATCH}, not ${patchPath}`)
    }
  })

  /**
   * A dependency edge alone installs nothing: DSH mounts what a patch row names.
   * The internal tarball needs the edges (it inlines those two packages), but the
   * public artifact must not carry them, or `npm install` fails on a name no
   * registry serves.
   */
  it('drops the intranet edges from the published manifest', t => {
    if (!INTRANET_PACKAGES.some(name => manifest.dependencies[name] !== undefined)) {
      return t.skip('this tree has no intranet edges (public branch)')
    }
    const target = PUBLISH_TARGETS.find(entry => entry.dir.endsWith('dsh-fft-bundle'))
    const published = publishManifest(manifest, { workspace: readWorkspace(), dropDependencies: target.dropDependencies })
    for (const name of INTRANET_PACKAGES) {
      assert.equal(published.dependencies[name], undefined, `${name} must not reach the published manifest`)
    }
  })

  /**
   * Guard 1 of the client-half plane: every dependency that ships a browser
   * module needs a global row naming its bare package root.
   *
   * Why: DSH composes `window.__DSH_BOOT__` from `ctx.loader.entries()` —
   * the ROOT loader only (`packages/client/modules/src/index.ts`). A preset
   * mounts its rows in a detached `EntryTree` that keeps `subtree`/`subgroup`
   * off the owning entry (`packages/preset/agent-preset-registry/src/mount.ts`),
   * so a preset row's package is never scanned and its browser half never
   * loads — with no error anywhere. The root row is what makes the package
   * discoverable; the preset row then contributes only host-side behaviour.
   */
  it('gives every dependency with a browser half a bare-name global row', t => {
    const manifests = dependencyManifests()
    const resolvable = [...manifests.values()].filter(pkg => pkg !== null)
    // Nothing installed means nothing was checked, so say so instead of passing:
    // the guards read each dependency's manifest, not this package's own patch.
    if (resolvable.length === 0) return t.skip(INSTALL_RECIPE)
    const unreadable = [...manifests].filter(([, pkg]) => pkg === null).map(([name]) => name)
    // This repository's own packages are workspace links: their absence means
    // the checkout is not installed, not that the invariant is satisfied.
    assert.deepEqual(
      unreadable.filter(name => name.startsWith('@ft/')),
      [],
      `${INSTALL_RECIPE}; unreadable: ${unreadable.join(', ')}`,
    )

    // The client half is carried by whichever layer inserts the row. The
    // intranet file is a second patch file of this same bundle, applied by the
    // only artifact that ships it, so it counts here.
    const intranetRows = intranetPatchRows
    const bareGlobalNames = new Set(
      [...globalRows, ...intranetRows].map(row => barePackageSpecifier(row.name)).filter(Boolean),
    )
    const missing = []
    for (const [name, pkg] of manifests) {
      if (!declaresClient(pkg)) continue
      if (!bareGlobalNames.has(name)) missing.push(name)
    }
    assert.deepEqual(
      missing,
      [],
      `these dependencies declare dsh.client but no global insert row names them by bare package `
      + `name, so their browser half (report card, session view, sidebar tab) silently never loads: `
      + `${missing.join(', ')}. Add an insert row \`- id: <id>\\n  name: '${missing[0] ?? ''}'\` to `
      + `${patchPath}, and keep any preset row on a subpath entry instead.`,
    )
  })

  /**
   * Guard 2 of the client-half plane: a preset row must never name a bare
   * package root of a package that declares `dsh.client`.
   *
   * Same reason as guard 1, from the other side: the row would mount into an
   * unscanned subtree, so the package's browser half is unreachable while the
   * host half looks healthy — the exact silent failure this pair of guards
   * exists to prevent. A subpath entry (`<pkg>/agent`) never produces a
   * browser module source, so it is the correct home for preset-scoped
   * host-side registrations.
   */
  it('keeps browser-half packages out of the preset, except through a subpath entry', () => {
    const preset = globalRows.find(row => row.id === 'preset-ft-finance')
    assert.ok(preset?.config?.plugins, `${patchPath} must insert "preset-ft-finance" with a plugins list`)
    const offenders = []
    for (const row of preset.config.plugins) {
      const bare = barePackageSpecifier(row.name ?? '')
      if (bare === undefined) continue
      const pkg = readManifest(bare)
      if (pkg === null) continue
      if (declaresClient(pkg)) offenders.push(`${row.id} → ${row.name}`)
    }
    assert.deepEqual(
      offenders,
      [],
      `a preset mounts its rows in a subtree DSH's browser module scan never visits, so these rows `
      + `would load only their host half and silently drop their browser half: ${offenders.join(', ')}. `
      + `Mount the browser half from a bare-name GLOBAL row and give this row a subpath entry `
      + `that registers host-side behaviour only. `
      + `The official 'standard' preset names no package with a dsh.client declaration, which is why `
      + `this rule costs the copied rows nothing.`,
    )
  })
})
