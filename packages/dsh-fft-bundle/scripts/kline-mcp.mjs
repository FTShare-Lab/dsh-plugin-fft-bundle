#!/usr/bin/env node
/**
 * Start kline's MCP server from wherever this bundle happens to be installed.
 *
 * The mirrored `mcp-dsh-kline` row in `cordis.patch.yml` cannot name kline's
 * directory: a `!!js` scalar sees only `ctx` and `process`, so a path can only
 * be built from `ctx.baseUrl` — the profile's `cordis.yml`. That reaches a
 * top-level `node_modules/@ftshare-lab/dsh-kline`, which is where a git or
 * registry install hoists it, but a tarball install inlines kline *inside this
 * package* (`<bundle>/node_modules/@ftshare-lab/dsh-kline`). `spawn` then fails
 * on the missing directory with a bare `ENOENT` that names the executable —
 * the one file that certainly exists — instead of the path that does not.
 *
 * The row therefore runs this file from this package's own directory — the
 * profile's `cordis.yml` sits next to it in every layout — and lets Node resolve
 * kline from here: this package's `node_modules` first, then every ancestor, so
 * nested and hoisted installs both work without guessing at either. Nothing else
 * moves: this file only finds kline and hands over the stdio pipes, and kline's
 * own launcher keeps the Python runtime, the bootstrap deferral and the MCP
 * handshake.
 *
 * `DSH_KLINE_PACKAGE_ROOT` still overrides the location, now read here, where a
 * bad value can be reported as the directory it failed on. The row forwards the
 * host's value into this process because the MCP client scrubs every `DSH_*`
 * name out of the child environment.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** kline's launcher, relative to its package directory. */
const LAUNCHER = 'scripts/run-dsh-kline.mjs'

/** The package this file has to locate. */
const PACKAGE = '@ftshare-lab/dsh-kline'

/**
 * Report a failure the host can act on and stop.
 * @param message - one line naming the directory or the override to fix.
 */
function fail(message) {
  process.stderr.write(`[dsh-fft-bundle] ${message}\n`)
  process.exit(1)
}

/**
 * The kline package directory: the documented override first, then Node
 * resolution from this file.
 * @returns absolute package directory, or undefined when kline is nowhere on
 * the resolution path from this file.
 */
function findKlineDirectory() {
  const override = String(process.env.DSH_KLINE_PACKAGE_ROOT ?? '').trim()
  if (override !== '') return override
  try {
    return dirname(createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`))
  } catch {
    return undefined
  }
}

const directory = findKlineDirectory()
if (directory === undefined) {
  fail(`cannot resolve ${PACKAGE} from ${fileURLToPath(import.meta.url)}; set DSH_KLINE_PACKAGE_ROOT to its package directory`)
}
const launcher = join(directory, LAUNCHER)
if (!existsSync(launcher)) {
  fail(`kline launcher does not exist: ${launcher}; set DSH_KLINE_PACKAGE_ROOT to its package directory`)
}

// kline's launcher expects to be `argv[1]` and owns the child process tree from
// here on, so run it rather than importing it. `inherit` keeps the MCP stdio
// pipes between the host and kline's Python server untouched.
const child = spawn(process.execPath, [launcher], { cwd: directory, stdio: 'inherit', env: process.env })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => fail(`cannot start ${launcher}: ${error.message}`))
child.on('exit', code => { process.exitCode = code ?? 1 })
