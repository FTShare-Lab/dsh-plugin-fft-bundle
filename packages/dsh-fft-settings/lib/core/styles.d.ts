/**
 * Section shell styles plus the theme variables the section promises.
 *
 * The shell owns the container, typography, focus ring and link rules every
 * card sits inside, and declares the `--ftshare-*` defaults. Declaring them
 * under `:where(:root)` keeps specificity at zero, so any host theme rule wins
 * while an unthemed host still gets this plugin's values. A card owns its own
 * CSS and renders it from its own component; core never styles card internals.
 */
export declare const SETTINGS_CSS = "\n:where(:root) { --ftshare-text:#f4f4f5; --ftshare-muted:#aeb2bd; --ftshare-panel:#292a30; --ftshare-border:#44464f; --ftshare-input:#1d1e23; --ftshare-link:#d8c4fc; --ftshare-error:#ffb5ad; }\n.ftshare-settings { color:var(--ftshare-text,#f4f4f5); max-width:760px; font-size:14px; line-height:1.6; }\n.ftshare-settings * { box-sizing:border-box; }\n.ftshare-settings h2 { font-size:26px; margin:4px 0 8px; }\n.ftshare-settings h3 { font-size:15px; margin:0 0 12px; }\n.ftshare-settings p { margin:8px 0; color:var(--ftshare-muted,#aeb2bd); }\n.ftshare-settings header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:20px; }\n.ftshare-settings small { display:block; color:var(--ftshare-muted,#aeb2bd); font-size:12px; margin:5px 0 12px; }\n.ftshare-settings :is(button,input,a):focus-visible { outline:2px solid #e8bf35; outline-offset:3px; }\n.ftshare-settings a { color:var(--ftshare-link,#d8c4fc); }\n@media(max-width:540px) { .ftshare-settings header { flex-direction:column; gap:10px; } }\n";
