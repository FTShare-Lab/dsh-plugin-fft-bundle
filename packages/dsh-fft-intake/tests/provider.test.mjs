import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CANDIDATE,
  PROVIDER_NAME,
  RESOURCE_BASE,
  SKILL_NAME,
  apply,
  inject,
  installedRuntime,
  name,
  provider,
  stripFrontmatter,
} from '../src/index.js'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILL_DIR = join(PACKAGE_ROOT, 'skills', SKILL_NAME)

test('plugin exports the cordis contract', () => {
  assert.equal(name, '@ft/dsh-fft-intake')
  assert.deepEqual(inject, ['skills'])
  assert.equal(typeof apply, 'function')
})

test('apply registers exactly one provider on ctx.skills', () => {
  const registrations = []
  apply({ skills: { registerProvider: create => registrations.push(create()) } })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0], provider)
})

test('apply fails loudly without the skill registry', () => {
  assert.throws(() => apply({}), /skill registry/)
  assert.throws(() => apply({ skills: {} }), /skill registry/)
})

test('candidate satisfies every field the registry validates', () => {
  assert.match(CANDIDATE.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.equal(CANDIDATE.name, SKILL_NAME)
  assert.equal(CANDIDATE.provider, PROVIDER_NAME)
  assert.equal(typeof CANDIDATE.description, 'string')
  assert.ok(CANDIDATE.description.length > 0)
  assert.equal(CANDIDATE.invocation.modelInvocable, true)
  assert.equal(CANDIDATE.invocation.userInvocable, true)
  assert.equal(CANDIDATE.source, 'bundled')
  assert.equal(CANDIDATE.resourceBase, RESOURCE_BASE)
  assert.equal(RESOURCE_BASE.kind, 'directory')
  assert.equal(RESOURCE_BASE.path, SKILL_DIR)
})

test('the packaged skill ships every file the provider advertises', () => {
  assert.ok(existsSync(join(SKILL_DIR, 'SKILL.md')), 'SKILL.md must ship')
  assert.ok(existsSync(join(SKILL_DIR, 'requirements.txt')), 'requirements.txt must ship')
  for (const script of [
    'factor_lib.py',
    'ft_credentials.py',
    'ftshare_client.py',
    'market_data.py',
    'report_html.py',
    'report_tabs.py',
    'research_eval.py',
  ]) {
    assert.ok(existsSync(join(SKILL_DIR, 'scripts', script)), `${script} must ship`)
  }
})

test('provider lists one candidate and loads a frontmatter-free body', async () => {
  const listed = await provider.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, SKILL_NAME)
  const skill = await provider.get(CANDIDATE)
  assert.equal(skill.name, SKILL_NAME)
  assert.equal(skill.resourceBase, RESOURCE_BASE)
  assert.ok(skill.content.startsWith('# 因子入库标准'), 'frontmatter must be stripped')
  assert.ok(!skill.content.includes('\nname: factor-intake-standard'), 'frontmatter must not leak')
  assert.ok(skill.content.includes('## Installed runtime'), 'runtime note must be appended')
})

test('stripFrontmatter keeps a document without frontmatter intact', () => {
  assert.equal(stripFrontmatter('# Title\n\nBody\n'), '# Title\n\nBody\n')
})

test('installedRuntime names the absolute skill directory and the manifest', () => {
  const runtime = installedRuntime()
  assert.ok(runtime.includes(SKILL_DIR))
  assert.ok(runtime.includes(`${SKILL_DIR}/requirements.txt`))
  assert.ok(runtime.includes(`${SKILL_DIR}/scripts/factor_lib.py`))
})

test('the skill no longer points at a report server that does not exist', () => {
  const skillBody = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
  for (const text of [skillBody, ...['references/market-data.md', 'references/factor-library.md', 'references/daily-research-eval.md']
    .map(relative => readFileSync(join(SKILL_DIR, relative), 'utf8'))]) {
    assert.ok(!text.includes('18768'), 'the dead report port must not survive')
    assert.ok(!text.includes('reports_http.py'), 'the missing report server must not be referenced')
    assert.ok(!text.includes('file:///'), 'skill text must not hand the model a file:// link')
  }
})

test('the credential module never hardcodes a machine-specific key path', () => {
  const credentialSource = readFileSync(join(SKILL_DIR, 'scripts', 'ft_credentials.py'), 'utf8')
  assert.ok(!credentialSource.includes('Documents/openalpha'))
  assert.ok(credentialSource.includes('.credentials.yaml'))
  const clientSource = readFileSync(join(SKILL_DIR, 'scripts', 'ftshare_client.py'), 'utf8')
  assert.ok(!clientSource.includes('Documents/openalpha'))
  assert.ok(clientSource.includes('ft_credentials'))
})
