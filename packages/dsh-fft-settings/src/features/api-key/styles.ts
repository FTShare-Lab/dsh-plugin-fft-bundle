/**
 * The API Key card's own styles, rendered by the card component's `<style>`.
 *
 * A card owns everything past the section shell: the core provides the
 * `--ftshare-*` variables and the section container, never card internals.
 * Every selector stays scoped under `.ftshare-settings`, so a card never
 * styles another card's markup.
 */
export const API_KEY_CARD_CSS = `
.ftshare-settings .ftshare-eyebrow { color:#e8bf35; font-size:11px; letter-spacing:.12em; }
.ftshare-settings .ftshare-badge { padding:5px 12px; border:1px solid #585b66; border-radius:20px; white-space:nowrap; }
.ftshare-settings .ftshare-card { padding:22px; background:var(--ftshare-panel,#292a30); border:1px solid var(--ftshare-border,#44464f); border-radius:12px; margin-top:16px; }
.ftshare-settings label { display:block; font-weight:600; }
.ftshare-settings input { width:100%; height:44px; border:1px solid #696c77; border-radius:7px; padding:0 12px; background:var(--ftshare-input,#1d1e23); color:inherit; font:inherit; }
.ftshare-settings input::placeholder { color:var(--ftshare-muted,#aeb2bd); opacity:1; }
.ftshare-settings .ftshare-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:16px; }
.ftshare-settings button { min-height:44px; border:1px solid #696c77; border-radius:7px; padding:8px 14px; font:inherit; background:transparent; color:inherit; cursor:pointer; }
.ftshare-settings button.primary { background:#f0c433; color:#171717; border-color:#f0c433; font-weight:600; }
.ftshare-settings button:disabled { opacity:.5; cursor:not-allowed; }
.ftshare-settings dl { margin:0; }
.ftshare-settings .ftshare-result { display:grid; grid-template-columns:130px 1fr; gap:12px; padding:10px 0; border-top:1px solid var(--ftshare-border,#44464f); }
.ftshare-settings dd { margin:0; overflow-wrap:anywhere; }
.ftshare-settings .ftshare-error { color:var(--ftshare-error,#ffb5ad); }
@media(max-width:540px) { .ftshare-settings .ftshare-card { padding:16px; } .ftshare-settings .ftshare-result { grid-template-columns:1fr; gap:4px; } }
`
