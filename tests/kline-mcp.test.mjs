/**
 * The shim that starts kline's MCP server has to find kline in both install
 * layouts, because the row's `cwd` cannot be layout-aware.
 *
 * A git or registry install hoists `@ftshare-lab/dsh-kline` to the profile's
 * top-level `node_modules`; a tarball install nests it inside this bundle. The
 * row hands the shim this package's directory and the shim resolves kline from
 * there, so each layout below is built by hand — with a stub launcher that
 * reports the directory it ran in — and the shim is executed exactly as the
 * host executes it. The failure mode that motivated the shim (a missing
 * directory surfacing as `spawn <executable> ENOENT`) is covered by the last
 * two cases: both must name the path that is actually wrong.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

/** This package's directory: the shim's own home, and what the row hands it. */
const root = fileURLToPath(new URL('..', import.meta.url))

/** The shim under test, copied into each layout so it resolves from there. */
const shimSource = readFileSync(resolve(root, 'scripts', 'kline-mcp.mjs'), 'utf8')

/** Reports where kline's launcher was started, in place of starting Python. */
const STUB_LAUNCHER = `process.stdout.write(JSON.stringify({ argv: process.argv[1], cwd: process.cwd() }) + '\\n')\n`

/** Temp roots of this run, removed once every case is done. */
const roots = []
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** Write a file, creating its directories. */
function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * Install a stub kline package at one directory.
 * @param at - package directory.
 */
function writeKline(at) {
  write(join(at, 'package.json'), `${JSON.stringify({
    name: '@ftshare-lab/dsh-kline',
    version: '0.0.0-test',
    type: 'module',
    exports: { '.': './index.js', './package.json': './package.json' },
  }, null, 2)}\n`)
  write(join(at, 'scripts', 'run-dsh-kline.mjs'), STUB_LAUNCHER)
}

/**
 * A throwaway install tree holding this bundle's shim.
 * @param kind - `nested` puts kline inside the bundle, `hoisted` beside it.
 * @param withKline - whether the layout ships kline at all.
 * @returns the bundle directory and kline's directory.
 */
function layout(kind, withKline = true) {
  const base = mkdtempSync(join(tmpdir(), 'kline-shim-'))
  roots.push(base)
  const bundle = join(base, 'node_modules', '@ft', 'dsh-fft-bundle')
  write(join(bundle, 'scripts', 'kline-mcp.mjs'), shimSource)
  const kline = kind === 'nested'
    ? join(bundle, 'node_modules', '@ftshare-lab', 'dsh-kline')
    : join(base, 'node_modules', '@ftshare-lab', 'dsh-kline')
  if (withKline) writeKline(kline)
  return { bundle, kline }
}

/**
 * Run the real shim the way the host does: this package's directory as cwd,
 * with only the kline override added to the environment.
 * @param bundle - the bundle directory to run the shim from.
 * @param override - value for `DSH_KLINE_PACKAGE_ROOT`.
 * @returns the spawn result.
 */
function runShim(bundle, override) {
  const env = { ...process.env }
  delete env.DSH_KLINE_PACKAGE_ROOT
  if (override !== undefined) env.DSH_KLINE_PACKAGE_ROOT = override
  return spawnSync(process.execPath, [join(bundle, 'scripts', 'kline-mcp.mjs')], {
    cwd: bundle,
    env,
    encoding: 'utf8',
  })
}

describe('kline-mcp shim', () => {
  it('finds kline nested inside this bundle (tarball install)', () => {
    const { bundle, kline } = layout('nested')
    const result = runShim(bundle)
    assert.equal(result.status, 0, result.stderr)
    const started = JSON.parse(result.stdout)
    assert.equal(started.cwd, realpathSync(kline))
    assert.equal(basename(dirname(started.argv)), 'scripts')
  })

  it('finds kline hoisted beside this bundle (git or registry install)', () => {
    const { bundle, kline } = layout('hoisted')
    const result = runShim(bundle)
    assert.equal(result.status, 0, result.stderr)
    const started = JSON.parse(result.stdout)
    assert.equal(started.cwd, realpathSync(kline))
    assert.equal(started.argv, join(realpathSync(kline), 'scripts', 'run-dsh-kline.mjs'))
  })

  it('honours DSH_KLINE_PACKAGE_ROOT over what it would resolve', () => {
    const { bundle } = layout('nested')
    const elsewhere = mkdtempSync(join(tmpdir(), 'kline-shim-pinned-'))
    roots.push(elsewhere)
    writeKline(elsewhere)
    const result = runShim(bundle, elsewhere)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).cwd, realpathSync(elsewhere))
  })

  it('names the package it could not resolve instead of an executable', () => {
    const { bundle } = layout('nested', false)
    const result = runShim(bundle)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /cannot resolve @ftshare-lab\/dsh-kline/)
    assert.match(result.stderr, /DSH_KLINE_PACKAGE_ROOT/)
  })

  it('names the missing launcher when the override points nowhere useful', () => {
    const { bundle } = layout('nested', false)
    const empty = mkdtempSync(join(tmpdir(), 'kline-shim-empty-'))
    roots.push(empty)
    const result = runShim(bundle, empty)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /kline launcher does not exist/)
    assert.match(result.stderr, new RegExp('run-dsh-kline\\.mjs'))
  })
})
