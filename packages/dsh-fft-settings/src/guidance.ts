/**
 * The FT prompt contract: two ordered system sections and one runtime fact.
 *
 * The identity is not here: the preset that mounts this entry states it in its own
 * `persona` row (order 0), and repeating it as a section would render it twice.
 *
 * Registration is a single {@link installGuidance} call so the text and the
 * mount point stay independent — moving these registrations into an agent preset
 * later changes only the row that calls this module.
 *
 * A section is paid for on every request and any edit invalidates the prompt's
 * KV-cache prefix, so the contract stays short; methodology that needs examples,
 * checklists, or branch flow belongs in a skill instead.
 * @module @dsh-ft/dsh-fft-settings/guidance
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * The prompt-registry calls this module makes, declared structurally: the host
 * owns `systemPrompt`, and `inject` guarantees the service exists before `apply`
 * runs, so the package keeps no harness dependency just to name the type.
 */
interface PromptRegistry {
  section(section: { readonly name: string; readonly order: number; readonly text: string }): () => void
  context(entry: { readonly name: string; readonly order: number; readonly text: () => string }): () => void
}

/** Section name of the capability list. */
export const FT_SERVICES_SECTION = 'ft:services'

/** Section name of the financial-data discipline. */
export const FT_DATA_POLICY_SECTION = 'ft:data-policy'

/** Runtime-context name of the FTShare credential fact. */
export const FT_CREDENTIALS_CONTEXT = 'ft:credentials'

/**
 * Section orders. Consecutive integers keep a third-party section from sorting
 * between two of ours (`1`–`499` is the shared free band), while `6` still lands
 * after the deployment persona (`0`) and before core's plan policy (`500`).
 */
export const FT_SECTION_ORDERS = { services: 6, dataPolicy: 7 } as const

/** Order of the credential fact — `getContextOrder` owns only three named positions. */
export const FT_CREDENTIALS_ORDER = 130

export const FT_SERVICES_TEXT = '行情、K线与指标用 dsh-kline 工具（代码先用 search_symbols 解析）；投研报告与组合推荐用 cockpit_* 工具；因子入库与评价用 factor-intake-standard 技能；FTShare API Key 在设置页维护。'

export const FT_DATA_POLICY_TEXT = '金融数据优先取 FTShare，其次才用联网检索补充；引用必须给出处与时点；严格区分已披露事实、机构判断与待验证信息；不编造数字，也不构成投资建议。'

export const FT_CREDENTIALS_MISSING_TEXT = 'FTShare 凭据未配置：行情可能退化为免费兜底源，覆盖有限，引用时必须标明来源；需要完整数据时引导用户在设置页填写 API Key。'

/**
 * Resolve the host prompt registry.
 * @param ctx - the plugin context whose `inject` declared `systemPrompt`.
 * @returns the registry, typed by this module's structural declaration.
 */
function promptRegistry(ctx: Context): PromptRegistry {
  const registry = ctx.get('systemPrompt') as PromptRegistry | undefined
  if (registry === undefined) {
    throw new Error('dsh-fft-settings: the systemPrompt service is missing although inject declared it')
  }
  return registry
}

/**
 * Keep one boolean for the credential fact, because a prompt provider is
 * synchronous while the settings service answers asynchronously.
 * @param ctx - the plugin context.
 */
function installCredentialFact(ctx: Context): void {
  const apiKey = ctx.ftshareSettings.apiKey
  // `undefined` is "not known yet" and renders nothing: an unresolved fact must
  // not tell the model the credential is missing.
  let configured: boolean | undefined
  const refresh = (): void => {
    void apiKey.describe().then(
      (status) => { configured = status.configured },
      (error: unknown) => {
        configured = undefined
        ctx.logger.debug('dsh-fft-settings: credential status unavailable', error)
      },
    )
  }
  refresh()
  ctx.effect(() => apiKey.subscribe(refresh), 'dsh-fft-settings: credential fact refresh')
  ctx.effect(() => promptRegistry(ctx).context({
    name: FT_CREDENTIALS_CONTEXT,
    order: FT_CREDENTIALS_ORDER,
    text: () => configured === false ? FT_CREDENTIALS_MISSING_TEXT : '',
  }), 'dsh-fft-settings: ft:credentials')
}

/**
 * Register the FT prompt contract for every agent the calling context reaches.
 * @param ctx - the plugin's host context; an unscoped context registers globally.
 */
export function installGuidance(ctx: Context): void {
  const prompt = promptRegistry(ctx)
  ctx.effect(() => prompt.section({
    name: FT_SERVICES_SECTION,
    order: FT_SECTION_ORDERS.services,
    text: FT_SERVICES_TEXT,
  }), 'dsh-fft-settings: ft:services')
  ctx.effect(() => prompt.section({
    name: FT_DATA_POLICY_SECTION,
    order: FT_SECTION_ORDERS.dataPolicy,
    text: FT_DATA_POLICY_TEXT,
  }), 'dsh-fft-settings: ft:data-policy')
  // Optional service: the three sections never depend on the settings row, and
  // a missing provider only means the credential fact renders nothing.
  ctx.inject(['ftshareSettings'], scope => installCredentialFact(scope))
}
