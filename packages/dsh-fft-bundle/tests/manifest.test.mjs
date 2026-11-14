/**
 * The generated manifest is the only runtime source of the bundle's own version
 * and dependency specifiers (a linked checkout cannot resolve its own package
 * through the profile). These assertions keep the generated copy equal to the
 * manifest it is generated from, and keep every runtime import shippable.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const generated = readFileSync(new URL('../lib/manifest.js', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

/** The object literal the generated module exports. */
function generatedManifest() {
  const match = /export const manifest = (\{[\s\S]*\})\n$/u.exec(generated)
  assert.ok(match, 'lib/manifest.js must export one manifest literal')
  return JSON.parse(match[1])
}

describe('generated manifest', () => {
  it('restates package.json, minus repository edges', () => {
    // Repository edges are internal-channel packaging details. Their names must
    // never reach a public artifact, and the card does not version-check them:
    // the internal tarball bundles those plugins instead.
    const dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies ?? {}).filter(([, spec]) => !/^(?:git\+|git@|https?:|file:|link:|workspace:|path:)/iu.test(spec)),
    )
    assert.deepEqual(generatedManifest(), { name: manifest.name, version: manifest.version, dependencies })
    assert.doesNotMatch(generated, /git\+|ssh:\/\/|&path:/u, 'a public file must not carry repository edges')
  })

  it('is covered by the files whitelist together with every runtime import', () => {
    const files = manifest.files ?? []
    assert.ok(files.includes('lib/index.js'))
    assert.ok(files.includes('lib/client.js'), 'the browser half must ship')
    const imports = [...entry.matchAll(/from '\.\/([a-z-]+)\.js'/gu)].map(match => `lib/${match[1]}.js`)
    assert.ok(imports.length > 0, 'the host entry must import its own modules')
    for (const path of imports) assert.ok(files.includes(path), `${path} is imported but not shipped`)
    assert.ok(files.includes('lib/manifest.js'), 'the generated manifest must ship')
    for (const path of files.filter(path => path.endsWith('.js'))) {
      assert.ok(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').length > 0, `${path} must exist`)
    }
  })
})
