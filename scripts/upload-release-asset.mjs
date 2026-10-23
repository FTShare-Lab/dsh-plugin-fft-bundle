#!/usr/bin/env node
/**
 * Upload one release artifact to the GitLab Generic Package Registry and print
 * the links a Release page should carry.
 *
 * Why not the release commit any more: a tarball committed into the release
 * commit grows the repository by ~7 MB per version forever, while the package
 * registry stores the same file under a package/version path that a Release
 * asset link can point at. Releases that already shipped keep their committed
 * file — history is immutable and the links already handed out must keep
 * working.
 *
 * Usage: `node scripts/upload-release-asset.mjs --help`.
 *
 * Environment (read from the repository-root `.env` when not already set):
 *   GITLAB_URL      GitLab base URL, e.g. https://gitlab.example.com
 *   GITLAB_TOKEN    token with `api` scope
 *   GITLAB_PROJECT  project numeric id or full path; defaults to the path of
 *                   the repository's `gitlab` remote
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this script's location. */
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** The package name a bundle artifact is published under. */
const DEFAULT_PACKAGE = 'ft-dsh-fft-bundle'

const HELP = `upload-release-asset — publish a release tarball and wire it into a GitLab Release

USAGE
  node scripts/upload-release-asset.mjs [<file.tgz>] [options]

ARGUMENTS
  <file.tgz>           Artifact to upload. Defaults to
                       releases/gitlab/<package>-<version>.tgz.

OPTIONS
  --version <X.Y.Z>    Package version. Defaults to the bundle's version.
  --package <name>     Package name to publish under. Default:
                       ${DEFAULT_PACKAGE}.
  --project <ref>      Project numeric id or full path (overrides GITLAB_PROJECT).
  --release <tag>      Add the download as an asset link of this Release when it
                       exists (skipped when the link is already there).
  --dry-run            Print what would be uploaded without calling the API.
  -h, --help           Print this help.

ENVIRONMENT
  GITLAB_URL, GITLAB_TOKEN, GITLAB_PROJECT — see the header of this file.
  The repository-root .env is read when a variable is unset.

EXAMPLES
  node scripts/upload-release-asset.mjs --release v0.8.0
  node scripts/upload-release-asset.mjs releases/gitlab/ft-dsh-fft-bundle-0.7.2.tgz
`

/** Split the command line into the file and the options. */
function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') return { help: true }
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg.startsWith('--')) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      options[arg.slice(2)] = value
      index += 1
      continue
    }
    if (options.file !== undefined) throw new Error(`one artifact at a time: ${options.file} and ${arg} were both given`)
    options.file = arg
  }
  return options
}

/** Read KEY=value lines from the repository-root .env without overriding the environment. */
function loadDotEnv() {
  const path = resolve(repoRoot, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim())
    if (match !== null && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
}

/** The project path of the repository's `gitlab` remote, e.g. `group/project`. */
function projectFromRemote() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'gitlab'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    return /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/u.exec(url)?.[1]
  } catch {
    return undefined
  }
}

/** The bundle's version, used when `--version` is absent. */
function bundleVersion() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages/dsh-fft-bundle/package.json'), 'utf8')).version
}

/** Encode a project reference for the API path: numeric ids stay as-is, paths are escaped. */
function projectPath(project) {
  return /^\d+$/u.test(project) ? project : encodeURIComponent(project)
}

/** Call one API endpoint, returning the parsed body and the status. */
async function api(base, token, path, init = {}) {
  const response = await fetch(`${base}/api/v4${path}`, {
    ...init,
    headers: { 'PRIVATE-TOKEN': token, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let body
  try {
    body = text === '' ? undefined : JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

/** Resolve the package and file records of an already published artifact. */
async function lookupPublished(base, token, key, packageName, version, fileName) {
  const packages = await api(base, token, `/projects/${key}/packages?package_type=generic&order_by=created_at&sort=desc&per_page=100`)
  if (packages.status >= 300) throw new Error(`package lookup failed: ${packages.status}`)
  const found = (Array.isArray(packages.body) ? packages.body : [])
    .find(entry => entry.name === packageName && entry.version === version)
  if (found === undefined) return { found: undefined, fileEntry: undefined }
  const files = await api(base, token, `/projects/${key}/packages/${found.id}/package_files?per_page=100`)
  if (files.status >= 300) throw new Error(`package file lookup failed: ${files.status}`)
  const fileEntry = (Array.isArray(files.body) ? files.body : []).find(entry => entry.file_name === fileName)
  return { found, fileEntry }
}

/** Upload the artifact, then resolve its package and file ids. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log(HELP)
    return
  }
  loadDotEnv()

  const version = options.version ?? bundleVersion()
  const packageName = options.package ?? DEFAULT_PACKAGE
  const project = options.project ?? process.env.GITLAB_PROJECT ?? projectFromRemote()
  const base = (process.env.GITLAB_URL ?? '').replace(/\/+$/u, '')
  const token = process.env.GITLAB_TOKEN
  const file = resolve(repoRoot, options.file ?? `releases/gitlab/${packageName}-${version}.tgz`)

  const missing = [
    base === '' ? 'GITLAB_URL' : undefined,
    token === undefined || token === '' ? 'GITLAB_TOKEN' : undefined,
    project === undefined ? 'GITLAB_PROJECT（或仓库的 gitlab remote）' : undefined,
  ].filter(Boolean)
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`)
  if (!existsSync(file)) throw new Error(`no artifact at ${file}（先运行 pnpm pack:tarball）`)

  const key = projectPath(project)
  const name = basename(file)
  const encodedPackage = encodeURIComponent(packageName)
  const encodedVersion = encodeURIComponent(version)
  const apiUrl = `${base}/api/v4/projects/${key}/packages/generic/${encodedPackage}/${encodedVersion}/${encodeURIComponent(name)}`

  if (options.dryRun === true) {
    console.log(`would upload ${file} (${(statSync(file).size / 1e6).toFixed(1)} MB)`)
    console.log(`  PUT ${apiUrl}`)
    return
  }

  // Publishing is idempotent per package version: when the file is already
  // there, keep it and only re-wire the links (re-uploading would duplicate it).
  let published = await lookupPublished(base, token, key, packageName, version, name)
  const existed = published.found !== undefined && published.fileEntry !== undefined
  if (!existed) {
    const upload = await api(base, token, `/projects/${key}/packages/generic/${encodedPackage}/${encodedVersion}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(file),
    })
    if (upload.status >= 300) throw new Error(`upload failed: ${upload.status} ${JSON.stringify(upload.body)}`)
    published = await lookupPublished(base, token, key, packageName, version, name)
  }
  const { found, fileEntry } = published
  if (found === undefined) throw new Error(`uploaded ${name}, but the package ${packageName}@${version} is not listed`)
  if (fileEntry === undefined) throw new Error(`uploaded ${name}, but it is not listed in package ${found.id}`)

  const projectWeb = `${base}/${project.replace(/^\//u, '')}`
  const assetUrl = `${projectWeb}/-/package_files/${fileEntry.id}/download`
  const packagePage = `${projectWeb}/-/packages/${found.id}`

  console.log(`${existed ? 'already published' : 'uploaded'} ${name} (${(statSync(file).size / 1e6).toFixed(1)} MB)`)
  console.log(`  package        ${packageName}@${version} (id ${found.id})`)
  console.log(`  release asset  ${assetUrl}`)
  console.log(`  package page   ${packagePage}`)
  console.log(`  api download   ${apiUrl}`)

  if (options.release !== undefined) {
    const tag = options.release
    const release = await api(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}`)
    if (release.status === 404) {
      console.log(`  release ${tag} 不存在：先建 Release 再重跑，或跳过 --release`)
      return
    }
    if (release.status >= 300) throw new Error(`release lookup failed: ${release.status}`)
    const links = release.body?.assets?.links ?? []
    if (links.some(link => link.url === assetUrl)) {
      console.log(`  release ${tag} 已有该资产链接`)
      return
    }
    // A link name is unique per Release: when an older link carries the same
    // file name (for example the pre-package-registry repository blob), point
    // it at the package file instead of failing.
    const sameName = links.find(link => link.name === name)
    const written = sameName === undefined
      ? await api(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}/assets/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, url: assetUrl, link_type: 'package' }),
        })
      : await api(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}/assets/links/${sameName.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, url: assetUrl, link_type: 'package' }),
        })
    if (written.status >= 300) throw new Error(`writing the release asset failed: ${written.status} ${JSON.stringify(written.body)}`)
    console.log(`  release ${tag} 资产链接已${sameName === undefined ? '添加' : '更新'}`)
  }
}

main().catch((error) => {
  console.error(`upload-release-asset: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
