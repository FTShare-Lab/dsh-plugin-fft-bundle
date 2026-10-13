#!/usr/bin/env node
/**
 * Pack the bundle and every plugin it installs into one self-contained tarball.
 *
 * A plain `pnpm pack` of `packages/dsh-fft-bundle` is not self-contained: its
 * five dependency edges are git specs, so installing it still needs the git
 * hosts (internal GitLab on `dev`, GitHub on `public`), pnpm's
 * `blockExoticSubdeps: false` escape hatch, and — because a tag's edges may
 * carry no committish — it can pair this bundle with sub-plugins from another
 * commit. This script instead resolves every dependency of the bundle from the
 * requested ref itself, nests the resolved plugins under the bundle package's
 * own `node_modules`, and lists them in `bundledDependencies`, so pnpm ships
 * them inside the tarball and installs nothing over the network for them.
 *
 * The three dependencies the plugins still need from the registry
 * (`nunjucks`, `@modelcontextprotocol/sdk`, ...) stay declared and are fetched
 * by the consumer; only the plugin set is inlined.
 *
 * Usage: `node scripts/pack-tarball.mjs --help` (or `pnpm pack:tarball --help`)
 * prints the full option list; the short form is `[<ref>] [--out <dir>]`.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pathOf, refOf } from './edge-refs.mjs'

/** Repository root, resolved from this script's location. */
export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** The bundle package that owns the patch layer and the dependency edges. */
const BUNDLE_DIR = 'packages/dsh-fft-bundle'

/** Where the tarball lands when `--out` is not given. */
const DEFAULT_OUT = 'releases/gitlab'

/** Files every packed package must carry whatever its `files` field says. */
const ALWAYS_INCLUDED = ['package.json']

/**
 * Run git in the repository and return its stdout.
 * @param {string[]} args - git arguments.
 * @returns {string} trimmed stdout.
 */
function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

/**
 * Read one manifest out of a git ref.
 * @param {string} ref - the ref or tag to read.
 * @param {string} dir - package directory relative to the repository root.
 * @returns {object} the parsed manifest.
 */
function manifestAt(ref, dir) {
  return JSON.parse(git(['show', `${ref}:${dir}/package.json`]))
}

/**
 * Resolve the ref this run packs, defaulting to the tag of the checked-out bundle version.
 * @param {string | undefined} requested - the ref given on the command line.
 * @returns {string} a ref that resolves to a commit.
 */
function resolveRef(requested) {
  const ref = requested ?? `v${manifestAt('HEAD', BUNDLE_DIR).version}`
  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`])
  } catch {
    const tags = git(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').slice(0, 8).join(', ')
    throw new Error(`no commit for ${JSON.stringify(ref)}; recent tags: ${tags}`)
  }
  return ref
}

/**
 * Extract the repository's `packages/` tree at one ref into a staging directory.
 * @param {string} ref - the ref to extract.
 * @param {string} dest - absolute staging directory.
 * @returns {string} the absolute extraction root (the directory holding `packages/`).
 */
function extractPackages(ref, dest) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const archive = spawnSync('git', ['archive', '--format=tar', ref, 'packages'], { cwd: repoRoot, maxBuffer: 1 << 30 })
  if (archive.status !== 0) throw new Error(`git archive ${ref} failed: ${archive.stderr.toString()}`)
  const untar = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout, maxBuffer: 1 << 30 })
  if (untar.status !== 0) throw new Error(`tar extraction failed: ${untar.stderr.toString()}`)
  return dest
}

/**
 * Translate one npm `files` pattern into a regular expression over `/`-joined relative paths.
 * @param {string} pattern - one entry of a `files` field.
 * @returns {RegExp} the matcher.
 */
export function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u0000/gu, '.*')
  // A bare directory name ships everything below it.
  return new RegExp(`^${escaped}(?:/.*)?$`, 'u')
}

/**
 * The entry files a package must ship: `main` and every runtime `exports`
 * target. A `types` target is optional — a package may point at a declaration
 * file its `files` field never shipped.
 * @param {object} manifest - the package manifest.
 * @returns {{required: string[], optional: string[]}} `/`-joined relative paths.
 */
function entryFiles(manifest) {
  const required = [...ALWAYS_INCLUDED]
  const optional = []
  const add = (value, key) => {
    const path = value.replace(/^\.\//u, '')
    if (path === '') return
    ;(key === 'types' ? optional : required).push(path)
  }
  if (typeof manifest.main === 'string') required.push(manifest.main.replace(/^\.\//u, ''))
  const walk = (value, key) => {
    if (typeof value === 'string') return add(value, key)
    for (const [childKey, child] of Object.entries(value ?? {})) walk(child, childKey)
  }
  walk(manifest.exports ?? {}, undefined)
  return { required, optional }
}

/**
 * Every file of one staged package that its `files` field ships.
 * @param {string} packageDir - absolute package directory.
 * @param {object} manifest - the package manifest.
 * @returns {string[]} `/`-joined paths relative to `packageDir`.
 */
function shippedFiles(packageDir, manifest) {
  const patterns = (manifest.files ?? []).filter(pattern => !pattern.startsWith('!')).map(patternToRegExp)
  const { required, optional } = entryFiles(manifest)
  const all = readdirSync(packageDir, { recursive: true }).map(path => String(path).split(sep).join('/'))
  const files = new Set()
  for (const path of all) {
    if (!statSync(join(packageDir, path)).isFile()) continue
    if (required.includes(path) || patterns.some(pattern => pattern.test(path))) files.add(path)
  }
  for (const path of required) {
    if (path.includes('*') || files.has(path)) continue
    if (existsSync(join(packageDir, path))) files.add(path)
    else throw new Error(`${manifest.name}: required entry ${path} is not tracked at this ref — build and commit the artifacts first`)
  }
  for (const path of optional) {
    if (!path.includes('*') && existsSync(join(packageDir, path))) files.add(path)
  }
  if (files.size === 0) throw new Error(`${manifest.name}: nothing matched its files field`)
  return [...files]
}

/**
 * Copy one package's shipped files into the payload.
 * @param {string} packageDir - absolute staged package directory.
 * @param {string} destDir - absolute payload directory.
 * @param {object} manifest - the package manifest.
 * @returns {number} how many files were copied.
 */
function copyPackage(packageDir, destDir, manifest) {
  const files = shippedFiles(packageDir, manifest)
  for (const path of files) {
    const target = join(destDir, path)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(packageDir, path), target)
  }
  return files.length
}

/**
 * Pick one range for a dependency several plugins declare differently, preferring the highest `>=` lower bound.
 * @param {{name: string, range: string}[]} declarations - the declarations, in plugin order.
 * @returns {string} the chosen range.
 */
export function pickRange(declarations) {
  const lowest = declaration => /^>=\s*(\d+\.\d+\.\d+)/u.exec(declaration.range)?.[1]
  const ranked = declarations.map(declaration => ({ ...declaration, bound: lowest(declaration) }))
  if (ranked.every(entry => entry.bound === undefined)) {
    if (new Set(declarations.map(declaration => declaration.range)).size > 1) {
      process.stderr.write(`pack-tarball: warning: ${declarations[0].name} is declared as ${declarations.map(d => d.range).join(' / ')}, using ${declarations[0].range}\n`)
    }
    return declarations[0].range
  }
  ranked.sort((a, b) => (a.bound === undefined ? -1 : b.bound === undefined ? 1 : b.bound.localeCompare(a.bound, undefined, { numeric: true })))
  return ranked[0].range
}

/**
 * Rewrite the bundle manifest so the packed tarball carries its plugins instead of git edges.
 * @param {object} bundle - the bundle manifest at the ref.
 * @param {{name: string, manifest: object}[]} bundled - every inlined plugin, in edge order.
 * @returns {object} the manifest to pack.
 */
export function rewriteManifest(bundle, bundled) {
  const bundledNames = new Set(bundled.map(plugin => plugin.name))
  const external = new Map()
  for (const plugin of bundled) {
    for (const [name, range] of Object.entries(plugin.manifest.dependencies ?? {})) {
      if (bundledNames.has(name)) continue
      const declarations = external.get(name) ?? []
      declarations.push({ name, range })
      external.set(name, declarations)
    }
  }
  const peers = new Map()
  for (const plugin of bundled) {
    for (const [name, range] of Object.entries(plugin.manifest.peerDependencies ?? {})) {
      if (!peers.has(name)) peers.set(name, range)
    }
  }
  const dependencies = {
    ...Object.fromEntries(bundled.map(plugin => [plugin.name, plugin.manifest.version])),
    ...Object.fromEntries([...external].map(([name, declarations]) => [name, pickRange(declarations)])),
  }
  return {
    ...bundle,
    dependencies,
    ...peers.size === 0 ? {} : { peerDependencies: Object.fromEntries(peers) },
    bundledDependencies: bundled.map(plugin => plugin.name),
  }
}

/**
 * The clone URL of a git edge, rewritten to https so a fresh machine needs no ssh key.
 * @param {string} spec - one dependency spec.
 * @returns {string} an https git URL.
 */
export function httpsUrl(spec) {
  const url = spec.split('#')[0].replace(/^git\+/u, '')
  const scp = /^git@([^:]+):(.+)$/u.exec(url)
  if (scp !== null) return `https://${scp[1]}/${scp[2]}`
  const ssh = /^ssh:\/\/git@([^/]+)\/(.+)$/u.exec(url)
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2]}`
  return url.replace(/^git:\/\//u, 'https://')
}

/**
 * Find an installed copy of a plugin whose version matches the edge's tag.
 * @param {string} name - package name.
 * @param {string} ref - the edge's committish, `v0.3.5` or empty.
 * @returns {string | undefined} the installed package directory.
 */
function installedCopy(name, ref) {
  const wanted = ref.replace(/^v/u, '')
  const profiles = join(homedir(), '.dsh', 'profiles')
  if (!existsSync(profiles)) return undefined
  for (const profile of readdirSync(profiles)) {
    const dir = join(profiles, profile, 'node_modules', name)
    if (!existsSync(join(dir, 'package.json'))) continue
    const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
    if (wanted === '' || version === wanted) return dir
  }
  return undefined
}

/**
 * Obtain one external dependency's files: an explicit directory, an installed copy, a cache, or a clone.
 * @param {string} name - package name.
 * @param {string} spec - the dependency spec.
 * @param {{klineDir?: string, cache: string}} options - the run's sources.
 * @returns {string} the absolute directory holding the package.
 */
function externalSource(name, spec, options) {
  if (options.klineDir !== undefined) return options.klineDir
  const ref = refOf(spec)
  const installed = installedCopy(name, ref)
  if (installed !== undefined) {
    console.log(`pack-tarball: ${name} from the installed profile (${installed})`)
    return installed
  }
  const cache = join(options.cache, `${name.replace(/[^a-z0-9.-]/giu, '_')}-${ref === '' ? 'default' : ref}`)
  if (!existsSync(join(cache, 'package.json'))) {
    rmSync(cache, { recursive: true, force: true })
    const args = ['clone', '--depth', '1', ...ref === '' ? [] : ['--branch', ref], httpsUrl(spec), cache]
    console.log(`pack-tarball: cloning ${httpsUrl(spec)}${ref === '' ? '' : ` at ${ref}`}`)
    execFileSync('git', args, { stdio: 'inherit' })
  }
  return cache
}

/**
 * Pack the staged package and report the artifact.
 * @param {string} staging - absolute staging root holding `package/` and the pnpm settings.
 * @param {string} out - absolute output directory.
 * @param {object} manifest - the packed manifest.
 * @returns {string} the absolute tarball path.
 */
function pack(staging, out, manifest) {
  mkdirSync(out, { recursive: true })
  writeFileSync(join(staging, 'pnpm-workspace.yaml'), 'packages:\n  - package\n\nnodeLinker: hoisted\n')
  const result = spawnSync('pnpm', ['pack', '--pack-destination', out], { cwd: join(staging, 'package'), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`pnpm pack failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  const expected = join(out, `${manifest.name.replace(/^@/u, '').replace(/\//gu, '-')}-${manifest.version}.tgz`)
  if (!existsSync(expected)) throw new Error(`pnpm pack produced no ${expected}`)
  return expected
}

/**
 * Resolve the ref, assemble the payload, and pack it.
 * @param {{ref?: string, out?: string, klineDir?: string, keepStaging?: boolean}} options - the run's inputs.
 * @returns {{tarball: string, manifest: object, bundled: string[], bytes: number, files: number, ref: string}} the result.
 */
export function packTarball(options = {}) {
  const ref = resolveRef(options.ref)
  const out = resolve(repoRoot, options.out ?? DEFAULT_OUT)
  const staging = join(repoRoot, 'tmp', 'standalone', `.staging-${ref.replace(/[^a-z0-9.-]/giu, '_')}`)
  const extractionRoot = extractPackages(ref, staging)
  const bundle = manifestAt(ref, BUNDLE_DIR)
  const bundled = []
  for (const [name, spec] of Object.entries(bundle.dependencies ?? {})) {
    const path = (() => {
      try {
        return pathOf(spec)
      } catch {
        return undefined
      }
    })()
    const staged = path === undefined ? undefined : join(extractionRoot, path)
    if (staged !== undefined && existsSync(join(staged, 'package.json'))) {
      const manifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'))
      bundled.push({ name, manifest, source: staged })
    } else {
      const source = externalSource(name, spec, { klineDir: options.klineDir, cache: join(repoRoot, 'tmp', 'standalone', '.cache') })
      const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
      bundled.push({ name, manifest, source })
    }
  }
  const manifest = rewriteManifest(bundle, bundled)
  const payload = join(staging, 'package')
  rmSync(payload, { recursive: true, force: true })
  mkdirSync(payload, { recursive: true })
  const bundleDir = join(extractionRoot, BUNDLE_DIR)
  for (const path of shippedFiles(bundleDir, bundle)) {
    mkdirSync(dirname(join(payload, path)), { recursive: true })
    cpSync(join(bundleDir, path), join(payload, path))
  }
  writeFileSync(join(payload, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  let files = 0
  for (const plugin of bundled) {
    const dest = join(payload, 'node_modules', plugin.name)
    mkdirSync(dest, { recursive: true })
    files += copyPackage(plugin.source, dest, plugin.manifest)
  }
  const tarball = pack(staging, out, manifest)
  if (options.keepStaging !== true) rmSync(staging, { recursive: true, force: true })
  return { tarball, manifest, bundled: bundled.map(plugin => `${plugin.name}@${plugin.manifest.version}`), bytes: statSync(tarball).size, files, ref }
}

/** What every flag does; `--help` prints exactly this. */
const HELP = `pack-tarball — pack the bundle and its plugins into one installable file

USAGE
  node scripts/pack-tarball.mjs [<ref>] [options]
  pnpm pack:tarball [<ref>] [options]

ARGUMENTS
  <ref>                Commit to pack: a tag, branch, or sha. Defaults to
                       v<version of packages/dsh-fft-bundle on HEAD>.

OPTIONS
  --out <dir>          Directory for the .tgz. Defaults to releases/gitlab
                       (repository-relative); the public side uses
                       --out releases/github.
  --kline-dir <dir>    Directory of an already installed
                       @ftshare-lab/dsh-kline. Skips the source lookup below.
  --keep-staging       Keep tmp/standalone/.staging-<ref>/ for inspection.
  -h, --help           Print this help.

WHAT IT DOES
  Extracts packages/ from <ref> with git archive, keeps each package's own
  files entries (and fails loudly when a required entry is missing), then
  inlines every dependency edge back into this repository plus the external
  kline under the bundle's own node_modules. The rewritten manifest lists them
  in bundledDependencies, so pnpm installs the tarball without resolving a
  single git edge.

EXTERNAL SOURCES
  An edge that is not in this repository is resolved in order: an installed
  profile (~/.dsh/profiles/*/node_modules), the cache under
  tmp/standalone/.cache, then a git clone with git+ssh rewritten to https.

OUTPUT
  Prints the tarball path, size, payload file count, sha256, the inlined
  plugins, and the registry dependencies the consumer still fetches. The file
  name carries the version, which is what upgrades rely on.

EXAMPLES
  pnpm pack:tarball                       # the tag matching the current version
  pnpm pack:tarball v0.6.1                # a released version
  pnpm pack:tarball HEAD                  # the working commit, built artifacts included
  pnpm pack:tarball v0.6.1 --out releases/github
  node scripts/pack-tarball.mjs v0.6.1 --kline-dir ~/.dsh/profiles/desktop/node_modules/@ftshare-lab/dsh-kline

NOTES
  Run pnpm build and commit lib/ before packing a ref, or the tarball carries
  stale payloads. Reinstalling the same path does not upgrade; ship a new file
  name (or URL) per version.`

/** Split the command line into packaging options. */
function parseArgs(argv) {
  const options = { keepStaging: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--out' || arg === '--kline-dir') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} needs a directory`)
      if (arg === '--out') options.out = value
      else options.klineDir = value
      index += 1
      continue
    }
    if (arg === '--keep-staging') {
      options.keepStaging = true
      continue
    }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg} (try --help)`)
    if (options.ref !== undefined) throw new Error(`pack one ref at a time: ${options.ref} and ${arg} were both given`)
    options.ref = arg
  }
  return options
}

/** Print what was packed, how to install it, and where each side publishes it. */
function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log(HELP)
    return
  }
  const result = packTarball(options)
  const digest = createHash('sha256').update(readFileSync(result.tarball)).digest('hex')
  const size = (result.bytes / 1024 / 1024).toFixed(1)
  const registry = Object.keys(result.manifest.dependencies).filter(name => !result.bundled.some(plugin => plugin.startsWith(`${name}@`)))
  console.log(`
pack-tarball: ${result.ref} -> ${result.tarball}
  ${size} MB, ${result.files} payload files, sha256 ${digest}
  bundle @ft/dsh-fft-bundle@${result.manifest.version}, inlined:
${result.bundled.map(plugin => `    ${plugin}`).join('\n')}
  still from the registry: ${registry.join(', ') || '(none)'}

Install it (the desktop profile is owned by the app, so quit the app first for the CLI path):
  GUI   plugin manager -> paste the absolute path above
  CLI   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \\
          plugin --profile desktop add ${result.tarball}

Publish it:
  GitLab (internal)  git add -f ${result.tarball} on the stable branch, so the default branch carries it
  GitHub (public)    gh release create <tag> --repo gigaflw/dsh-fft-bundle <this file>
`)
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(`pack-tarball: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
