/**
 * Every dependency edge this bundle points back at its own repository decides
 * which commit a sub-plugin comes from.
 *
 * pnpm resolves each edge on its own and never inherits the ref of the spec
 * that pulled the bundle in: an edge without a ref follows the *target
 * repository's default branch*, so the bundle and its sub-plugins can land on
 * different commits — the bundle updates while the plugins stay behind, with
 * no error anywhere.  The release flow therefore writes one ref into all of
 * them at once: `#dev` on the development line, `#vX.Y.Z` on a release commit
 * (a tag a commit may forward-reference, unlike its own sha), and no ref on
 * the single-branch public remote.  See the `dsh-fft-release` skill.
 *
 * This test pins the invariant that makes that work — one shared ref, of one
 * of those three shapes, on every edge that names this repository.
 */
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'node:path'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), '..', '..')

/** Specs naming either remote of this repository are edges into this repo. */
const OWN_REPO = /(?:github\.com\/gigaflw\/dsh-fft-bundle|code\.non-convex\.com\/ben\/dsh-fft-bundle)\.git#/u

/** Manifests that carry an edge back into this repository. */
const MANIFESTS = [
  'packages/dsh-fft-bundle/package.json',
  'packages/dsh-fft-research-cockpit/package.json',
]

/** Ref shapes the release flow writes: the development line, a release tag, or none. */
const REF_SHAPES = [
  { shape: 'the development line', pattern: /^dev$/u },
  { shape: 'a release tag', pattern: /^v\d+\.\d+\.\d+(?:[-+].*)?$/u },
  { shape: 'no ref (single-branch remote)', pattern: /^$/u },
]

/**
 * Read one edge's ref the way pnpm's git resolver does: the fragment is a
 * list of `&`-joined parameters where `path:` and `semver:` are named and
 * anything else is the committish.
 * @param {string} spec - one dependency spec.
 * @returns the committish, or an empty string when the edge carries none.
 */
function refOf(spec) {
  const [, fragment = ''] = spec.split('#')
  const committish = fragment
    .split('&')
    .filter(parameter => !parameter.startsWith('path:') && !parameter.startsWith('semver:'))
  assert.ok(committish.length <= 1, `${spec} must name at most one committish`)
  return committish[0] ?? ''
}

/**
 * Read one edge's `path:` parameter, which selects the workspace package.
 * @param {string} spec - one dependency spec.
 * @returns the subdirectory the edge selects.
 */
function pathOf(spec) {
  const parameter = spec
    .split('#')[1]
    ?.split('&')
    .find(part => part.startsWith('path:'))
  assert.ok(parameter, `${spec} must select a package with path:`)
  return parameter.slice('path:'.length)
}

/** Every dependency edge, from every manifest, that names this repository. */
const edges = MANIFESTS.flatMap(manifestPath => {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), 'utf8'))
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, spec]) => OWN_REPO.test(spec))
    .map(([name, spec]) => ({ name, spec, manifestPath }))
})

describe('dependency edges into this repository', () => {
  it('resolve every plugin from this repository', () => {
    // The composition bundle carries four, the research cockpit one; the
    // public branch ships one fewer because the internal plugin is stripped.
    assert.ok(edges.length >= 4, `expected the edges into this repo, found ${edges.length}`)
    // A package may be an edge of more than one manifest (the cockpit and the
    // bundle both pull the settings plugin), but never twice in the same one.
    for (const manifestPath of MANIFESTS) {
      const names = edges.filter(edge => edge.manifestPath === manifestPath).map(edge => edge.name)
      assert.equal(new Set(names).size, names.length, `${manifestPath} must declare each edge once`)
    }
  })

  it('select the package each edge is declared under', () => {
    for (const edge of edges) {
      assert.equal(
        basename(pathOf(edge.spec)),
        edge.name.split('/').at(-1),
        `${edge.manifestPath}: ${edge.name} must select its own package directory`,
      )
    }
  })

  it('carry one shared ref, so a bundle version pairs with one plugin set', () => {
    const refs = new Set(edges.map(edge => refOf(edge.spec)))
    assert.equal(
      refs.size,
      1,
      `every edge must carry the same ref, found: ${[...refs].map(ref => ref || '(none)').join(', ')}`,
    )
  })

  it('carry a ref the release flow produces', () => {
    for (const ref of new Set(edges.map(edge => refOf(edge.spec)))) {
      assert.ok(
        REF_SHAPES.some(({ pattern }) => pattern.test(ref)),
        `ref "${ref}" is none of: ${REF_SHAPES.map(({ shape }) => shape).join(', ')}`,
      )
    }
  })
})
