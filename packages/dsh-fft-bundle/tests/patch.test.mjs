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
import { schema } from './lib/patch-yaml.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const patchPath = resolve(root, manifest.dsh.bundle.patch)

/**
 * Packages the DSH installation supplies to every profile, so a row may name
 * one without this bundle depending on it. The row's `name` is resolved at
 * boot against the app's own installation first.
 */
const HOST_PACKAGES = new Set([
  '@deepseek-ai/dsh-mcp-client',
  // The finance preset row names the official preset plugin; the app supplies it.
  '@deepseek-ai/dsh-agent-preset',
])

describe('dsh-fft-bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(existsSync(patchPath))
    const parsed = load(readFileSync(patchPath, 'utf8'), { schema })
    assert.ok(Array.isArray(parsed), 'patch must parse to a patch list')
    const rows = parsed.flatMap(patch => patch.insert ?? [])
    assert.ok(rows.length > 0, 'patch must insert at least one plugin row')
    for (const row of rows) {
      assert.equal(typeof row.id, 'string', `row ${row.id} needs a string id`)
      assert.equal(typeof row.name, 'string', `row ${row.id} needs a string name`)
      const wired = manifest.dependencies[row.name] !== undefined
        || HOST_PACKAGES.has(row.name)
      assert.ok(wired, `row ${row.id} names ${row.name} but it is not a dependency`)
    }
  })

  /**
   * The plugin reads its deployment config once at startup and refuses to open
   * an authorization window without it. Nothing else reaches every install —
   * profile patches and `$DSH_HOME/cordis.patch.yml` are per-machine, and the
   * installer's settings.yaml template is copied only when absent — so the two
   * public URLs must stay on this row.
   */
  it('supplies the NewAPI deployment config the plugin requires', () => {
    const parsed = load(readFileSync(patchPath, 'utf8'), { schema })
    const row = parsed.flatMap(patch => patch.insert ?? []).find(entry => entry.id === 'newapi-wechat-sso')
    assert.ok(row, 'the NewAPI row must be inserted by this patch')
    const config = row.config
    assert.ok(config, 'the NewAPI row must carry the deployment config')
    assert.equal(config.baseUrl, 'https://llm-proxy.ftai.chat')
    assert.equal(config.redirectUri, 'https://llm-proxy.ftai.chat/oauth/ft-sso')
    for (const key of ['baseUrl', 'redirectUri']) {
      assert.match(config[key], /^https:\/\//u, `${key} must be the registered public URL`)
    }
  })
})
