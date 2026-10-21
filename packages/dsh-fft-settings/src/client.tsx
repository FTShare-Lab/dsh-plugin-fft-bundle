import { registerApiKeyCard, type ApiKeyCardContext } from './features/api-key/card.js'
import { registerLogsCard } from './features/logs/card.js'
import { registerSettingsSection } from './core/shell.js'
import { applyBrandTokens, type BrandThemeContext } from './brand.js'
export * from './core/shell.js'
/** Browser context this plugin's own client half requires. */
export type FtshareSettingsClientContext = ApiKeyCardContext
export const inject = ['slots', 'remote']
export function apply(ctx: FtshareSettingsClientContext): void {
  registerFtshareSettings(ctx)
  // The declared context above names only the services the cards read; the
  // brand layer defers on `theme` through the full Cordis context, so this
  // plugin still loads on a host without the theme service.
  applyBrandTokens(ctx as unknown as BrandThemeContext)
}
/** Contribute the section shell, then the built-in cards through the slot it declares. */
export function registerFtshareSettings(ctx: FtshareSettingsClientContext): void {
  registerSettingsSection(ctx)
  registerApiKeyCard(ctx)
  registerLogsCard(ctx)
}
