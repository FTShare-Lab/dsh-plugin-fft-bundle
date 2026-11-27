/**
 * The plugin manager reads this package's display metadata without evaluating
 * any code: it resolves `<name>/package.json` through Node's `exports` map,
 * then turns the manifest's `icon` into a base64 data URL for the 30-36px
 * artwork slot.  DSH 0.2.0-rc.2 enforces those rules in
 * `packages/boot/app-boot/src/package-meta.ts` (`readPluginMeta` / `iconOf`),
 * and every violation is silent on this side — the card just falls back to the
 * default glyph.  The scaffold shipped `icon.svg` in `files` without ever
 * setting the `icon` field, so the FT workbench card had no icon at all.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** Media types `iconOf` accepts, keyed by the extension it compares. */
const ICON_MEDIA_TYPES = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])

/** `iconOf` refuses an icon above this many bytes. */
const MAX_ICON_BYTES = 256 * 1024

/**
 * Whether a `files` entry would ship a package-relative path.  Only the npm
 * subset this manifest uses is honoured: `**` crosses directories, `*` does not.
 * @param {string} pattern - one `files` entry.
 * @param {string} path - package-relative path to test, with `/` separators.
 * @returns whether the entry covers the path.
 */
function ships(pattern, path) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u0000/gu, '.*')
  return new RegExp(`^${source}$`, 'u').test(path)
}

/**
 * Reads the PNG IHDR dimensions, so the square artwork slot is never fed a
 * stray aspect ratio by an accidental re-export.
 * @param {Buffer} bytes - the icon file's contents.
 * @returns the width and height the header declares.
 */
function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'icon must be a PNG')
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR', 'icon must start with an IHDR chunk')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('dsh-fft-bundle manager metadata', () => {
  it('declares an icon the Host can read through its manifest rules', () => {
    const icon = manifest.icon
    assert.equal(typeof icon, 'string', 'the manifest must carry an icon field')
    assert.ok(icon.trim() !== '', 'the icon field must not be blank')
    assert.ok(!isAbsolute(icon), 'iconOf rejects an absolute icon path')
    assert.ok(!/^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon), 'iconOf rejects a URL-shaped icon path')

    const file = resolve(root, icon)
    const contained = relative(root, file)
    assert.ok(contained !== '..' && !contained.startsWith(`..${sep}`), 'the icon must stay inside the package')
    assert.ok(existsSync(file), `${icon} must exist`)
    assert.ok(statSync(file).isFile(), `${icon} must be a regular file`)

    const dot = icon.lastIndexOf('.')
    const extension = dot === -1 ? '' : icon.slice(dot).toLowerCase()
    assert.ok(ICON_MEDIA_TYPES.has(extension), `iconOf rejects ${extension || 'an extensionless'} icons`)
    assert.ok(statSync(file).size <= MAX_ICON_BYTES, 'iconOf rejects an icon above 256 KiB')
  })

  it('ships the icon and the metadata a git install delivers', () => {
    // A git install delivers only tracked files, still filtered by `files`, so
    // an undeclared icon reaches the profile as a broken path.
    assert.ok(
      manifest.files.some(pattern => ships(pattern, manifest.icon.replace(/^\.\//u, ''))),
      `${manifest.icon} must be covered by the files list`,
    )
    // The Host resolves the manifest itself through Node's exports map.
    assert.equal(manifest.exports['./package.json'], './package.json')
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
    assert.ok(existsSync(resolve(root, 'locale/en.json')), 'the English locale carries the card text')
  })

  it('publishes a square PNG for the artwork slot', () => {
    const bytes = readFileSync(resolve(root, manifest.icon))
    const { width, height } = pngSize(bytes)
    assert.equal(width, height, 'PackageArtwork draws the icon into a square box')
    assert.ok(width >= 64, 'the icon must survive a 30-36px draw on a retina display')
  })
})
