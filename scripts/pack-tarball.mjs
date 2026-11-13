#!/usr/bin/env node
/**
 * Pack the bundle and every plugin it installs into one self-contained tarball.
 *
 * A plain `pnpm pack` of `packages/dsh-fft-bundle` is not self-contained: its
 * dependency edges are git specs, so installing it still needs the git
 * hosts (internal GitLab on `dev`, GitHub on `public`), pnpm's
 * `blockExoticSubdeps: false` escape hatch, and — because a tag's edges may
 * carry no committish — it can pair this bundle with sub-plugins from another
 * commit. This script instead resolves every dependency of the bundle from the
 * requested ref itself, nests the resolved plugins under the bundle package's
 * own `node_modules`, and lists them in `bundledDependencies`, so pnpm ships
 * them inside the tarball and installs nothing over the network for them.
 *
 * The bundle's dependencies come from three places and are all inlined: the
 * unpublished packages from this repository's tree at the ref, the published
 * packages (settings, ftshare, paper) from their **registry tarball** — the only
 * place their built `lib/` exists, their git trees carry sources only — and kline
 * from its own repository tag. Third-party packages (`nunjucks`,
 * `@modelcontextprotocol/sdk`, ...) stay declared and are fetched by the
 * consumer; only the plugin set is inlined.
 *
 * Usage: `node scripts/pack-tarball.mjs --help` (or `pnpm pack:tarball --help`)
 * prints the full option list; the short form is `[<ref>] [--out <dir>]`.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pathOf, refOf } from './edge-refs.mjs'

/** Repository root, resolved from this script's location. */
export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** The bundle package that owns the patch layer and the dependency edges. */
const BUNDLE_DIR = 'packages/dsh-fft-bundle'

/** The third-party plugin `--kline-dir` substitutes. */
const KLINE = '@ftshare-lab/dsh-kline'

/**
 * Patch files appended only by this artifact.
 *
 * The public npm package declares just `./cordis.patch.yml`; the internal
 * tarball must also carry the SSO and  rows, and the host applies an ordered
 * patch list natively. Rewriting the declared list here — rather than shipping a
 * second bundle package — keeps the internal channel at one bundle and one
 * profile layer, which is what the host can actually resolve: bundle layers are
 * registered from the profile's *direct* dependencies only.
 */
export const INTRANET_PATCHES = ['./cordis.intranet.patch.yml']

/** Where the tarball lands when `--out` is not given. */
const DEFAULT_OUT = 'releases/gitlab'

/** Files every packed package must carry whatever its `files` field says. */
const ALWAYS_INCLUDED = ['package.json']

/** An exact registry version; the bundle pins its published packages this way. */
export const REGISTRY_SPEC = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u

/**
 * The exact version a registry pin names, or `undefined` for a git edge.
 * @param {string} spec - one dependency spec.
 * @returns {string | undefined} the pinned version.
 */
export function registryVersionOf(spec) {
  return REGISTRY_SPEC.test(spec) ? spec : undefined
}

/** A registry lower bound (`>=x.y.z`), the shape the bundle declares now. */
export const LOWER_BOUND = /^>=\d+\.\d+\.\d+$/u

/**
 * The version the release actually installs for one dependency, read from the
 * committed lockfile. Lower bounds resolve through it, so the tarball carries
 * exactly what the tree was tested with instead of whatever npm serves today.
 * @param {string} name - package name.
 * @returns {string|undefined} the locked version, peer suffixes stripped.
 */
export function lockedVersion(name) {
  let lock
  try { lock = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8') } catch { return undefined }
  const lines = lock.split('\n')
  const key = `'${name}':`
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== key) continue
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const m = /^\s+version:\s*(\S+)/u.exec(lines[j])
      if (m !== null) return m[1].replace(/\(.*$/u, '')
    }
  }
  return undefined
}

/**
 * Resolve one dependency spec to the concrete published version: an exact pin
 * is itself, a lower bound goes through the lockfile.
 * @param {string} name - package name.
 * @param {string} spec - the dependency spec.
 * @returns {string|undefined} the version, or undefined for a git edge.
 */
export function resolveRegistryVersion(name, spec) {
  const exact = registryVersionOf(spec)
  if (exact !== undefined) return exact
  if (!LOWER_BOUND.test(spec)) return undefined
  const locked = lockedVersion(name)
  if (locked === undefined) {
    throw new Error(`pack-tarball: ${name}@${spec} has no locked resolution; run pnpm install and commit pnpm-lock.yaml`)
  }
  return locked
}

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
  // The working tree is what HEAD means here: the extractions below run against
  // the live files, so uncommitted edits are what this run packs.
  if (ref === 'HEAD') {
    cpSync(join(repoRoot, 'packages'), join(dest, 'packages'), { recursive: true, filter: source => !source.includes(`${sep}node_modules`) })
    return dest
  }
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
 * Local scratch directories that never belong to a shipped payload.
 *
 * `.pnpm-store` is a workspace store a package checkout can carry (the paper
 * repository keeps one), and it holds project symlinks to build directories
 * that no longer exist — walking it fails the pack on a broken link, and its
 * contents could never match a `files` entry anyway.
 */
const LOCAL_SCRATCH = ['node_modules', '.pnpm-store', 'tmp', 'dsh_tmp', '.worktrees']

/**
 * Whether a package-relative path sits inside a local scratch directory.
 * @param path - `/`-joined path relative to the package directory.
 * @returns true when the path has to be skipped.
 */
function inLocalScratch(path) {
  return LOCAL_SCRATCH.some(entry => path === entry || path.startsWith(`${entry}/`))
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
    // A package's own bundled `node_modules` never travels: the bundle inlines
    // the whole plugin set one level up, so a nested copy would shadow it (the
    // published paper tarball carries its kline under `node_modules`). Local
    // scratch directories are skipped for the reason above.
    if (inLocalScratch(path)) continue
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
 * Package names one patch file inserts, including rows of groups.
 *
 * Only the fields this script needs are read: a row's `name`, and the `config`
 * array of a `group` row. The internal patch file is written by this repository,
 * so it uses neither `!!js` scalars on `name` nor a name the host resolves
 * dynamically — a row naming anything else fails the pack instead of shipping a
 * payload whose plugin was never inlined.
 * @param {string} file - absolute patch file path.
 * @returns {string[]} the package names, in file order.
 */
function packageNamesIn(file) {
  // `js-yaml` is a devDependency of the bundle package, not of this repository
  // root: resolve it from there so the script runs without a root-level install.
  const yaml = createRequire(join(repoRoot, BUNDLE_DIR, 'package.json'))('js-yaml')
  const names = []
  const visit = (rows) => {
    for (const row of rows) {
      if (Array.isArray(row?.config) && row.group === true) visit(row.config)
      if (typeof row?.name !== 'string') continue
      const name = row.name.startsWith('@') ? row.name.split('/').slice(0, 2).join('/') : row.name.split('/')[0]
      if (!name.startsWith('.')) names.push(name)
    }
  }
  // `!!js` scalars are the host's own extension; keep them as opaque nodes so a
  // file carrying them still parses. Only `name` and `group`/`config` are read.
  const js = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: value => typeof value === 'string',
    construct: String,
  })
  const patches = yaml.load(readFileSync(file, 'utf8'), { schema: yaml.DEFAULT_SCHEMA.extend([js]) })
  for (const patch of Array.isArray(patches) ? patches : [patches]) {
    if (Array.isArray(patch?.insert)) visit(patch.insert)
  }
  return names
}

/**
 * Whether an inlined version satisfies a range another bundled plugin declares.
 *
 * Only the forms the manifests actually use are understood — an exact version,
 * `^`, `~`, `>=` and `*` — so a future range syntax fails the pack loudly
 * instead of shipping a mismatched pair silently.
 * @param {string} version - the version being inlined.
 * @param {string} range - the declaration to satisfy.
 * @returns {boolean} whether the pair is compatible.
 */
export function satisfiesRange(version, range) {
  const [major, minor, patch] = version.split('+')[0].split('-')[0].split('.').map(Number)
  const wanted = range.trim()
  if (wanted === '' || wanted === '*' || wanted === 'x' || wanted === 'X') return true
  const match = /^(\^|~|>=)?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?$/u.exec(wanted)
  if (match === null) throw new Error(`unsupported dependency range ${JSON.stringify(range)}`)
  const [, operator = '', wantMajor, wantMinor, wantPatch] = match
  const bound = [
    Number(wantMajor),
    wantMinor === undefined || /[xX*]/u.test(wantMinor) ? 0 : Number(wantMinor),
    wantPatch === undefined || /[xX*]/u.test(wantPatch) ? 0 : Number(wantPatch),
  ]
  const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
  const atLeast = compare([major, minor, patch], bound) >= 0
  if (operator === '>=') return atLeast
  if (!atLeast) return false
  if (operator === '~') return major === bound[0] && minor === bound[1]
  if (operator === '^') {
    if (bound[0] > 0) return major === bound[0]
    if (bound[1] > 0) return major === 0 && minor === bound[1]
    return major === 0 && minor === 0 && patch === bound[2]
  }
  return major === bound[0] && minor === bound[1] && patch === bound[2]
}

/**
 * Refuse a payload whose inlined versions do not satisfy the ranges the bundled
 * plugins declare for each other. `rewriteManifest` drops those edges because the
 * package is already inside the tarball, so this is the only place the pairing is
 * still checked.
 * @param {{name: string, manifest: object}[]} bundled - every inlined plugin.
 */
export function assertBundledRanges(bundled) {
  const versions = new Map(bundled.map(plugin => [plugin.name, plugin.manifest.version]))
  for (const plugin of bundled) {
    for (const [name, range] of Object.entries(plugin.manifest.dependencies ?? {})) {
      const version = versions.get(name)
      if (version === undefined) continue
      // git, file, workspace and URL specs are not version ranges; the edge
      // itself already selected the commit (or package directory).
      if (!/^[\^~>=\d]/u.test(range)) continue
      if (!satisfiesRange(version, range)) {
        throw new Error(
          `${plugin.name} requires ${name}@${range}, but the bundle inlines ${name}@${version};`
          + ' publish the required version and pin it in packages/dsh-fft-bundle/package.json',
        )
      }
    }
  }
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
 * The URL to clone for an edge: https for every host so a fresh machine needs no ssh key.
 * @param {string} spec - one dependency spec.
 * @returns {string} a clone URL.
 */
export function cloneUrl(spec) {
  const url = spec.split('#')[0].replace(/^git\+/u, '')
  return httpsUrl(spec)
}

/**
 * Extract one package from a local sibling repository at the edge's ref. The
 * package sits at that repository's root, so the extraction is the package.
 * @param {string} name - package name.
 * @param {string} dir - repository root.
 * @param {string} ref - tag or commit to extract.
 * @param {string} cache - cache root.
 * @returns {string} the extracted package directory.
 */
function localRepoSource(name, dir, ref, cache) {
  const dest = join(cache, `${name.replace(/[^a-z0-9.-]/giu, '_')}-${ref}`)
  if (existsSync(join(dest, 'package.json'))) return dest
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const archive = spawnSync('git', ['-C', dir, 'archive', '--format=tar', ref], { maxBuffer: 1 << 30 })
  if (archive.status !== 0) throw new Error(`git archive ${ref} in ${dir} failed: ${archive.stderr.toString()}`)
  const untar = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout, maxBuffer: 1 << 30 })
  if (untar.status !== 0) throw new Error(`tar extraction failed: ${untar.stderr.toString()}`)
  return dest
}

/**
 * Find an installed copy of a plugin at one exact version. A registry pin names
 * one version and a git tag names one build, so an installed copy is only reused
 * when its version matches exactly — never "whatever happens to be installed".
 * A git edge's tag is a release ref, not necessarily the package version, so a
 * tag-needing source falls through to its repository clone instead.
 * @param {string} name - package name.
 * @param {string} version - the version the source must carry; empty means the edge has no tag.
 * @returns {string | undefined} the installed package directory.
 */
function installedCopy(name, version) {
  if (version === '') return undefined
  const profiles = join(homedir(), '.dsh', 'profiles')
  if (!existsSync(profiles)) return undefined
  for (const profile of readdirSync(profiles)) {
    const dir = join(profiles, profile, 'node_modules', name)
    if (!existsSync(join(dir, 'package.json'))) continue
    const installed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
    if (installed === version) return dir
  }
  return undefined
}

/** A directory-safe form of a package name. */
function directoryName(name) {
  return name.replace(/[^a-z0-9.-]/giu, '_')
}

/**
 * Obtain one external dependency's files. A registry pin is taken from the
 * registry (that is where the published packages' built `lib/` lives); a git
 * edge is taken from an explicit directory, a local sibling repository, an
 * installed copy at its tag's version, the cache, or a clone.
 * @param {string} name - package name.
 * @param {string} spec - the dependency spec.
 * @param {{klineDir?: string, pluginDirs?: Map<string, string>, cache: string}} options - the run's sources.
 * @returns {string} the absolute directory holding the package.
 */
export function externalSource(name, spec, options) {
  // `--kline-dir` names one package; apply it to that edge only, or every other
  // external edge would be filled with the kline payload.
  if (name === KLINE && options.klineDir !== undefined) return options.klineDir
  const version = resolveRegistryVersion(name, spec)
  const localDir = options.pluginDirs?.get(name)
  if (localDir !== undefined) {
    if (version !== undefined) {
      console.log(`pack-tarball: ${name}@${version} from the local package (${localDir})`)
      return localDir
    }
    const ref = refOf(spec)
    console.log(`pack-tarball: ${name} from the local repository (${localDir} at ${ref || 'HEAD'})`)
    return localRepoSource(name, localDir, ref === '' ? 'HEAD' : ref, options.cache)
  }
  if (version !== undefined) {
    const installed = installedCopy(name, version)
    if (installed !== undefined) {
      console.log(`pack-tarball: ${name}@${version} from the installed profile (${installed})`)
      return installed
    }
    const cache = join(options.cache, `${directoryName(name)}-${version}`)
    if (existsSync(join(cache, 'package.json'))) return cache
    return registrySource(name, version, cache)
  }
  const ref = refOf(spec)
  const installed = installedCopy(name, ref.replace(/^v/u, ''))
  if (installed !== undefined) {
    console.log(`pack-tarball: ${name} from the installed profile (${installed})`)
    return installed
  }
  const cache = join(options.cache, `${directoryName(name)}-${ref === '' ? 'default' : ref}`)
  if (!existsSync(join(cache, 'package.json'))) {
    rmSync(cache, { recursive: true, force: true })
    const url = cloneUrl(spec)
    const args = ['clone', '--depth', '1', ...ref === '' ? [] : ['--branch', ref], url, cache]
    console.log(`pack-tarball: cloning ${url}${ref === '' ? '' : ` at ${ref}`}`)
    execFileSync('git', args, { stdio: 'inherit' })
  }
  return cache
}

/**
 * Download one published package's tarball and unpack it into the cache. The
 * npm cache is kept inside this repository so the run does not depend on (or
 * disturb) the machine's own `~/.npm` permissions.
 * @param {string} name - package name.
 * @param {string} version - exact version to fetch.
 * @param {string} dest - absolute cache directory for the unpacked package.
 * @returns {string} the absolute package directory.
 */
function registrySource(name, version, dest) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const download = join(dirname(dest), `.pack-${basename(dest)}`)
  rmSync(download, { recursive: true, force: true })
  mkdirSync(download, { recursive: true })
  console.log(`pack-tarball: ${name}@${version} from the registry`)
  const packed = spawnSync('npm', ['pack', `${name}@${version}`, '--pack-destination', download], {
    env: {
      ...process.env,
      npm_config_cache: join(repoRoot, 'tmp', 'npm-cache'),
      // The published packages live on the canonical registry; a mirror may lag
      // behind a fresh release and serve neither the packument nor the tarball.
      npm_config_registry: process.env.DSH_PACK_REGISTRY ?? 'https://registry.npmjs.org/',
    },
    encoding: 'utf8',
  })
  if (packed.status !== 0) {
    throw new Error(`npm pack ${name}@${version} failed:\n${packed.stdout ?? ''}${packed.stderr ?? ''}`)
  }
  const tarballs = readdirSync(download).filter(file => file.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`npm pack ${name}@${version} produced ${tarballs.length} tarball(s)`)
  }
  const untar = spawnSync('tar', ['-xzf', join(download, tarballs[0]), '-C', dest, '--strip-components=1'], { maxBuffer: 1 << 30 })
  if (untar.status !== 0) throw new Error(`tar extraction of ${tarballs[0]} failed: ${untar.stderr.toString()}`)
  rmSync(download, { recursive: true, force: true })
  const manifest = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`${name}@${version} resolved to ${manifest.name}@${manifest.version}`)
  }
  return dest
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
 * @param {{ref?: string, out?: string, klineDir?: string, pluginDirs?: Map<string, string>, keepStaging?: boolean}} options - the run's inputs.
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
      const source = externalSource(name, spec, {
        klineDir: options.klineDir,
        pluginDirs: options.pluginDirs,
        cache: join(repoRoot, 'tmp', 'standalone', '.cache'),
      })
      const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
      bundled.push({ name, manifest, source })
    }
  }
  // The intranet rows travel as a second patch file of this same bundle, so the
  // dependencies they name have to be inlined like every other plugin: the
  // internal file must install without reaching a git host.
  const intranet = []
  for (const patch of INTRANET_PATCHES) {
    const file = join(extractionRoot, BUNDLE_DIR, patch)
    if (!existsSync(file)) throw new Error(`${patch} is missing from ${ref}; the internal artifact cannot build without it`)
    for (const name of packageNamesIn(file)) {
      // Host packages are supplied by the DSH installation and carry no edge here.
      if (name.startsWith('@deepseek-ai/') || name.startsWith('cordis')) continue
      if (intranet.some(entry => entry.startsWith(`${name}@`))) continue
      const spec = bundle.dependencies?.[name]
      const staged = spec === undefined ? undefined : (() => {
        try {
          return join(extractionRoot, pathOf(spec))
        } catch {
          return undefined
        }
      })()
      if (staged !== undefined && existsSync(join(staged, 'package.json'))) {
        const manifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'))
        if (!bundled.some(plugin => plugin.name === name)) bundled.push({ name, manifest, source: staged })
        intranet.push(`${name}@${manifest.version}`)
        continue
      }
      // A published dependency is already inlined by the loop above.
      if (bundled.some(plugin => plugin.name === name)) {
        intranet.push(`${name}@${bundled.find(plugin => plugin.name === name).manifest.version}`)
        continue
      }
      throw new Error(`${patch} inserts ${name}, which this bundle neither depends on nor ships`)
    }
  }
  assertBundledRanges(bundled)
  const manifest = rewriteManifest(bundle, bundled)
  // The declared patch list is what selects the layer, and this artifact is the
  // only one that appends the intranet file. It also marks the artifact so a
  // reader can tell the two channels apart without reading the payload.
  manifest.dsh = { ...manifest.dsh, bundle: { ...manifest.dsh.bundle, patch: [bundle.dsh.bundle.patch, ...INTRANET_PATCHES] } }
  manifest.intranet = { patches: INTRANET_PATCHES }
  // `pnpm pack` filters through `files`, so naming the patch in the manifest is
  // not enough: the artifact must also list it there.
  manifest.files = [...(manifest.files ?? []), ...INTRANET_PATCHES.map(patch => patch.replace(/^\.\//u, ''))]
  const payload = join(staging, 'package')
  rmSync(payload, { recursive: true, force: true })
  mkdirSync(payload, { recursive: true })
  const bundleDir = join(extractionRoot, BUNDLE_DIR)
  // The intranet patch files are the one thing this artifact ships beyond the
  // package's own `files` list: they are deliberately excluded from a public
  // publish, so only this writer can put them in.
  const shipped = new Set([...shippedFiles(bundleDir, bundle), ...INTRANET_PATCHES.map(patch => patch.replace(/^\.\//u, ''))])
  for (const path of shipped) {
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
  assertDeclaredPatches(tarball, manifest)
  if (options.keepStaging !== true) rmSync(staging, { recursive: true, force: true })
  return { tarball, manifest, bundled: bundled.map(plugin => `${plugin.name}@${plugin.manifest.version}`), intranet, bytes: statSync(tarball).size, files, ref }
}

/**
 * Packages the intranet layer mounts, read from the layer itself.
 *
 * The layer file is dev-only: the public branch carries neither it nor any of
 * these names, and a literal list in a shared script would fail that branch's
 * no-internal-names gate. Names are therefore read, never written down here.
 * @param {string} [root] - repository root, for tests and callers outside this module.
 * @returns {string[]} plugin package names the layer inserts (host packages excluded).
 */
export function intranetPackageNames(root = repoRoot) {
  const names = []
  for (const patch of INTRANET_PATCHES) {
    const file = join(root, BUNDLE_DIR, patch)
    if (!existsSync(file)) continue
    for (const name of packageNamesIn(file)) {
      if (name.startsWith('@deepseek-ai/') || name.startsWith('cordis')) continue
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

/**
 * Refuse an artifact whose declared patch files are not inside it.
 *
 * `dsh.bundle.patch` is what the profile composer reads; a manifest naming a file
 * the tarball does not carry fails at install with ENOENT and no other symptom,
 * which is exactly how the intranet layer was silently dropped once.
 * @param {string} tarball - the packed artifact.
 * @param {object} manifest - the manifest written into it.
 */
function assertDeclaredPatches(tarball, manifest) {
  const declared = manifest.dsh?.bundle?.patch
  const patches = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared]
  if (patches.length === 0) return
  const listed = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`cannot list ${tarball}`)
  const entries = new Set(listed.stdout.split('\n').map(line => line.replace(/^package\//u, '')))
  for (const patch of patches) {
    const path = patch.replace(/^\.\//u, '')
    if (!entries.has(path)) throw new Error(`${manifest.name}: declares patch ${patch} but the artifact does not carry it`)
  }
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
  --plugin-dir <name>=<dir>
                       Take one external plugin from a local directory: a package
                       directory for a registry pin, or a sibling repository for
                       a git edge (extracted with git archive at the edge's ref).
                       Repeatable.
  --keep-staging       Keep tmp/standalone/.staging-<ref>/ for inspection.
  -h, --help           Print this help.

WHAT IT DOES
  Extracts packages/ from <ref> with git archive, keeps each package's own
  files entries (and fails loudly when a required entry is missing), then
  inlines the bundle's whole plugin set under its own node_modules: the
  unpublished packages from that extraction, and the published packages
  (kline included) from their registry tarballs. A package's nested
  node_modules is never copied. The rewritten manifest lists every inlined
  plugin in bundledDependencies, so pnpm installs the tarball without resolving
  a single git edge, and refuses a payload whose inlined versions do not satisfy
  the ranges the plugins declare for each other.

EXTERNAL SOURCES
  A registry pin (an exact version) is resolved from the registry tarball — the
  only place the published packages' built lib/ exists: an installed profile at
  exactly that version first, then the cache under tmp/standalone/.cache, then
  npm pack (its npm cache kept under tmp/, registry overridable with
  DSH_PACK_REGISTRY; the canonical registry is used by default because a mirror
  may not have a fresh release yet). A git edge is resolved in order: an
  explicit --plugin-dir, an installed profile at the tag's version, the cache,
  then a git clone — https for public hosts, ssh for the internal GitLab, whose
  https endpoint is not reachable.

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
    if (arg === '--plugin-dir') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error('--plugin-dir needs <package-name>=<directory>')
      const separator = value.indexOf('=')
      if (separator <= 0) throw new Error(`--plugin-dir needs <package-name>=<directory>: ${value}`)
      options.pluginDirs ??= new Map()
      options.pluginDirs.set(value.slice(0, separator), resolve(value.slice(separator + 1)))
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
  second layer (intranet only, public artifacts must not have it): ${result.intranet.join(', ') || '(none)'}
  still from the registry: ${registry.join(', ') || '(none)'}

Install it (the desktop profile is owned by the app, so quit the app first for the CLI path):
  GUI   plugin manager -> paste the absolute path above
  CLI   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \\
          plugin --profile desktop add ${result.tarball}

Publish it:
  GitLab (internal)  node scripts/upload-release-asset.mjs ${result.tarball} --version ${result.manifest.version} --release v${result.manifest.version}
  GitHub (public)    gh release create <tag> --repo FTShare-Lab/dsh-plugin-fft-bundle <this file>
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
