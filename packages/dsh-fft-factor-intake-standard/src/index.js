/**
 * Bundled `factor-intake` skill provider for DeepSeek Harness.
 *
 * Registers the packaged factor-intake skill on the `ctx.skills` registry, so
 * every session gets it in the model-facing catalog and in the `/` menu without
 * anyone copying files into `$DSH_HOME/skills`. The host half deliberately owns
 * no runtime state: the skill's Python scripts resolve the FTShare credential
 * from the DSH credentials document themselves, so no Cordis service, no HTTP
 * route, and no extra process is involved.
 *
 * @module @ft/dsh-fft-factor-intake-standard
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Provider name in the `ctx.skills` registry. */
export const PROVIDER_NAME = 'ft-factor-intake'

/** Skill name the model loads and the `/` menu lists. */
export const SKILL_NAME = 'factor-intake-standard'

const SKILL_DIR_URL = new URL('../skills/factor-intake-standard/', import.meta.url)

/**
 * Relative paths inside SKILL.md resolve against the bundled skill directory.
 * `fileURLToPath` keeps a trailing separator for directory URLs, which would
 * double up in the paths this provider renders, so normalize it away.
 */
const RESOURCE_BASE = { kind: 'directory', path: resolve(fileURLToPath(SKILL_DIR_URL)) }

/**
 * Precedence rank for a packaged skill provider. Matches `BUNDLED_SKILL_RANK`
 * from `@deepseek-ai/dsh-skill`; the literal keeps this package dependency-free,
 * which is what lets it install with no build step.
 */
const PACKAGED_SKILL_RANK = 600

const DESCRIPTION =
  'Evaluate and ingest alpha factors locally from 3-column panels (date, stock, value). '
  + 'Computes RankIC/ICIR, Q1-Q10, Q10-Q1, turnover and optional neutralization, and maintains '
  + 'a lightweight factor library with cross-sectional rank correlation and Q10 Jaccard. Use '
  + 'whenever the user says 入库, 回测, 测评, 因子评价, RankIC, 十分位, 相关性, 因子库, 查重, '
  + 'uploads a factor CSV/Parquet, or asks to compare factors.'

const CANDIDATE = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: PACKAGED_SKILL_RANK,
  locator: new URL('SKILL.md', SKILL_DIR_URL),
}

/**
 * Skill content, with the two facts a model cannot derive appended as an
 * installed-runtime note: the skill directory to call scripts from, and the
 * dependency manifest `uv` should load per run.
 */
function installedRuntime() {
  const directory = RESOURCE_BASE.path
  return [
    '',
    '## Installed runtime',
    '',
    `本 Skill 的绝对目录是 \`${directory}\`。脚本一律用这个目录拼绝对路径调用，不要依赖当前工作目录：`,
    '',
    '```bash',
    `uv run --quiet --python 3.12 --with-requirements ${directory}/requirements.txt \\`,
    `  python ${directory}/scripts/factor_lib.py eval --csv factor.csv --ret ret.csv`,
    '```',
    '',
  ].join('\n')
}

const provider = {
  name: PROVIDER_NAME,
  list() {
    return Promise.resolve([CANDIDATE])
  },
  async get(candidate) {
    const body = await readFile(candidate.locator, 'utf8')
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: stripFrontmatter(body) + installedRuntime(),
    }
  },
}

/**
 * The skill registry renders the body, so the YAML frontmatter belongs to the
 * on-disk copy only; leaving it in would show up verbatim in the model's
 * `<skill_content>` block.
 */
function stripFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return normalized
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return normalized
  const afterFence = normalized.indexOf('\n', end + 1)
  return afterFence === -1 ? '' : normalized.slice(afterFence + 1).replace(/^\n+/, '')
}

/** Cordis plugin name. */
export const name = '@ft/dsh-fft-factor-intake-standard'

/** The bundled provider is only useful next to the skill registry. */
export const inject = ['skills']

/** Register the bundled factor-intake skill provider on `ctx.skills`. */
export function apply(ctx) {
  if (typeof ctx.skills?.registerProvider !== 'function') {
    throw new Error(
      '@ft/dsh-fft-factor-intake-standard requires the skill registry (@deepseek-ai/dsh-skill, service `skills`) in this composition',
    )
  }
  ctx.skills.registerProvider(() => provider)
}

export { provider, CANDIDATE, RESOURCE_BASE, installedRuntime, stripFrontmatter }
