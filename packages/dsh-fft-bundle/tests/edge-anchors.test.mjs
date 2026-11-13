/**
 * The composition bundle pins its plugin set three ways, and each way has one
 * invariant:
 *
 *   * unpublished packages travel as `#path:` edges into this repository and
 *     carry one shared ref — the previous release's tag on the development line,
 *     this release's own tag on the release commit, nothing on the single-branch
 *     public remote;
 *   * kline lives in another repository, so its edge always pins one of *its*
 *     release tags;
 *   * published packages (settings, ftshare, paper) are consumed by an **exact
 *     registry version** — a git spec would install a tree without `lib/`, and a
 *     range would drift away from the version the tarball inlines.
 *
 * The rules and the rewrite tool live in `scripts/edge-refs.mjs` at the
 * repository root; this test reuses the same readers.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { basename } from 'node:path'
import {
  EXTERNAL_EDGES, MANIFESTS, REGISTRY_PINS, pathOf, readEdges, readExternalEdges, readRegistryPins, refOf,
} from '../../../scripts/edge-refs.mjs'

/** Ref shapes the release flow writes: a release tag, or none on the public remote. */
const REF_SHAPES = [
  { shape: 'a release tag', pattern: /^v\d+\.\d+\.\d+(?:[-+].*)?$/u },
  { shape: 'no ref (single-branch remote)', pattern: /^$/u },
]

const edges = readEdges()
const externalEdges = readExternalEdges()
const pins = readRegistryPins()

describe('dependency edges into this repository', () => {
  /**
   * The public tree carries no `#path:` edge: its unpublished packages are the
   * two intranet plugins, which that branch does not track, and every other
   * plugin comes from a registry or another repository. The two edge-shape
   * checks below therefore have nothing to read there — skipping is the honest
   * result, not a pass.
   */
  const noUnpublishedEdges = edges.length === 0 ? 'this tree declares no unpublished packages' : false

  it('declare the unpublished packages of the composition bundle', t => {
    if (noUnpublishedEdges !== false) return t.skip(noUnpublishedEdges)
    // A package may be an edge of more than one manifest, but never twice in the
    // same one.
    for (const manifestPath of MANIFESTS) {
      const names = edges.filter(edge => edge.manifestPath === manifestPath).map(edge => edge.name)
      assert.equal(new Set(names).size, names.length, `${manifestPath} must declare each edge once`)
    }
    // Published packages are release artifacts; a git edge for one would install
    // a tree without its built entry.
    for (const edge of edges) {
      const published = pins.find(pin => pin.name === edge.name)
      assert.equal(published, undefined, `${edge.manifestPath}: ${edge.name} is published and must be pinned by exact version, not by commit`)
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

  it('carry one shared ref, so a bundle version pairs with one plugin set', t => {
    if (noUnpublishedEdges !== false) return t.skip(noUnpublishedEdges)
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

describe('dependency edges into another repository', () => {
  it('declare every configured edge', () => {
    assert.equal(
      externalEdges.length,
      EXTERNAL_EDGES.length,
      'every configured cross-repository edge must be declared in its manifest',
    )
    assert.ok(externalEdges.length >= 1, 'the kline plugin is a cross-repository edge')
  })

  it('pin that repository\'s release tag, never a branch', () => {
    for (const edge of externalEdges) {
      assert.match(
        refOf(edge.spec),
        /^v\d+\.\d+\.\d+(?:[-+].*)?$/u,
        `${edge.manifestPath}: ${edge.name} must pin a release tag — tag that repository first`,
      )
    }
  })

  it('never also count as an edge into this repository', () => {
    const own = new Set(edges.map(edge => `${edge.manifestPath}:${edge.name}`))
    for (const edge of externalEdges) {
      assert.ok(
        !own.has(`${edge.manifestPath}:${edge.name}`),
        `${edge.manifestPath}: ${edge.name} cannot be both a local and a cross-repository edge`,
      )
    }
  })
})

describe('published packages', () => {
  it('are consumed by exact registry version', () => {
    assert.equal(pins.length, REGISTRY_PINS.length, 'every published pin must be declared in its manifest')
    for (const pin of pins) {
      assert.match(
        pin.spec,
        /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u,
        `${pin.manifestPath}: ${pin.name} must be an exact version, found: ${pin.spec || '(not declared)'}`,
      )
    }
  })

  it('never travel as a git spec', () => {
    for (const pin of pins) {
      assert.ok(!pin.spec.startsWith('git'), `${pin.manifestPath}: ${pin.name} must come from the registry, not a git edge`)
      assert.ok(!pin.spec.includes('&path:'), `${pin.manifestPath}: ${pin.name} must not select a workspace package`)
    }
  })
})
