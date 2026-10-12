/**
 * The `logs` card's own styles, rendered by the card component's `<style>`.
 *
 * These two rules used to live in the core section stylesheet; a card owns
 * everything past the section shell, so they moved here with the card. Every
 * selector stays scoped under `.ftshare-settings`, so a card never styles
 * another card's markup.
 */
export const LOGS_CARD_CSS = `
.ftshare-settings select { height:44px; border:1px solid #696c77; border-radius:7px; padding:0 10px; background:var(--ftshare-input,#1d1e23); color:inherit; font:inherit; }
.ftshare-settings .ftshare-log-preview { max-height:320px; overflow:auto; margin:0 0 12px; padding:12px; background:var(--ftshare-input,#1d1e23); border:1px solid var(--ftshare-border,#44464f); border-radius:7px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
`;
