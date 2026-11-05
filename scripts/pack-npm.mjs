#!/usr/bin/env node
/**
 * Pack the sub-packages that ship on their own as standalone npm tarballs.
 *
 * The repository keeps every intra-repo dependency edge on `git+ssh://…#path:` on
 * purpose: the internal channels (the self-contained GitLab tarball and
 * `dsh plugin add git+…#path:`) pair the bundle with one commit, and
 * `scripts/edge-refs.mjs` rewrites those refs on a release. A package published
 * to npm cannot carry such an edge — pnpm classifies it as an exotic sub
 * dependency and the consumer's default profile rejects it — so this script
 * copies each publishable package into a staging directory and rewrites the
 * intra-repo edges to `^<version of that package in this workspace>`. The
 * repository manifests stay untouched; the only difference between source and
 * published manifest is that rewrite (plus dropping `scripts`/`devDependencies`,
 * which only matter in a checkout).
 *
 * Usage:
 *   node scripts/pack-npm.mjs [options]
 *
 * Options:
 *   --pkg <name>   Package to pack (repeatable; default: every publishable one)
 *   --out <dir>    Tarball directory (default: releases/npm)
 *   --dry-run      Stage and print the rewritten manifests, skip `npm pack`
 *   -h, --help     Print this help
 *
 * The tarballs and the `manifest.json` recording their versions, hashes and the
 * commit they came from are build output under `releases/npm/` (git-ignored);
 * `node scripts/upload.mjs --npm` publishes them.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, resolved from this script's location. */
export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const PACKAGES_DIR = join(repoRoot, 'packages')
const DEFAULT_OUT = join(repoRoot, 'releases', 'npm')
const STAGING_ROOT = join(repoRoot, 'tmp', 'npm')
const GIT = 'git'

/** Fields a published manifest keeps; everything else is repository-only. */
const PUBLISHED_FIELDS = [
  'name',
  'version',
  'description',
  'type',
  'main',
  'types',
  'license',
  'author',
  'homepage',
  'repository',
  'bugs',
  'keywords',
  'icon',
  'exports',
  'files',
  'publishConfig',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundledDependencies',
  'engines',
  'dsh',
]

/** A dependency spec that can never reach a default-profile consumer. */
const EXOTIC_SPEC = /^(?:git\+|git@|github:|gitlab:|bitbucket:|gist:|https?:|file:|link:|workspace:|path:)/iu

/** Files that must never reach a published tarball, whatever `files` says. */
const NEVER_COPY = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.env'])

/**
 * Packages published to npm from this repository, in publish order (a package
 * must be published before anything that depends on it from the registry).
 *
 * Empty on purpose: the two packages that used to be published from here —
 * settings and ftshare — live in the standalone `dsh-fft-base` repository and
 * are published from its own release tag. This repository still consumes them,
 * by exact registry version, but no longer publishes anything: the composition
 * bundle ships as an internal tarball / git edge, not as an npm package.
 *
 * Every consumer of this list tolerates the empty case; `pnpm pack:npm` says so
 * explicitly instead of silently packing nothing.
 *
 * @type {{dir: string, dropDependencies?: string[]}[]}
 */
export const PUBLISH_TARGETS = []

/**
 * Read every package manifest of the workspace.
 *
 * @param {string} [packagesDir] - Directory holding the packages.
 * @returns {Map<string, {dir: string, manifest: object}>} Manifest by package name.
 */
export function readWorkspace(packagesDir = PACKAGES_DIR) {
  const workspace = new Map()
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDir = join(packagesDir, entry.name)
    const manifestPath = join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    workspace.set(manifest.name, { dir: packageDir, manifest })
  }
  return workspace
}

/**
 * Build the manifest that goes into the published tarball.
 *
 * Only intra-repo edges change: each of them becomes `^<workspace version>` so a
 * consumer resolves it from the registry, and the ones a package only needs for
 * its own build (`dropDependencies`) are removed. Every other spec must already
 * be resolvable from a registry; the function throws otherwise, because such a
 * tarball would fail to install in the default profile.
 *
 * @param {object} manifest - The package's manifest in this repository.
 * @param {{workspace: Map<string, {dir: string, manifest: object}>, dropDependencies?: string[]}} context - Workspace and per-package policy.
 * @returns {object} The published manifest.
 */
export function publishManifest(manifest, { workspace, dropDependencies = [] }) {
  const published = {}
  for (const field of PUBLISHED_FIELDS) {
    if (manifest[field] !== undefined) published[field] = structuredClone(manifest[field])
  }

  const dependencies = {}
  for (const [name, spec] of Object.entries(published.dependencies ?? {})) {
    if (dropDependencies.includes(name)) continue
    const dependency = workspace.get(name)
    if (dependency !== undefined) {
      dependencies[name] = `^${dependency.manifest.version}`
      continue
    }
    if (EXOTIC_SPEC.test(spec) || spec.includes('&path:')) {
      throw new Error(`${manifest.name}: dependency ${name}@${spec} is not registry-resolvable; add it to dropDependencies or publish it first`)
    }
    dependencies[name] = spec
  }
  if (Object.keys(dependencies).length > 0) published.dependencies = dependencies
  else delete published.dependencies

  published.publishConfig = { ...(published.publishConfig ?? {}), access: 'public' }
  return published
}

/**
 * Expand one `files` entry into concrete source paths.
 *
 * `files` may name a file, a directory, or one segment of globbing
 * (`locale/*.json`, `lib/** /*.d.ts`). Negations are ignored: the publishable
 * packages do not use them, and a negation that silently changed the tarball
 * would be worse than failing the pack check.
 *
 * @param {string} packageDir - Package root.
 * @param {string} entry - One `files` entry.
 * @returns {string[]} Paths relative to the package root.
 */
function expandFilesEntry(packageDir, entry) {
  if (entry.startsWith('!')) return []
  if (!entry.includes('*')) return [entry]
  const base = entry.slice(0, entry.indexOf('*')).replace(/\/$/u, '')
  const pattern = new RegExp(`^${entry.split('/').map(part => part.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*\*/gu, '.*').replace(/\*/gu, '[^/]*')).join('/')}$`, 'u')
  const out = []
  const walk = directory => {
    for (const child of readdirSync(join(packageDir, directory), { withFileTypes: true })) {
      const candidate = directory === '' ? child.name : `${directory}/${child.name}`
      if (NEVER_COPY.has(child.name)) continue
      if (child.isDirectory()) {
        if (entry.includes('**')) walk(candidate)
        continue
      }
      if (pattern.test(candidate)) out.push(candidate)
    }
  }
  walk(base)
  return out
}

/**
 * Copy a package's `files` into the staging tree.
 *
 * @param {{dir: string, manifest: object}} target - Package being staged.
 * @param {string} stagingDir - Destination package directory.
 * @returns {string[]} Copied paths relative to the package root.
 */
function stageFiles(target, stagingDir) {
  const copied = []
  for (const [index, entry] of (target.manifest.files ?? []).entries()) {
    if (entry === 'package.json') continue
    for (const path of expandFilesEntry(target.dir, entry)) {
      const source = join(target.dir, path)
      if (!existsSync(source)) {
        throw new Error(`${target.manifest.name}: files[${index}] "${entry}" does not exist (${path})`)
      }
      const destination = join(stagingDir, path)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(source, destination, {
        recursive: true,
        filter: from => {
          const name = basename(from)
          if (NEVER_COPY.has(name)) return false
          if (name.endsWith('.pyc')) return false
          return true
        },
      })
      copied.push(path)
    }
  }
  return copied
}

/** @param {string} tarball - Archive path. */
function sha256(tarball) {
  return createHash('sha256').update(readFileSync(tarball)).digest('hex')
}

/** @param {string} tarball - Archive path. */
function readPackedManifest(tarball) {
  const result = spawnSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`cannot read package/package.json from ${tarball}: ${result.stderr.trim()}`)
  return JSON.parse(result.stdout)
}

/**
 * Verify a packed tarball: the manifest is the rewritten one, every declared
 * file is present, and no dependency edge could be exotic for a consumer.
 *
 * @param {string} tarball - Archive path.
 * @param {object} published - Manifest the tarball must carry.
 * @param {{name: string, version: string, required?: string[]}} target - Package being packed.
 */
function verifyTarball(tarball, published, target) {
  const manifest = readPackedManifest(tarball)
  if (manifest.name !== published.name || manifest.version !== published.version) {
    throw new Error(`${target.name}: tarball manifest is ${manifest.name}@${manifest.version}, expected ${published.name}@${published.version}`)
  }
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (EXOTIC_SPEC.test(spec) || spec.includes('&path:')) throw new Error(`${target.name}: tarball still depends on ${name}@${spec}`)
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string') throw new Error(`${target.name}: tarball has no dsh.bundle.patch`)
  const listed = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`${target.name}: cannot list ${tarball}`)
  const entries = new Set(listed.stdout.split('\n').map(line => line.replace(/^package\//u, '').replace(/\/$/u, '')).filter(Boolean))
  for (const required of ['package.json', 'lib/index.js', 'README.md', 'LICENSE', patch.replace(/^\.\//u, ''), ...(target.required ?? [])]) {
    if (!entries.has(required)) throw new Error(`${target.name}: tarball is missing ${required}`)
  }
}

/**
 * Stage one package and (unless dry-run) pack it.
 *
 * @param {{dir: string, dropDependencies?: string[]}} target - Package to pack.
 * @param {Map<string, {dir: string, manifest: object}>} workspace - Workspace manifests.
 * @param {{outDir: string, dryRun: boolean, head: string}} options - Run options.
 * @returns {object} Pack summary recorded in `manifest.json`.
 */
export function packPackage(target, workspace, { outDir, dryRun, head }) {
  const manifest = workspace.get(JSON.parse(readFileSync(join(repoRoot, target.dir, 'package.json'), 'utf8')).name).manifest
  const published = publishManifest(manifest, { workspace, dropDependencies: target.dropDependencies })
  const stagingDir = join(STAGING_ROOT, basename(target.dir), 'package')
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(stagingDir, { recursive: true })

  const files = stageFiles({ dir: join(repoRoot, target.dir), manifest }, stagingDir)
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(published, null, 2)}\n`)
  files.push('package.json')

  const summary = {
    name: published.name,
    version: published.version,
    dir: target.dir,
    dependencies: published.dependencies ?? {},
    files: files.sort(),
    head,
  }
  if (dryRun) return summary

  mkdirSync(outDir, { recursive: true })
  const pack = spawnSync('npm', ['pack', '--pack-destination', outDir], { cwd: stagingDir, encoding: 'utf8' })
  if (pack.status !== 0) throw new Error(`npm pack failed for ${published.name}: ${pack.stderr.trim()}`)
  const tarball = join(outDir, pack.stdout.trim().split('\n').at(-1))
  verifyTarball(tarball, published, { name: published.name, version: published.version })
  return {
    ...summary,
    tarball: relative(repoRoot, tarball),
    sha256: sha256(tarball),
    bytes: statSync(tarball).size,
  }
}

/** @returns {string} Current commit. */
function headCommit() {
  const result = spawnSync(GIT, ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git rev-parse HEAD failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

const HELP = `pack-npm — pack the standalone sub-packages as npm tarballs

USAGE
  node scripts/pack-npm.mjs [options]
  pnpm pack:npm [options]

OPTIONS
  --pkg <name>   Package to pack (repeatable; default: every publishable one)
  --out <dir>    Tarball directory (default: releases/npm)
  --dry-run      Stage and print the rewritten manifests, skip npm pack
  -h, --help     Print this help

WHAT IT DOES
  Copies each package's \`files\` into tmp/npm/<pkg>/package, rewrites the
  intra-repo git+path edges to ^<workspace version>, runs npm pack into
  releases/npm/, verifies the tarball, and records versions, hashes and the
  commit in releases/npm/manifest.json. Repository manifests are untouched;
  publish with \`node scripts/upload.mjs --npm\`.`

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP)
    process.exit(0)
  }
  const values = name => argv.flatMap((argument, index) => (argument === `--${name}` && argv[index + 1] !== undefined ? [argv[index + 1]] : []))
  const dryRun = argv.includes('--dry-run')
  const outDir = resolve(repoRoot, values('out').at(-1) ?? DEFAULT_OUT)
  const selected = values('pkg')
  const workspace = readWorkspace()
  const targets = PUBLISH_TARGETS.filter(target => {
    if (selected.length === 0) return true
    const name = workspace.get(JSON.parse(readFileSync(join(repoRoot, target.dir, 'package.json'), 'utf8')).name).manifest.name
    return selected.includes(name)
  })
  if (targets.length === 0) {
    console.error(`pack-npm: no publishable package matches ${selected.join(', ') || '(all)'}`)
    process.exit(1)
  }

  const head = headCommit()
  const packed = []
  for (const target of targets) {
    const result = packPackage(target, workspace, { outDir, dryRun, head })
    packed.push(result)
    const size = result.bytes === undefined ? '' : `, ${(result.bytes / 1024).toFixed(0)} KB`
    console.log(`[npm] ${result.name}@${result.version}${dryRun ? ' (dry-run)' : ` -> ${result.tarball}${size}`}`)
    console.log(`      dependencies: ${Object.entries(result.dependencies).map(([name, spec]) => `${name}@${spec}`).join(', ') || '(none)'}`)
    if (dryRun) console.log(`      files: ${result.files.join(', ')}`)
  }
  if (dryRun) {
    console.log('[npm] dry-run: staged manifests are under tmp/npm/, nothing was packed')
  } else {
    const manifestPath = join(outDir, 'manifest.json')
    writeFileSync(manifestPath, `${JSON.stringify({ head, generatedAt: new Date().toISOString(), packages: packed }, null, 2)}\n`)
    console.log(`[npm] wrote ${relative(repoRoot, manifestPath)} — publish with: node scripts/upload.mjs --npm`)
  }
}
