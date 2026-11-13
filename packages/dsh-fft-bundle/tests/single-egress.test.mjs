/**
 * One egress: the FTShare gateway is reached from one place in this repository.
 *
 * Everything that used to have its own FTShare client — an embedded MCP client,
 * its own error types, its own credential read, its own candidate downgrade
 * chain — is gone. This guard is what keeps it gone: a second implementation
 * would silently reintroduce the two defects the base exists to fix (detail lost
 * from the model's view, and "no permission" rendered as "no data"), and nothing
 * else in the suite would notice.
 *
 * The base (`@dsh-ft/dsh-fft-ftshare`) and the key probe (`dsh-fft-settings`)
 * live in the standalone `dsh-fft-base` repository, so nothing in this
 * repository is allowed to touch the gateway's wire protocol at all: every
 * package here consumes the base's typed service instead. The rules therefore
 * allow nobody.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
const packagesRoot = resolve(bundleRoot, '..')
/** Repository root; rule exceptions are written relative to it. */
const repoRoot = resolve(packagesRoot, '..')

/** No source in this repository may speak the FTShare wire protocol. */
const NOBODY = new Set()

/** Text patterns that would mean "a second FTShare implementation". */
const RULES = [
  {
    what: '上游网关地址',
    pattern: /market\.ft\.tech/u,
    allowed: NOBODY,
  },
  {
    what: 'MCP 客户端 SDK',
    pattern: /@modelcontextprotocol\/sdk/u,
    allowed: NOBODY,
  },
  {
    what: '自读凭据文件',
    pattern: /\.credentials\.yaml/u,
    allowed: NOBODY,
  },
  {
    what: '自建 FTShare 错误类型',
    pattern: /FtShare(?:Permission)?Error\b/u,
    allowed: NOBODY,
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

  it('scans every package source', () => {
    // The count follows the tree: the public branch carries only the entry
    // package, while the development tree also has the two intranet plugins. A
    // fixed floor would either fail there or go blind here, so the guard asserts
    // that every package with sources was actually reached.
    assert.ok(files.length > 0, `扫描到的源文件太少（${files.length}），路径或跳过规则不对`)
    assert.ok(files.some(path => path.includes('dsh-fft-bundle')), '入口包必须在扫描范围内')
    for (const name of readdirSync(packagesRoot)) {
      const src = join(packagesRoot, name, 'src')
      if (!existsSync(src)) continue
      assert.ok(
        files.some(path => path.startsWith(`${src}/`)),
        `包 ${name} 有 src/ 但一个文件都没被扫到，跳过规则可能影响了它`,
      )
    }
  })

  for (const rule of RULES) {
    it(`keeps ${rule.what} out of this repository`, () => {
      const offenders = []
      for (const path of files) {
        const relativePath = relative(repoRoot, path).split('\\').join('/')
        if (allowed(rule, relativePath)) continue
        if (rule.pattern.test(readFileSync(path, 'utf8'))) offenders.push(relativePath)
      }
      assert.deepEqual(offenders, [], `${offenders.join(', ')} 里出现了${rule.what}：FTShare 取数应当只走 @dsh-ft/dsh-fft-ftshare 的服务面`)
    })
  }

  it('keeps the MCP SDK out of every manifest', () => {
    const offenders = []
    for (const name of readdirSync(packagesRoot)) {
      const manifest = join(packagesRoot, name, 'package.json')
      try {
        statSync(manifest)
      } catch {
        continue
      }
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      const declared = { ...parsed.dependencies, ...parsed.peerDependencies, ...parsed.devDependencies }
      if ('@modelcontextprotocol/sdk' in declared) offenders.push(name)
    }
    assert.deepEqual(offenders, [], `${offenders.join(', ')} 仍然声明 @modelcontextprotocol/sdk；它属于 dsh-fft-base 仓`)
  })
})
