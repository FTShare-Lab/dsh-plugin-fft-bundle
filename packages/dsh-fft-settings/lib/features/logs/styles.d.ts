/**
 * The `logs` card's own styles, rendered by the card component's `<style>`.
 *
 * These two rules used to live in the core section stylesheet; a card owns
 * everything past the section shell, so they moved here with the card. Every
 * selector stays scoped under `.ftshare-settings`, so a card never styles
 * another card's markup.
 */
export declare const LOGS_CARD_CSS = "\n.ftshare-settings select { height:44px; border:1px solid var(--ftshare-control); border-radius:7px; padding:0 10px; background:var(--ftshare-input); color:inherit; font:inherit; }\n.ftshare-settings .ftshare-download { display:inline-flex; align-items:center; min-height:44px; padding:8px 14px; border:1px solid var(--ftshare-control); border-radius:7px; color:inherit; text-decoration:none; cursor:pointer; }\n.ftshare-settings .ftshare-log-preview { max-height:320px; overflow:auto; margin:0 0 12px; padding:12px; background:var(--ftshare-input); border:1px solid var(--ftshare-border); border-radius:7px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }\n";
