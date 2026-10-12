import { registerApiKeyCard, type ApiKeyCardContext } from './features/api-key/card.js'
import { registerLogsCard } from './features/logs/card.js'
import { registerSettingsSection } from './core/shell.js'
export * from './core/shell.js'
/** Browser context this plugin's own client half requires. */
export type FtshareSettingsClientContext = ApiKeyCardContext
export const inject = ['slots', 'remote']
export function apply(ctx: FtshareSettingsClientContext): void { registerFtshareSettings(ctx) }
/** Contribute the section shell, then the built-in cards through the slot it declares. */
export function registerFtshareSettings(ctx: FtshareSettingsClientContext): void {
  registerSettingsSection(ctx)
  registerApiKeyCard(ctx)
  registerLogsCard(ctx)
}
