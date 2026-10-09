import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPTS = join(PACKAGE_ROOT, 'skills', 'factor-intake-standard', 'scripts')
const REQUIREMENTS = join(PACKAGE_ROOT, 'skills', 'factor-intake-standard', 'requirements.txt')

/** `uv` is the documented way to run these scripts; without it the skill cannot run at all. */
function uvAvailable() {
  return spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0
}

test('the factor-intake python unit tests pass', { skip: !uvAvailable() }, () => {
  // Run inside uv: `test_factor_html` imports factor_lib, which needs pandas
  // and numpy, and the skill never assumes those exist on the host.
  const result = spawnSync('uv', [
    'run', '--quiet', '--no-project', '--python', '3.12',
    '--with-requirements', REQUIREMENTS,
    'python', '-m', 'unittest', 'test_ft_credentials', 'test_factor_html',
  ], { cwd: SCRIPTS, encoding: 'utf8', timeout: 600_000 })
  assert.equal(result.status, 0, `python3 unittest failed:\n${result.stdout}\n${result.stderr}`)
  assert.match(result.stderr, /OK/)
})

test('eval writes an HTML report into the workspace reports/ directory', { skip: !uvAvailable() }, () => {
  const workdir = mkdtempSync(join(tmpdir(), 'factor-intake-'))
  const dates = Array.from({ length: 26 }, (_, index) => `202501${String(index + 2).padStart(2, '0')}`)
  const stocks = Array.from({ length: 40 }, (_, index) => `${600000 + index}.SH`)
  const rows = (value) => [
    'date,stock,value',
    ...dates.flatMap((date, dateIndex) =>
      stocks.map((stock, stockIndex) => `${date},${stock},${value(dateIndex, stockIndex)}`)),
    '',
  ].join('\n')
  writeFileSync(join(workdir, 'factor.csv'), rows((d, s) => (((d * 7 + s * 13) % 100) / 100).toFixed(6)))
  writeFileSync(join(workdir, 'ret.csv'), rows((d, s) => ((((d * 31 + s * 17) % 200) - 100) / 5000).toFixed(6)))

  const result = spawnSync('uv', [
    'run', '--quiet', '--no-project', '--python', '3.12',
    '--with-requirements', REQUIREMENTS,
    'python', join(SCRIPTS, 'factor_lib.py'),
    'eval', '--csv', 'factor.csv', '--ret', 'ret.csv', '--orientation', '1', '--html', '--name', 'probe',
  ], { cwd: workdir, encoding: 'utf8', timeout: 600_000 })
  assert.equal(result.status, 0, `eval failed:\n${result.stdout}\n${result.stderr}`)

  // The report is the skill's deliverable: `--html` must land it in the
  // workspace, which is the only place the DSH client can preview it from.
  const reportDir = join(workdir, 'reports')
  assert.ok(existsSync(reportDir), 'reports/ must be created in the workspace')
  const written = readdirSync(reportDir)
  assert.ok(written.some(name => name.endsWith('.html')), 'an HTML report must be written')
  assert.match(result.stderr, /^open_html=.*\.html$/mu)
  assert.match(result.stderr, /^html=.*\.html$/mu)
  // The report path must be absolute, so the model can hand it to the user as-is.
  const openHtml = /^open_html=(.+)$/mu.exec(result.stderr)?.[1]
  assert.ok(openHtml?.startsWith('/') || /^[A-Za-z]:\\/.test(openHtml ?? ''), 'open_html must be absolute')
})
