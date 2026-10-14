/**
 * The bundle's one dependency edge to a plugin outside this repository.
 *
 * `@ftshare-lab/dsh_kline` is pinned to a release tag of its own repository,
 * and while the FTShare settings bridge waits upstream, to a tag of the fork
 * that carries it.  Either way the ref must be immutable: a branch would let
 * one `pnpm install` produce a different plugin than the next, and would move
 * every installed DSH the moment someone pushes to it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))
/** An upstream release, or a fork build tagged onto one (`v0.3.5-ft.1`). */
const REF_SHAPES = [/^v\d+\.\d+\.\d+$/u, /^v\d+\.\d+\.\d+-ft\.\d+$/u]

describe('third-party dependency edges', () => {
  it('pin dsh_kline to an immutable release tag', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const spec = manifest.dependencies?.['@ftshare-lab/dsh-kline']
    assert.ok(spec, 'the @ftshare-lab/dsh-kline edge must stay declared')
    const ref = spec.split('#')[1] ?? ''
    assert.ok(
      REF_SHAPES.some(pattern => pattern.test(ref)),
      `@ftshare-lab/dsh-kline must be pinned to a release tag (vX.Y.Z or vX.Y.Z-ft.N), found: ${ref || '(no ref)'}`,
    )
  })
})
