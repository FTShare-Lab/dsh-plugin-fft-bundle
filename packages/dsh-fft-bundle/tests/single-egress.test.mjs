/**
 * One egress: the FTShare gateway is reached from one place in this repository.
 *
 * Everything else that used to have its own FTShare client — the cockpit's
 * embedded MCP client, its own error types, its own credential read, its own
 * candidate downgrade chain — is gone. This guard is what keeps it gone: a
 * second implementation would silently reintroduce the two defects the base
 * exists to fix (detail lost from the model's view, and "no permission" rendered
 * as "no data"), and nothing else in the suite would notice.
 *
 * Deliberate exception: `dsh-fft-settings` validates the key the user just typed
 * by probing the gateway origin. That is a credential check, not a data call,
 * and it is listed by file so a second one cannot hide next to it.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
const packagesRoot = resolve(bundleRoot, '..')
/** Repository root; rule exceptions are written relative to it. */
const repoRoot = resolve(packagesRoot, '..')

/** Files allowed to mention the gateway origin: the base, plus the key probe. */
const GATEWAY_ALLOWED = new Set([
  'packages/dsh-fft-ftshare',
  'packages/dsh-fft-settings/src/features/api-key/probe.ts',
])

/** The base itself is the one place allowed to speak the FTShare wire protocol. */
const BASE_PACKAGE = 'packages/dsh-fft-ftshare'

/** Text patterns that would mean "a second FTShare implementation". */
const RULES = [
  {
    what: '上游网关地址',
    pattern: /market\.ft\.tech/u,
    allowed: GATEWAY_ALLOWED,
  },
  {
    what: 'MCP 客户端 SDK',
    pattern: /@modelcontextprotocol\/sdk/u,
    allowed: new Set([BASE_PACKAGE]),
  },
  {
    what: '自读凭据文件',
    pattern: /\.credentials\.yaml/u,
    allowed: new Set([BASE_PACKAGE]),
  },
  {
    what: '自建 FTShare 错误类型',
    pattern: /FtShare(?:Permission)?Error\b/u,
    allowed: new Set([BASE_PACKAGE]),
  },
]

/** Source extensions worth scanning. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']

/** Walk a directory, skipping generated and dependency trees. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib' || name === 'tests' || name === '.git') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (SOURCE_EXTENSIONS.some(extension => name.endsWith(extension))) yield path
  }
}

/** Every scannable source file under `packages/*`. */
function sources() {
  const files = []
  for (const name of readdirSync(packagesRoot)) {
    const dir = join(packagesRoot, name)
    if (!statSync(dir).isDirectory()) continue
    for (const path of walk(dir)) files.push(path)
  }
  return files
}

/** Whether a repository-relative path is allowed to match for one rule. */
function allowed(rule, relativePath) {
  for (const exception of rule.allowed) {
    if (relativePath === exception || relativePath.startsWith(`${exception}/`)) return true
  }
  return false
}

describe('single egress into FTShare', () => {
  const files = sources()

  it('scans every package source, not just the base', () => {
    assert.ok(files.length > 50, `扫描到的源文件太少（${files.length}），路径或跳过规则不对`)
    assert.ok(files.some(path => path.includes('dsh-fft-research-cockpit')), '投研舱必须在扫描范围内')
  })

  for (const rule of RULES) {
    it(`keeps ${rule.what} inside ${[...rule.allowed].map(path => path.split('/')[1]).join(', ')}`, () => {
      const offenders = []
      for (const path of files) {
        const relativePath = relative(repoRoot, path).split('\\').join('/')
        if (allowed(rule, relativePath)) continue
        if (rule.pattern.test(readFileSync(path, 'utf8'))) offenders.push(relativePath)
      }
      assert.deepEqual(offenders, [], `${offenders.join(', ')} 里出现了${rule.what}：FTShare 取数应当只走 @dsh-ft/dsh-fft-ftshare`)
    })
  }

  it('keeps the MCP SDK out of every other manifest', () => {
    const offenders = []
    for (const name of readdirSync(packagesRoot)) {
      const manifest = join(packagesRoot, name, 'package.json')
      try {
        statSync(manifest)
      } catch {
        continue
      }
      const dependencies = JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {}
      if ('@modelcontextprotocol/sdk' in dependencies && name !== 'dsh-fft-ftshare') offenders.push(name)
    }
    assert.deepEqual(offenders, [], `${offenders.join(', ')} 仍然依赖 @modelcontextprotocol/sdk`)
  })
})
