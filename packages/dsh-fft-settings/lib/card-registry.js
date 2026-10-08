export function defineSettingsCard(card) { return card; }
export function assembleSettingsCards(ctx, cards) {
    const seen = new Set();
    for (const card of cards) {
        if (!card.id || seen.has(card.id))
            throw new Error(`Invalid or duplicate settings card: ${card.id}`);
        if (!Number.isFinite(card.order))
            throw new Error(`Invalid settings card order: ${card.id}`);
        seen.add(card.id);
    }
    return [...cards].sort((a, b) => a.order - b.order).map(card => ({ id: card.id, Component: card.createComponent(ctx) }));
}
