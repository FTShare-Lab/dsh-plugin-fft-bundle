/**
 * The API Key card's own styles, rendered by the card component's `<style>`.
 *
 * A card owns everything past the section shell: the core declares the
 * `--ftshare-*` tokens and the section container, never card internals.
 * Every selector stays scoped under `.ftshare-settings`, so a card never
 * styles another card's markup.
 */
export const API_KEY_CARD_CSS = `
.ftshare-settings .ftshare-eyebrow { color:var(--ftshare-accent-on-surface); font-size:11px; letter-spacing:.12em; }
.ftshare-settings .ftshare-card { padding:22px; background:var(--ftshare-panel); border:1px solid var(--ftshare-border); border-radius:12px; margin-top:16px; }
.ftshare-settings label { display:block; font-weight:600; }
.ftshare-settings input { width:100%; height:44px; border:1px solid var(--ftshare-control); border-radius:7px; padding:0 12px; background:var(--ftshare-input); color:inherit; font:inherit; }
.ftshare-settings input::placeholder { color:var(--ftshare-muted); opacity:1; }
.ftshare-settings .ftshare-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:16px; }
.ftshare-settings button { min-height:44px; border:1px solid var(--ftshare-control); border-radius:7px; padding:8px 14px; font:inherit; background:transparent; color:inherit; cursor:pointer; }
.ftshare-settings button.primary { background:var(--ftshare-accent); color:var(--ftshare-accent-ink); border-color:var(--ftshare-accent); font-weight:600; }
.ftshare-settings button:disabled { opacity:.5; cursor:not-allowed; }
.ftshare-settings dl { margin:0; }
.ftshare-settings .ftshare-result { display:grid; grid-template-columns:130px 1fr; gap:12px; padding:10px 0; border-top:1px solid var(--ftshare-border); }
.ftshare-settings dd { margin:0; overflow-wrap:anywhere; }
.ftshare-settings .ftshare-error { color:var(--ftshare-error); }
@media(max-width:540px) { .ftshare-settings .ftshare-card { padding:16px; } .ftshare-settings .ftshare-result { grid-template-columns:1fr; gap:4px; } }
`
