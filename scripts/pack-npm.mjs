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
import { externalSource, intranetPackageNames } from './pack-tarball.mjs'
import { pruneStaged } from './pack-prune.mjs'

/** Repository root, resolved from this script's location. */
export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const PACKAGES_DIR = join(repoRoot, 'packages')
const DEFAULT_OUT = join(repoRoot, 'releases', 'npm')
const STAGING_ROOT = join(repoRoot, 'tmp', 'npm')
const GIT = 'git'

/** The third-party plugin a published package inlines rather than declares. */
const KLINE = '@ftshare-lab/dsh-kline'

/**
 * Edges a published package must never carry: their packages exist only inside
 * this repository, so a registry consumer could not resolve them. Their rows
 * live in the intranet layer, which `files` keeps out of the artifact. Read from
 * that layer rather than listed here — the public branch must contain neither
 * the names nor the file.
 */
const INTRANET_EDGES = intranetPackageNames()

/** Exotic edges that are carried inside the artifact instead of declared. */
const INLINE_EXOTIC = new Set([KLINE])

/**
 * Workspace packages carried inside the artifact rather than resolved from a
 * registry. These serve the composition bundle alone and are not published on
 * their own, so a registry consumer has no name to resolve; publishing them
 * would make them independently installable products, which they are not.
 *
 * Empty on purpose: every workspace package this entry consumed is gone from
 * its manifest (the remaining plugins come from a registry or carry their own
 * payload), so nothing is staged under `node_modules` beyond the exotic ones.
 * A new in-repo plugin goes here only if it is meant to ship inside this
 * artifact without a registry name of its own.
 */
const INLINE_WORKSPACE = new Set()

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
 * Settings and ftshare are not here: they live in the standalone `dsh-fft-base`
 * repository and are published from its own release tag. This repository
 * consumes them by exact registry version.
 *
 * `dropDependencies` names the edges the public channel must not carry. The SSO
 * and the internal collaboration plugin are intranet-only: their rows live in
 * `cordis.intranet.patch.yml`, which `files` keeps out of this tarball, and
 * their git edges would make a registry install fail outright. The internal
 * tarball keeps both, because `pack-tarball.mjs` inlines them from this tree.
 *
 * @type {{dir: string, dropDependencies?: string[]}[]}
 */
export const PUBLISH_TARGETS = [
  {
    dir: 'packages/dsh-fft-bundle',
    dropDependencies: INTRANET_EDGES,
    inlineDependencies: [...INLINE_EXOTIC],
    inlineWorkspace: [...INLINE_WORKSPACE],
  },
]

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
      // A workspace package that is not published on its own travels inside the
      // artifact instead of asking a consumer to resolve a name no registry has.
      if (INLINE_WORKSPACE.has(name)) {
        dependencies[name] = dependency.manifest.version
        continue
      }
      dependencies[name] = `^${dependency.manifest.version}`
      continue
    }
    // A third-party git edge is kept as-is for now and turned into a bundled
    // dependency by `inlineExotic`, which copies the payload into the artifact.
    // Nothing else may stay exotic: such a spec fails in a default profile.
    if (EXOTIC_SPEC.test(spec) || spec.includes('&path:')) {
      if (!name.startsWith('@') || workspace.has(name)) {
        throw new Error(`${manifest.name}: dependency ${name}@${spec} is not registry-resolvable; add it to dropDependencies or publish it first`)
      }
      if (!INLINE_EXOTIC.has(name)) {
        throw new Error(`${manifest.name}: dependency ${name}@${spec} is not registry-resolvable and not in the inline list; publish it or drop it`)
      }
      dependencies[name] = spec
      continue
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
/**
 * Every file one package's `files` field ships, excluding `package.json`.
 * @param {string} dir - absolute package directory.
 * @param {object} manifest - the package manifest.
 * @returns {string[]} `/`-joined relative paths.
 */
function shippedPaths(dir, manifest) {
  return (manifest.files ?? []).flatMap(entry => entry === 'package.json' ? [] : expandFilesEntry(dir, entry))
}

/**
 * Copy one package's shipped files into a destination directory.
 * @param {string} from - absolute source package directory.
 * @param {string} to - absolute destination directory.
 * @param {object} manifest - the source manifest whose `files` field selects.
 */
function copyPackageFiles(from, to, manifest) {
  for (const path of shippedPaths(from, manifest)) {
    const source = join(from, path)
    if (!existsSync(source)) throw new Error(`${manifest.name}: files entry "${path}" does not exist`)
    const destination = join(to, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination, { recursive: true, filter: file => !NEVER_COPY.has(basename(file)) && !basename(file).endsWith('.pyc') })
  }
  writeFileSync(join(to, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

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
 * The top-level paths a tarball carries, for the run summary.
 * @param {string} tarball - absolute path to a `.tgz`.
 * @returns {string[]} sorted `package/`-relative entries.
 */
function listTarball(tarball) {
  const listed = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`cannot list ${tarball}`)
  return listed.stdout.split('\n')
    .map(line => line.replace(/^package\//u, '').replace(/\/$/u, ''))
    .filter(Boolean)
    .sort()
}

/**
 * Copy the exotic-spec dependencies into the package and declare them bundled.
 *
 * pnpm filters a git-spec `bundledDependencies` entry and never resolves it, so
 * the copy has to happen here rather than through the dependency resolution. The
 * declared range becomes a lower bound on the inlined version: this package
 * names kline's rows but never calls its API, so any build at or above the one it
 * was tested with works, and an exact pin would force a republish per kline
 * upgrade.
 * @param {object} published - Manifest already rewritten for publishing.
 * @param {string} stagingDir - Directory the package is assembled in.
 * @param {string[]} files - Staged file list to extend.
 * @returns {{manifest: object}} the manifest to write into the staging directory.
 */
function inlineExotic(published, stagingDir, files, workspace = readWorkspace()) {
  const specs = Object.entries(published.dependencies ?? {})
    .filter(([name, spec]) => EXOTIC_SPEC.test(spec) || INLINE_WORKSPACE.has(name))
  if (specs.length === 0) return { manifest: published }
  const dependencies = { ...published.dependencies }
  const bundled = [...(published.bundledDependencies ?? [])]
  for (const [name, spec] of specs) {
    const local = workspace.get(name)
    if (local !== undefined && INLINE_WORKSPACE.has(name)) {
      // Ship what the package's own `main` points at. A TypeScript package must
      // be built first; a plain-source package (its `main` already lives under
      // `src/`) needs nothing. Shipping an unbuilt TS tree would install a
      // package whose entry point does not exist.
      const entry = local.manifest.main
      if (entry !== undefined && !existsSync(join(local.dir, entry))) {
        throw new Error(`${name}: ${entry} is missing; run pnpm build before packing the npm artifact`)
      }
      const dest = join(stagingDir, 'node_modules', ...name.split('/'))
      copyPackageFiles(local.dir, dest, local.manifest)
      const pruned = pruneStaged(name, dest)
      for (const rule of pruned.unmatched) {
        console.warn(`pack-npm: prune rule ${JSON.stringify(rule)} of ${name} matched nothing; the payload may have changed shape`)
      }
      files.push(...shippedPaths(local.dir, local.manifest).map(path => join('node_modules', name, path)))
      dependencies[name] = local.manifest.version
      if (!bundled.includes(name)) bundled.push(name)
      continue
    }
    const source = externalSource(name, spec, { cache: join(repoRoot, 'tmp', 'standalone', '.cache') })
    const inlineManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const dest = join(stagingDir, 'node_modules', ...name.split('/'))
    copyPackageFiles(source, dest, inlineManifest)
    // The archive carries store screenshots and build inputs no installed code
    // reads; keeping them would roughly double the artifact for nothing.
    const pruned = pruneStaged(name, dest)
    for (const rule of pruned.unmatched) {
      console.warn(`pack-npm: prune rule ${JSON.stringify(rule)} of ${name} matched nothing; the payload may have changed shape`)
    }
    // Report what actually shipped: the prune below removes part of it.
    files.push(...shippedPaths(source, inlineManifest).map(path => join('node_modules', name, path)))
    dependencies[name] = `>=${inlineManifest.version}`
    bundled.push(name)
  }
  return { manifest: { ...published, dependencies, bundledDependencies: bundled } }
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
  // A third-party plugin that no registry serves travels inside the package, the
  // way `@dsh-ft/dsh-fft-paper-trading` carries its own kline: copy it under
  // `node_modules` and name it in `bundledDependencies`. `npm pack` then ships
  // the directory, and a consumer resolves the patch row against it.
  const inlined = inlineExotic(published, stagingDir, files, workspace)
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(inlined.manifest, null, 2)}\n`)
  files.push('package.json')
  Object.assign(published, inlined.manifest)

  const summary = {
    name: published.name,
    version: published.version,
    dir: target.dir,
    dependencies: published.dependencies ?? {},
    // A dry run reports the staged set, pruned files included, because nothing
    // is packed yet; a real run replaces it with the tarball's own listing.
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
    files: listTarball(tarball),
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
