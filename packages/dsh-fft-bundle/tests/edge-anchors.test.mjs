/**
 * Every dependency edge this bundle points back at its own repository decides
 * which commit a sub-plugin comes from.
 *
 * The rules and the rewrite tool live in `scripts/edge-refs.mjs` at the repository root; this test
 * pins the invariant that makes the released-pairs-one-commit contract hold —
 * one shared ref, of one of the three shapes the flow produces, on every edge
 * that names this repository.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { MANIFESTS, pathOf, readEdges, refOf } from '../../../scripts/edge-refs.mjs'

/** Ref shapes the release flow writes: the development line, a release tag, or none. */
const REF_SHAPES = [
  { shape: 'the development line', pattern: /^dev$/u },
  { shape: 'a release tag', pattern: /^v\d+\.\d+\.\d+(?:[-+].*)?$/u },
  { shape: 'no ref (single-branch remote)', pattern: /^$/u },
]

const edges = readEdges()

describe('dependency edges into this repository', () => {
  it('resolve every plugin from this repository', () => {
    // The composition bundle carries five (including the FTShare base), the
    // FTShare base one, the research cockpit one; the public branch ships one
    // fewer because the internal plugin is stripped.
    assert.ok(edges.length >= 6, `expected the edges into this repo, found ${edges.length}`)
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
