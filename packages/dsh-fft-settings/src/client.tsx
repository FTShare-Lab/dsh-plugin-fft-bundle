import { assembleSettingsCards, type FtshareSettingsClientContext } from './card-registry.js'
import { settingsCards } from './cards.js'
import { FTSHARE_SETTINGS_SECTION } from './contract.js'
import { SETTINGS_CSS } from './styles.js'
export type { FtshareSettingsClientContext } from './card-registry.js'
export { FtshareSettingsSection } from './modules/api-key/card.js'
export const inject = [...new Set(['slots', ...settingsCards.flatMap(card => [...card.inject])])]
export function apply(ctx: FtshareSettingsClientContext): void { registerFtshareSettings(ctx) }
export function registerFtshareSettings(ctx: FtshareSettingsClientContext): void {
  ctx.slots.inject('settings.section', () => {
    const cards = assembleSettingsCards(ctx, settingsCards)
    return ctx.slots.register({ name: 'settings.section', ...FTSHARE_SETTINGS_SECTION }, () => <>
      <style>{SETTINGS_CSS}</style>
      {cards.map(({ id, Component }) => <Component key={id} />)}
    </>)
  })
}
