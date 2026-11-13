#!/usr/bin/env node
/**
 * Read or rewrite the committish on every dependency edge that points back into
 * this repository, and verify the version anchors around it.
 *
 * Three kinds of dependency edge exist in the composition bundle:
 *
 *   * edges into this repository for packages that are **not published**
 *     (sso, ami). pnpm resolves each edge on its own and
 *     never inherits the ref of the spec that pulled the bundle in, so every
 *     such edge carries the same ref: the previous release's tag on the
 *     development line, and this release's own tag (a tag a commit may
 *     forward-reference, unlike its own sha) on the release commit. Nothing is
 *     installed from `dev` any more — development is verified with the local
 *     workspace `link:` overrides or a packed tarball — so there is no `#dev`
 *     state to flip back to.
 *   * exact registry versions for the published packages (settings, ftshare,
 *     paper, plot). They are release artifacts, consumed by version, not by commit.
 *   * an edge into another repository (kline). It has its own release line and
 *     always pins one of *its* release tags.
 *
 * The `public` remote is a single branch, so its edges carry no ref at all.
 *
 * Usage:
 *   node scripts/edge-refs.mjs tag vX.Y.Z   # release commit: re-pin every edge
 *   node scripts/edge-refs.mjs check        # verify the three invariants
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, resolved from this script's location. */
export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Specs naming a remote of this repository are edges into this repo: the
 * development remote, and the public remote it moved to (the old personal
 * repository is still recognized so an un-migrated edge reads as ours). */
export const OWN_REPO = /(?:github\.com\/FTShare-Lab\/dsh-plugin-fft-bundle|github\.com\/FTShare-Lab\/dsh-plugin-fft-bundle|github\.com\/gigaflw\/dsh-fft-bundle)\.git#/u

/**
 * Manifests that carry an edge back into this repository. Only the composition
 * bundle does: the published sub-packages are consumed by registry version.
 */
export const MANIFESTS = [
  'packages/dsh-fft-bundle/package.json',
]

/** The raw text shape of one edge, capturing everything before its committish. */
const EDGE_TEXT = /(git\+ssh:\/\/[^"']*(?:FTShare-Lab\/dsh-plugin-fft-bundle|FTShare-Lab\/dsh-plugin-fft-bundle|github\.com\/gigaflw\/dsh-fft-bundle)\.git)#(?:[^"'&]*&)?path:/gu

/** A release tag as the release flow writes it. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+].*)?$/u

/** An exact registry version; anything else (a git spec, a range, a file path) is refused. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u

/**
 * Dependency edges into another repository. The other repository has its own
 * release line, so the edge always pins one of *its* release tags.
 */
export const EXTERNAL_EDGES = [
  {
    manifestPath: 'packages/dsh-fft-bundle/package.json',
    name: '@ftshare-lab/dsh-kline',
    repo: /gigaflw\/dsh_kline(?:\.git)?#/u,
  },
]

/**
 * Dependencies published to the registry. The bundle consumes them by exact
 * version: they are release artifacts, and packing needs the built copy from
 * the registry (their git trees do not carry `lib/`).
 */
export const REGISTRY_PINS = [
  { manifestPath: 'packages/dsh-fft-bundle/package.json', name: '@dsh-ft/dsh-fft-settings' },
  { manifestPath: 'packages/dsh-fft-bundle/package.json', name: '@dsh-ft/dsh-fft-ftshare' },
  { manifestPath: 'packages/dsh-fft-bundle/package.json', name: '@dsh-ft/dsh-fft-paper-trading' },
]

/**
 * Every cross-repository edge declared above, read from its manifest.
 * @returns {Array<{ name: string, spec: string, manifestPath: string }>} the edges.
 */
export function readExternalEdges() {
  return EXTERNAL_EDGES.flatMap(({ manifestPath, name, repo }) => {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), 'utf8'))
    const spec = manifest.dependencies?.[name]
    return spec !== undefined && repo.test(spec) ? [{ name, spec, manifestPath }] : []
  })
}

/**
 * Every published package's pin, read from its manifest. A missing declaration
 * is reported with an empty spec so `check` fails instead of silently passing.
 * @returns {Array<{ name: string, spec: string, manifestPath: string }>} the pins.
 */
export function readRegistryPins() {
  return REGISTRY_PINS.map(({ manifestPath, name }) => {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), 'utf8'))
    return { name, spec: manifest.dependencies?.[name] ?? '', manifestPath }
  })
}

/**
 * Read one edge's committish the way pnpm's git resolver does: the fragment is a
 * list of `&`-joined parameters where `path:` and `semver:` are named and
 * anything else is the committish.
 * @param {string} spec - one dependency spec.
 * @returns {string} the committish, or an empty string when the edge carries none.
 */
export function refOf(spec) {
  const [, fragment = ''] = spec.split('#')
  const committish = fragment
    .split('&')
    .filter(parameter => !parameter.startsWith('path:') && !parameter.startsWith('semver:'))
  if (committish.length > 1) throw new Error(`${spec} must name at most one committish`)
  return committish[0] ?? ''
}

/**
 * Read one edge's `path:` parameter, which selects the workspace package.
 * @param {string} spec - one dependency spec.
 * @returns {string} the subdirectory the edge selects.
 */
export function pathOf(spec) {
  const parameter = spec
    .split('#')[1]
    ?.split('&')
    .find(part => part.startsWith('path:'))
  if (parameter === undefined) throw new Error(`${spec} must select a package with path:`)
  return parameter.slice('path:'.length)
}

/**
 * Every dependency edge, from every manifest, that names this repository.
 * @returns {Array<{ name: string, spec: string, manifestPath: string }>} the edges.
 */
export function readEdges() {
  return MANIFESTS.flatMap((manifestPath) => {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), 'utf8'))
    return Object.entries(manifest.dependencies ?? {})
      .filter(([, spec]) => OWN_REPO.test(spec))
      .map(([name, spec]) => ({ name, spec, manifestPath }))
  })
}

/**
 * The one ref every edge carries.
 * @returns {string} the shared committish, empty when the edges carry none.
 */
export function sharedRef() {
  const refs = new Set(readEdges().map(edge => refOf(edge.spec)))
  if (refs.size !== 1) {
    throw new Error(`every edge must carry the same ref, found: ${[...refs].map(ref => ref || '(none)').join(', ')}`)
  }
  return [...refs][0]
}

/**
 * Rewrite every edge to one ref, in place.
 * @param {string} ref - the committish to write; an empty string drops the ref.
 * @returns {number} how many edges were rewritten.
 */
export function setRef(ref) {
  const suffix = ref === '' ? 'path:' : `${ref}&path:`
  let rewritten = 0
  for (const manifestPath of MANIFESTS) {
    const absolute = resolve(repoRoot, manifestPath)
    const text = readFileSync(absolute, 'utf8')
    const next = text.replace(EDGE_TEXT, (_match, head) => {
      rewritten += 1
      return `${head}#${suffix}`
    })
    if (next !== text) writeFileSync(absolute, next)
  }
  return rewritten
}

/**
 * Verify the three anchors: one shared ref on the unpublished edges, release
 * tags on the cross-repository edges, exact versions on the published packages.
 */
export function check() {
  const edges = readEdges()
  const external = readExternalEdges()
  const pins = readRegistryPins()

  const unpinned = pins.filter(pin => !EXACT_VERSION.test(pin.spec))
  if (unpinned.length > 0) {
    console.error(
      'edge-refs: published packages are consumed by an exact registry version, never a git spec or a range:\n'
      + unpinned.map(pin => `  ${pin.manifestPath}: ${pin.name} -> ${pin.spec || '(not declared)'}`).join('\n')
      + '\n  Publish the package first, then pin X.Y.Z in the bundle manifest (pack-tarball inlines the built copy).',
    )
    process.exitCode = 1
    return
  }

  const doubled = edges.filter(edge => pins.some(pin => pin.manifestPath === edge.manifestPath && pin.name === edge.name))
  if (doubled.length > 0) {
    console.error(
      'edge-refs: a published package must not also travel as a git edge:\n'
      + doubled.map(edge => `  ${edge.manifestPath}: ${edge.name} -> ${edge.spec}`).join('\n'),
    )
    process.exitCode = 1
    return
  }

  const badExternal = external.filter(edge => !RELEASE_TAG.test(refOf(edge.spec)))
  if (badExternal.length > 0) {
    console.error(
      'edge-refs: refusing cross-repository edges that do not pin a release tag:\n'
      + badExternal.map(edge => `  ${edge.manifestPath}: ${edge.name} -> ${edge.spec}`).join('\n')
      + '\n  Cross-repository edges do not follow this bundle\'s release tags; tag that repository and pin'
      + ' its vX.Y.Z here.',
    )
    process.exitCode = 1
    return
  }

  let ref
  try {
    ref = sharedRef()
  } catch (error) {
    console.error(`edge-refs: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }
  if (ref !== '' && !RELEASE_TAG.test(ref)) {
    console.error(
      `edge-refs: refusing to carry the ${edges.length} #path: edges on #${ref}.\n`
      + '  Every #path: edge carries a release tag: the previous release on the development line, this\n'
      + '  release\'s own tag on the release commit (the public single-branch remote carries none).\n'
      + '  Fix: node scripts/bump-version.mjs <version> (release commit) — do not invent a ref by hand.',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `edge-refs: ${edges.length} edges carry #${ref || '(no ref)'}`
    + `; ${pins.length} published packages pinned to exact versions`
    + `; ${external.length} cross-repository edges pinned to release tags`,
  )
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'tag') {
    if (argument === undefined || !RELEASE_TAG.test(argument)) {
      console.error('edge-refs: usage: edge-refs.mjs tag vX.Y.Z')
      process.exitCode = 1
    } else {
      console.log(`edge-refs: rewrote ${setRef(argument)} edges to #${argument}`)
    }
  } else if (command === 'check') {
    check()
  } else {
    console.error('edge-refs: usage: edge-refs.mjs tag vX.Y.Z | check')
    process.exitCode = 1
  }
}

export { EXACT_VERSION, RELEASE_TAG }
