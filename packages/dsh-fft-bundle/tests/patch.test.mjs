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

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const patchPath = resolve(root, manifest.dsh.bundle.patch)

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
      const wired = manifest.dependencies[row.name] !== undefined
        || HOST_PACKAGES.has(row.name)
      assert.ok(wired, `row ${row.id} names ${row.name} but it is not a dependency`)
    }
  })

  /**
   * The plugin reads its deployment config once at startup and refuses to open
   * an authorization window without it. Nothing else reaches every install —
   * profile patches and `$DSH_HOME/cordis.patch.yml` are per-machine, and the
   * installer's settings.yaml template is copied only when absent — so the two
   * public URLs must stay on this row.
   */
  it('supplies the NewAPI deployment config the plugin requires', () => {
    const row = globalRows.find(entry => entry.id === 'newapi-wechat-sso')
    assert.ok(row, 'the NewAPI row must be inserted by this patch')
    const config = row.config
    assert.ok(config, 'the NewAPI row must carry the deployment config')
    assert.equal(config.baseUrl, 'https://llm-proxy.ftai.chat')
    assert.equal(config.redirectUri, 'https://llm-proxy.ftai.chat/oauth/ft-sso')
    for (const key of ['baseUrl', 'redirectUri']) {
      assert.match(config[key], /^https:\/\//u, `${key} must be the registered public URL`)
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

    const bareGlobalNames = new Set(
      globalRows.map(row => barePackageSpecifier(row.name)).filter(Boolean),
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
      + `(for example '@ft/dsh-fft-research-cockpit/agent') that registers host-side behaviour only. `
      + `The official 'standard' preset names no package with a dsh.client declaration, which is why `
      + `this rule costs the copied rows nothing.`,
    )
  })
})
