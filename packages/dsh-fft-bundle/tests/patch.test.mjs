/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list, and every inserted row must
 * be wired by a dependency of this package.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { load } from 'js-yaml'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const patchPath = resolve(root, manifest.dsh.bundle.patch)

describe('dsh-fft-bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(existsSync(patchPath))
    const parsed = load(readFileSync(patchPath, 'utf8'))
    assert.ok(Array.isArray(parsed), 'patch must parse to a patch list')
    const rows = parsed.flatMap(patch => patch.insert ?? [])
    assert.ok(rows.length > 0, 'patch must insert at least one plugin row')
    for (const row of rows) {
      assert.equal(typeof row.id, 'string', `row ${row.id} needs a string id`)
      assert.equal(typeof row.name, 'string', `row ${row.id} needs a string name`)
      assert.ok(manifest.dependencies[row.name], `row ${row.id} names ${row.name} but it is not a dependency`)
    }
  })
})
