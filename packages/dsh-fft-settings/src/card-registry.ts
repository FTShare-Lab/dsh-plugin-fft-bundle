import type { ReactNode } from 'react'
export interface FtshareSettingsClientContext {
  remote: { $on(event: string, listener: (ref: string) => void): () => void }
  on(event: 'connection/reset', listener: () => void): () => void
  slots: {
    inject(name: string, callback: () => void | (() => void)): void
    register(config: { name: string; id: string; order?: number; label?: string }, component: () => ReactNode): () => void
  }
}
export interface SettingsCard {
  readonly id: string
  readonly order: number
  readonly inject: readonly string[]
  /** Bind adapters here; acquire subscriptions in the component's effect. */
  createComponent(ctx: FtshareSettingsClientContext): () => ReactNode
}
export function defineSettingsCard(card: SettingsCard): SettingsCard { return card }
export function assembleSettingsCards(ctx: FtshareSettingsClientContext, cards: readonly SettingsCard[]) {
  const seen = new Set<string>()
  for (const card of cards) {
    if (!card.id || seen.has(card.id)) throw new Error(`Invalid or duplicate settings card: ${card.id}`)
    if (!Number.isFinite(card.order)) throw new Error(`Invalid settings card order: ${card.id}`)
    seen.add(card.id)
  }
  return [...cards].sort((a, b) => a.order - b.order).map(card => ({ id: card.id, Component: card.createComponent(ctx) }))
}
