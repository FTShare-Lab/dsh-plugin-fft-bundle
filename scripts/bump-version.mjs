#!/usr/bin/env node
/**
 * Set the bundle's version (and any sub-package you name) and point every
 * dependency edge at the tag of that version, in one command.
 *
 * A release touches the same version string in two shapes: the `version` field
 * of the package that ships it, and the committish on every `#path:` edge that
 * decides which commit the sub-plugins come from. They must agree — pnpm never
 * inherits the ref of the spec that pulled the bundle in — so doing them by
 * hand is how a release drifts. `scripts/edge-refs.mjs` owns the edge rewrite;
 * this script is the one command that also moves the version fields and prints
 * what it is about to change.
 *
 * Usage: `node scripts/bump-version.mjs --help`.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RELEASE_TAG, readEdges, refOf, repoRoot, setRef } from './edge-refs.mjs'

/** The package whose version names the release. */
const BUNDLE = 'packages/dsh-fft-bundle/package.json'

/** A version npm would accept. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u

const HELP = `bump-version — move a release's version and its dependency-edge tag together

USAGE
  node scripts/bump-version.mjs <version> [options]
  pnpm bump <version> [options]

ARGUMENTS
  <version>            New version for packages/dsh-fft-bundle, e.g. 0.6.1.
                       Every dependency edge is pointed at v<version> unless
                       --ref says otherwise.

OPTIONS
  --pkg <name=version> Also set one package's version (repeatable), e.g.
                       --pkg @ft/dsh-fft-settings=0.4.3. Only packages you name
                       are touched; use this for the "组件更新" of a release.
  --ref <ref>          Committish for every edge. Default v<version>. Use
                       \`dev\` for the development line, or \`none\` to drop the
                       ref entirely (the public remote has a single branch).
  --no-bundle          Leave packages/dsh-fft-bundle's version alone (edge ref
                       only).
  --dry-run            Print the changes without writing them.
  -h, --help           Print this help.

WHAT IT CHANGES
  packages/dsh-fft-bundle/package.json   version
  packages/<you named>/package.json      version
  every manifest with an edge back into this repository   #<ref>&path:

  The edge list itself lives in scripts/edge-refs.mjs (MANIFESTS); this script
  never guesses which manifests carry edges.

EXAMPLES
  node scripts/bump-version.mjs 0.6.1
  node scripts/bump-version.mjs 0.6.1 --pkg @ft/dsh-fft-settings=0.4.3 --pkg @ft/dsh-fft-research-cockpit=0.2.3
  node scripts/bump-version.mjs 0.6.1 --ref dev          # release commit, then back to dev
  node scripts/bump-version.mjs 0.6.1 --ref none --dry-run

NEXT STEPS
  pnpm build && git status          # the committed lib/ must match the sources
  git add -A && git commit -m 'release: v0.6.1'
  git tag v0.6.1`

/** Split the command line into the version to write and what to touch. */
function parseArgs(argv) {
  const options = { packages: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--dry-run' || arg === '--no-bundle') {
      options[arg === '--dry-run' ? 'dryRun' : 'noBundle'] = true
      continue
    }
    if (arg === '--ref' || arg === '--pkg') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} needs a value`)
      if (arg === '--ref') options.ref = value === 'none' ? '' : value
      else options.packages.push(value)
      index += 1
      continue
    }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg} (try --help)`)
    if (options.version !== undefined) throw new Error(`one version at a time: ${options.version} and ${arg} were both given`)
    options.version = arg
  }
  return options
}

/** Map every workspace package name to its manifest path. */
function manifestPaths() {
  const paths = new Map()
  for (const entry of readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = `packages/${entry.name}/package.json`
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))
    paths.set(manifest.name, path)
  }
  return paths
}

/** Write one manifest's version, returning the change that happened. */
function setVersion(path, version, dryRun) {
  const absolute = resolve(repoRoot, path)
  const manifest = JSON.parse(readFileSync(absolute, 'utf8'))
  const before = manifest.version
  if (before === version) return `${manifest.name}: already ${version}`
  if (dryRun !== true) {
    manifest.version = version
    writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return `${manifest.name}: ${before} -> ${version}`
}

/** Apply the version and edge changes, or only report them. */
function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log(HELP)
    return
  }
  const version = options.version
  if (version === undefined) throw new Error('a version is required (try --help)')
  if (!VERSION.test(version)) throw new Error(`${version} is not a version npm would accept`)
  const ref = options.ref ?? `v${version}`
  if (ref !== '' && ref !== 'dev' && !RELEASE_TAG.test(ref)) {
    throw new Error(`--ref must be a tag like v1.2.3, \`dev\`, or \`none\`; got ${ref}`)
  }

  const paths = manifestPaths()
  const changes = []
  if (options.noBundle !== true) changes.push(setVersion(BUNDLE, version, options.dryRun))
  for (const assignment of options.packages) {
    const at = assignment.lastIndexOf('=')
    const [name, next] = at === -1 ? [assignment, undefined] : [assignment.slice(0, at), assignment.slice(at + 1)]
    if (next === undefined || !VERSION.test(next)) throw new Error(`--pkg wants <name=version>, got ${assignment}`)
    const path = paths.get(name)
    if (path === undefined) throw new Error(`no workspace package named ${name}`)
    changes.push(setVersion(path, next, options.dryRun))
  }
  const edges = readEdges()
  const edgesBefore = edges.map(edge => refOf(edge.spec))
  const rewritten = options.dryRun === true ? edges.length : setRef(ref)

  const prefix = options.dryRun === true ? 'would ' : ''
  console.log(`bump-version: ${prefix}set ${changes.length} version field(s) and ${prefix}rewrite ${rewritten} edge(s) to #${ref || '(no ref)'}`)
  for (const change of changes) console.log(`  ${change}`)
  console.log(`  edges: ${edges.length} in ${new Set(edges.map(edge => edge.manifestPath)).size} manifest(s), now ${[...new Set(edgesBefore)].map(value => value || '(none)').join(', ')} -> ${ref || '(none)'}`)
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(`bump-version: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
