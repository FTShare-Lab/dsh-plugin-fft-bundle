/**
 * Prompt text in a patch may only reference prompt variables the host registers.
 *
 * DSH 0.2.1 made `{{variable}}` interpolation strict: an unresolved reference
 * aborts prompt assembly before any model request, and the session fails at
 * step 1 with `unknown prompt variable "{{cwd}}"`. Only `provider` and `model`
 * are registered (agent-loop); the working directory reaches the model as
 * runtime context from the working-directory service, not as a variable.
 *
 * A template error is invisible until somebody actually starts a session in
 * that preset — v0.6.1 shipped the finance preset with a `{{cwd}}` suffix and
 * every finance session broke on DSH 0.2.1. This guard reads the patches
 * instead of trusting review.
 *
 * Vendored payloads are scanned too. an internal bundle is not the
 * effective entry while it is installed through the composition, but it is
 * also published standalone; a re-vendor that reintroduces `{{cwd}}` must
 * fail here rather than only in the standalone install (see its
 * PROVENANCE.md, local change ⑤).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { JsExpression, schema } from './lib/patch-yaml.mjs'

/**
 * Variables the host registers for prompt interpolation.
 *
 * `packages/core/agent-loop/src/index.ts` registers both; anything else must be
 * registered by a plugin before a template may name it.
 */
const REGISTERED = new Set(['provider', 'model'])

/** `{{name}}` as the system-prompt interpolator reads it. */
const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/gu

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const packagesDir = resolve(repoRoot, 'packages')

/**
 * Every patch file this repository ships, including vendored payloads.
 *
 * A vendor copy still reaches users through its own package entry, so it is
 * held to the same prompt-variable rule as the composition patch.
 * @returns an array of absolute paths.
 */
function ownedPatches() {
  const found = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const patch = resolve(packagesDir, entry.name, 'cordis.patch.yml')
    if (existsSync(patch)) found.push(patch)
  }
  return found.sort()
}

/**
 * Collect every string in a parsed patch, keyed by its YAML path.
 * @param value - any node of the parsed document.
 * @param path - path of that node, for failure messages.
 * @param found - accumulator of `{ path, text }`.
 */
function collectStrings(value, path = '', found = []) {
  if (typeof value === 'string') {
    found.push({ path: path || '<root>', text: value })
    return found
  }
  if (value instanceof JsExpression) return found
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, found))
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, path === '' ? key : `${path}.${key}`, found)
    }
  }
  return found
}

/** References a patch text makes to prompt variables, with their locations. */
function references(patchPath) {
  const parsed = load(readFileSync(patchPath, 'utf8'), { schema })
  const found = []
  for (const { path, text } of collectStrings(parsed)) {
    for (const match of text.matchAll(VARIABLE)) {
      found.push({ name: match[1], path })
    }
  }
  return found
}

describe('prompt variables referenced by this bundle', () => {
  const patches = ownedPatches()

  it('finds the patches to guard', () => {
    assert.ok(
      patches.length > 0,
      `no cordis.patch.yml found under ${packagesDir}; the guard would pass vacuously`,
    )
  })

  for (const patchPath of ownedPatches()) {
    const relative = patchPath.slice(repoRoot.length)
    it(`references only registered variables in ${relative}`, () => {
      const unknown = references(patchPath).filter(reference => !REGISTERED.has(reference.name))
      assert.deepEqual(
        unknown.map(reference => `${reference.path}: {{${reference.name}}}`),
        [],
        `${relative} references an unregistered prompt variable; DSH 0.2.1 fails prompt `
          + `assembly at step 1 with "unknown prompt variable". Registered: `
          + `${[...REGISTERED].join(', ')}. Delete the clause, or register the variable from a `
          + 'plugin before the template names it.',
      )
    })
  }
})
