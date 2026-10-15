/**
 * The section shell's styles plus the theme tokens every card reads.
 *
 * The shell owns the container, typography, focus ring and link rules that
 * every card sits inside; a card owns its own CSS and renders it from its own
 * component, and core never styles card internals.
 *
 * The theme layer declares the plugin's `--ftshare-*` tokens once, on
 * `.ftshare-settings` — the root element every card renders — so a card reads
 * a token without carrying a palette value of its own, and every colour lives
 * in exactly one place. `--ftshare-accent*` is the plugin's own brand, kept
 * apart from the host palette; the rest are surfaces and text.
 */
export declare const SETTINGS_CSS = "\n.ftshare-settings { --ftshare-text:#f4f4f5; --ftshare-muted:#aeb2bd; --ftshare-panel:#292a30; --ftshare-border:#44464f; --ftshare-control:#696c77; --ftshare-input:#1d1e23; --ftshare-link:#d8c4fc; --ftshare-error:#ffb5ad; --ftshare-accent:#f0c433; --ftshare-accent-ink:#171717; --ftshare-accent-on-surface:#e8bf35; }\n.ftshare-settings { color:var(--ftshare-text); max-width:760px; font-size:14px; line-height:1.6; }\n.ftshare-settings * { box-sizing:border-box; }\n.ftshare-settings h2 { font-size:26px; margin:4px 0 8px; }\n.ftshare-settings h3 { font-size:15px; margin:0 0 12px; }\n.ftshare-settings p { margin:8px 0; color:var(--ftshare-muted); }\n.ftshare-settings header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:20px; }\n.ftshare-settings small { display:block; color:var(--ftshare-muted); font-size:12px; margin:5px 0 12px; }\n.ftshare-settings :is(button,input,a):focus-visible { outline:2px solid var(--ftshare-accent-on-surface); outline-offset:3px; }\n.ftshare-settings a { color:var(--ftshare-link); }\n@media(max-width:540px) { .ftshare-settings header { flex-direction:column; gap:10px; } }\n";
