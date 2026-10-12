import { registerApiKeyCard } from './modules/api-key/card.js'
import { registerSettingsSection, type FtshareSettingsClientContext } from './shell.js'
export * from './shell.js'
export const inject = ['slots', 'remote']
export function apply(ctx: FtshareSettingsClientContext): void { registerFtshareSettings(ctx) }
/** Contribute the section shell, then the built-in cards through the slot it declares. */
export function registerFtshareSettings(ctx: FtshareSettingsClientContext): void {
  registerSettingsSection(ctx)
  registerApiKeyCard(ctx)
}
