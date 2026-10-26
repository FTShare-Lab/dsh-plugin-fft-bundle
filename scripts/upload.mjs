#!/usr/bin/env node
/**
 * Publish the release artifacts to a distribution channel.
 *
 * Channels are flags and one run handles one channel, mirroring the
 * paper-trading repository's upload script:
 *
 *   node scripts/upload.mjs --npm [options]
 *
 * The artifact is the tarball `pnpm pack:npm` produced under `releases/npm/`,
 * together with the `manifest.json` recording versions, hashes and the commit.
 * `--npm` publishes each tarball to registry.npmjs.org with public access.
 * Credentials come from the caller's npm environment (an `npm login`, a user
 * config via `NPM_CONFIG_USERCONFIG`, or the registry token the environment
 * already carries) — never from this repository.
 *
 * Publishing is resumable per version: an already published `name@version` is
 * kept and only its dist-tag is (re)wired, so a half-finished release can be
 * re-run. Re-packing the same version is not supported — bump the version.
 *
 * Usage:
 *   node scripts/upload.mjs --npm [options]
 *
 * Options:
 *   --pkg <name>    Package to publish (repeatable; default: every packed one)
 *   --tag <tag>     dist-tag to publish under (default: latest; publish with
 *                   `next` first, verify a clean install, then `--promote`)
 *   --promote       Move `latest` to the versions just verified
 *   --otp <code>    One-time password for accounts with 2FA on publish
 *   --registry <u>  Registry (default: https://registry.npmjs.org/)
 *   --dry-run       Print the plan without publishing
 *   -h, --help      Print this help
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
const NPM = 'npm'

const HELP = `upload — publish the packed artifacts to a distribution channel

USAGE
  node scripts/upload.mjs --npm [options]

CHANNELS
  --npm   npm publish each tarball in releases/npm/ to registry.npmjs.org with
          public access. Credentials come from the caller's npm environment.

OPTIONS
  --pkg <name>    Package to publish (repeatable; default: every packed one)
  --tag <tag>     dist-tag to publish under (default: latest)
  --promote       Move latest to the versions just verified
  --otp <code>    One-time password for accounts with 2FA on publish
  --registry <u>  Registry (default: https://registry.npmjs.org/)
  --dry-run       Print the plan without publishing
  -h, --help      Print this help

The tarballs come from \`pnpm pack:npm\` (releases/npm/manifest.json).`

const fail = message => {
  throw new Error(message)
}

/**
 * Run a command in the repository.
 *
 * @param {string[]} args - Arguments for `npm`.
 * @param {{stdio?: 'inherit'|'pipe'}} [options] - stdio mode.
 * @returns {{status: number, stdout: string, stderr: string}} Result.
 */
const npm = (args, { stdio = 'pipe' } = {}) => spawnSync(NPM, args, { cwd: repoRoot, encoding: 'utf8', stdio })

/**
 * Registry metadata for one version, or undefined when it is not published.
 *
 * @param {string} name - Package name.
 * @param {string} version - Exact version.
 * @param {string} registry - Registry URL.
 * @returns {string|undefined} The published version, when present.
 */
const publishedVersion = (name, version, registry) => {
  const view = npm(['view', `${name}@${version}`, 'version', '--registry', registry])
  return view.status === 0 && view.stdout.trim() !== '' ? view.stdout.trim() : undefined
}

/** @param {string} path - File path. */
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

const ensureAuthenticated = registry => {
  const whoami = npm(['whoami', '--registry', registry])
  if (whoami.status !== 0) {
    fail(
      `npm is not authenticated for ${registry}. Log in first (or point NPM_CONFIG_USERCONFIG at a config with the token), then re-run:\n`
      + `  npm login --registry ${registry}\n`
      + `  # CI: export NPM_CONFIG_USERCONFIG=/path/to/npmrc containing //registry.npmjs.org/:_authToken=…`,
    )
  }
  console.log(`[npm] authenticated as ${whoami.stdout.trim()}`)
}

/** @param {number} ms - Milliseconds. */
const sleep = ms => new Promise(done => setTimeout(done, ms))

/**
 * Wait for a published version to become readable.
 *
 * `npm publish` returns as soon as the registry accepted the PUT, but the read
 * side is behind a CDN: a `npm view` issued immediately afterwards can still see
 * the previous state for a few seconds. Publishing is asynchronous anyway, so
 * poll instead of failing a publish that actually succeeded.
 *
 * @param {string} name - Package name.
 * @param {string} version - Exact version.
 * @param {string} registry - Registry URL.
 * @param {{attempts?: number, delayMs?: number}} [options] - Poll budget.
 * @returns {Promise<string|undefined>} The published version, when it appears.
 */
const waitForVersion = async (name, version, registry, { attempts = 15, delayMs = 3000 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const published = publishedVersion(name, version, registry)
    if (published !== undefined) return published
    await sleep(delayMs)
  }
  return undefined
}

const uploadNpm = async ({ records, registry, tag, promote, otp, dryRun }) => {
  const work = records.map(record => ({
    ...record,
    tarballPath: resolve(repoRoot, record.tarball),
  }))
  for (const record of work) {
    if (!existsSync(record.tarballPath)) fail(`artifact not found: ${record.tarball}（先运行 pnpm pack:npm）`)
    const actual = sha256(record.tarballPath)
    if (record.sha256 !== undefined && actual !== record.sha256) {
      fail(`${record.tarball} changed since it was packed (sha256 ${actual}); run pnpm pack:npm again`)
    }
  }

  if (dryRun) {
    for (const record of work) {
      const published = publishedVersion(record.name, record.version, registry)
      console.log(`[npm] would ${published === undefined ? 'publish' : 'skip (already published)'} ${record.name}@${record.version} (tag ${tag})`)
      if (promote) console.log(`[npm] would move latest -> ${record.name}@${record.version}`)
    }
    console.log('[npm] dry-run: nothing was published')
    return
  }

  ensureAuthenticated(registry)
  for (const record of work) {
    const already = publishedVersion(record.name, record.version, registry)
    if (already === undefined) {
      const args = ['publish', record.tarballPath, '--registry', registry, '--access', 'public', '--tag', tag]
      if (otp !== undefined) args.push('--otp', otp)
      console.log(`[npm] publishing ${record.name}@${record.version} (tag ${tag})`)
      const result = npm(args)
      if (result.stdout.trim() !== '') console.log(result.stdout.trim())
      if (result.stderr.trim() !== '') console.error(result.stderr.trim())
      if (result.status !== 0) {
        // A rejected PUT is not always a failed publish: npm rejects a version
        // that is already on the registry (a previous run whose PUT succeeded
        // but whose read side had not caught up), and the read side can lag the
        // write by minutes for a brand-new scoped package. Treat the registry's
        // own duplicate verdict as success; poll before failing anything else.
        if (/previously published versions|EPUBLISHCONFLICT|Cannot publish over/iu.test(result.stderr)) {
          console.log(`[npm] ${record.name}@${record.version} was already on the registry, keeping it`)
        } else if (await waitForVersion(record.name, record.version, registry, { attempts: 4, delayMs: 3000 }) === undefined) {
          fail(`npm publish failed for ${record.name}@${record.version}`)
        }
      }
    } else {
      console.log(`[npm] ${record.name}@${record.version} is already published, keeping it`)
    }
    if (await waitForVersion(record.name, record.version, registry) === undefined) {
      fail(`npm publish finished but ${record.name}@${record.version} is not readable from ${registry}`)
    }
    if (promote) {
      const tagged = npm(['dist-tag', 'add', `${record.name}@${record.version}`, 'latest', '--registry', registry])
      if (tagged.status !== 0) fail(`npm dist-tag failed for ${record.name}@${record.version}: ${tagged.stderr.trim()}`)
      console.log(`[npm] latest -> ${record.name}@${record.version}`)
    }
    console.log(`[npm] ${record.name}@${record.version}: https://www.npmjs.com/package/${record.name}/v/${record.version}`)
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(scriptPath)

if (invokedDirectly) {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP)
    process.exit(0)
  }
  const values = name => argv.flatMap((argument, index) => (argument === `--${name}` && argv[index + 1] !== undefined ? [argv[index + 1]] : []))
  try {
    if (!argv.includes('--npm')) fail('choose a channel: node scripts/upload.mjs --npm (channels are flags, one per run)')
    const dryRun = argv.includes('--dry-run')
    const promote = argv.includes('--promote')
    const registry = values('registry').at(-1) ?? DEFAULT_REGISTRY
    const tag = values('tag').at(-1) ?? 'latest'
    const otp = values('otp').at(-1)
    const selected = values('pkg')
    const manifestPath = resolve(repoRoot, 'releases', 'npm', 'manifest.json')
    if (!existsSync(manifestPath)) fail('releases/npm/manifest.json not found; run pnpm pack:npm first')
    const packed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const records = packed.packages.filter(record => selected.length === 0 || selected.includes(record.name))
    if (records.length === 0) fail(`no packed package matches ${selected.join(', ') || '(all)'}`)
    console.log(`[npm] packed by ${packed.head}${packed.generatedAt === undefined ? '' : ` at ${packed.generatedAt}`}`)
    await uploadNpm({ records, registry, tag, promote, otp, dryRun })
  } catch (error) {
    console.error(`upload: ${error.message}`)
    process.exitCode = 1
  }
}
