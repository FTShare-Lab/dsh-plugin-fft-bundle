#!/usr/bin/env node
/**
 * Read or rewrite the committish on every dependency edge that points back into
 * this repository.
 *
 * pnpm resolves each edge on its own and never inherits the ref of the spec that
 * pulled the bundle in: an edge without a ref follows the target repository's
 * default branch, so the bundle and its sub-plugins can land on different
 * commits with no error anywhere. Every edge therefore carries the same ref:
 * `#dev` on the development line, `#vX.Y.Z` on a release commit (a tag a commit
 * may forward-reference, unlike its own sha), and no ref on the single-branch
 * public remote.
 *
 * The release commit keeps its tag — that is what `stable` and tag installs
 * serve — while anyone installing from `dev` must get `#dev`, or the bundle
 * moves ahead of its plugins. Paying a commit per release for the way back is
 * unnecessary: the flip belongs to the moment before `dev` is pushed, which is
 * what `check --pre-push` (see `.githooks/pre-push`) enforces.
 *
 * Usage:
 *   node scripts/edge-refs.mjs dev
 *   node scripts/edge-refs.mjs tag v0.5.3
 *   node scripts/edge-refs.mjs check [--pre-push]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, resolved from this script's location. */
export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Specs naming either remote of this repository are edges into this repo. */
export const OWN_REPO = /(?:github\.com\/FTShare-Lab\/dsh-plugin-fft-bundle|github\.com\/gigaflw\/dsh-fft-bundle)\.git#/u

/** Manifests that carry an edge back into this repository. */
export const MANIFESTS = [
  'packages/dsh-fft-bundle/package.json',
  'packages/dsh-fft-ftshare/package.json',
  'packages/dsh-fft-research-cockpit/package.json',
]

/** The raw text shape of one edge, capturing everything before its committish. */
const EDGE_TEXT = /(git\+ssh:\/\/[^"']*(?:FTShare-Lab\/dsh-plugin-fft-bundle|github\.com\/gigaflw\/dsh-fft-bundle)\.git)#(?:[^"'&]*&)?path:/gu

/** A release tag as the release flow writes it. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+].*)?$/u

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
 * The subject of the commit being pushed.
 * @returns {string} one line of commit subject.
 */
function headSubject() {
  return execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repoRoot, encoding: 'utf8' }).trim()
}

/**
 * Verify the edges before or after a rewrite.
 *
 * With `--pre-push` the expectation follows the commit being pushed: the release
 * commit itself keeps its tag, every other commit must be on `#dev`, because
 * that is the state a developer installing from the branch would resolve.
 * @param {{ prePush?: boolean }} [options] - whether this is a push-time check.
 */
export function check({ prePush = false } = {}) {
  const edges = readEdges()
  const ref = sharedRef()
  if (!prePush) {
    console.log(`edge-refs: ${edges.length} edges carry #${ref || '(no ref)'}`)
    return
  }
  const subject = headSubject()
  const released = /^release: (v\S+)$/u.exec(subject)
  const expected = released?.[1] ?? 'dev'
  if (ref === expected) {
    console.log(`edge-refs: ${edges.length} edges carry #${ref}, matching "${subject}"`)
    return
  }
  const fix = expected === 'dev' ? 'node scripts/edge-refs.mjs dev' : `node scripts/edge-refs.mjs tag ${expected}`
  console.error(
    `edge-refs: refusing to push dev with the ${edges.length} dependency edges on #${ref || '(no ref)'}.\n`
    + '  The release commit keeps its tag; any other commit must be on #dev, or a dev install pairs\n'
    + '  this bundle with the previous release\'s plugins.\n'
    + `  Fix: ${fix}  (then amend the commit or make it its own commit)`,
  )
  process.exitCode = 1
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'dev') {
    console.log(`edge-refs: rewrote ${setRef('dev')} edges to #dev`)
  } else if (command === 'tag') {
    if (argument === undefined || !RELEASE_TAG.test(argument)) {
      console.error('edge-refs: usage: edge-refs.mjs tag vX.Y.Z')
      process.exitCode = 1
    } else {
      console.log(`edge-refs: rewrote ${setRef(argument)} edges to #${argument}`)
    }
  } else if (command === 'check') {
    check({ prePush: process.argv.includes('--pre-push') })
  } else {
    console.error('edge-refs: usage: edge-refs.mjs dev | tag vX.Y.Z | check [--pre-push]')
    process.exitCode = 1
  }
}

export { RELEASE_TAG }
