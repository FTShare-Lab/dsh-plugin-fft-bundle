/**
 * A package documents itself.
 *
 * Its `README.md` and `docs/` travel with the package (`files` in
 * `package.json`), and a package may be installed on its own. A relative link
 * that resolves outside the package directory is therefore broken for that
 * reader, and it means the package is leaning on the composition repository's
 * documents instead of stating what it provides. Bundle-level design stays in
 * the repository's `docs/`; the pointer runs one way — the repository may link
 * down into a package, never the reverse.
 *
 * The rule and its rationale live in `AGENTS.md` (§文档); this test pins it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

/** Every relative markdown link and image destination in a file. */
const LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)/gu

function packageDirs() {
  return readdirSync(PACKAGES_DIR)
    .map(name => join(PACKAGES_DIR, name))
    .filter(path => statSync(path).isDirectory())
}

/** Documents that ship inside a package: its README plus everything under docs/. */
function packageDocs(pkgDir) {
  const docs = []
  const readme = join(pkgDir, 'README.md')
  try {
    statSync(readme)
    docs.push(readme)
  } catch {
    // A package without a README has nothing to check here.
  }
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) docs.push(path)
    }
  }
  try {
    walk(join(pkgDir, 'docs'))
  } catch {
    // docs/ is optional.
  }
  return docs
}

/** Relative link targets that resolve outside their own package. */
function escapingLinks(pkgDir, file) {
  const offenders = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    for (const [, raw] of line.matchAll(LINK)) {
      const target = raw.split('#')[0].split('?')[0]
      if (target === '' || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue // anchors and absolute URLs
      const resolved = resolve(dirname(file), target)
      if (resolved === pkgDir || resolved.startsWith(pkgDir + sep)) continue
      offenders.push(`${relative(REPO_ROOT, file)}:${index + 1} -> ${target}`)
    }
  })
  return offenders
}

describe('package documents', () => {
  it('never link outside their own package', () => {
    const offenders = []
    let checked = 0
    for (const pkgDir of packageDirs()) {
      for (const file of packageDocs(pkgDir)) {
        checked += 1
        offenders.push(...escapingLinks(pkgDir, file))
      }
    }
    assert.ok(checked > 0, 'expected package documents to check')
    assert.deepEqual(
      offenders,
      [],
      `package docs must describe the package itself; bundle-level design lives in the repository's docs/:\n${offenders.join('\n')}`,
    )
  })
})
