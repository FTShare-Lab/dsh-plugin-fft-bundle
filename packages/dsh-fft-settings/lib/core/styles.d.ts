/**
 * The section shell's styles plus the theme tokens every card reads.
 *
 * The shell owns the container, typography, focus ring and link rules that
 * every card sits inside; a card owns its own CSS and renders it from its own
 * component, and core never styles card internals.
 *
 * The theme layer declares the plugin's `--ftshare-*` tokens once, on
 * `.ftshare-settings` — the root element every card renders. Surfaces and text
 * take their value from the host palette: `--dsw-alias-*` is what DSH
 * publishes for the light, the dark and every registered theme, so one
 * stylesheet follows the live palette with no script, no `prefers-color-scheme`
 * copy and no second palette to keep in sync. The literal inside each `var()`
 * is the fallback for a host that publishes no palette.
 *
 * The declarations sit on the card root rather than on `:root` because a
 * custom property resolves where it is *declared*: `--dsw-alias-*` exists from
 * `body` downwards, so a value derived from it above `body` would resolve to
 * nothing and fall back. Consequence: the place to pin a look is the host
 * palette itself (`ctx.theme.register` / `ctx.theme.overrideTokens`), not these
 * names.
 *
 * `--ftshare-accent*` is the plugin's own brand and has no host equivalent. The
 * values come from the FT brand layer's `--ft-*` tokens (`src/brand.ts`), with
 * the same literal as the fallback so the card keeps its colors when that layer
 * is absent. The fill and its ink are scheme-invariant;
 * `--ftshare-accent-on-surface` mixes the same yellow towards the host's text
 * colour, so the brand stays legible as the 11px eyebrow and as the focus ring
 * on either surface.
 */
export declare const SETTINGS_CSS = "\n.ftshare-settings { --ftshare-text:var(--dsw-alias-label-primary,#f4f4f5); --ftshare-muted:var(--dsw-alias-label-secondary,#aeb2bd); --ftshare-panel:var(--dsw-alias-settings-card-fill,#292a30); --ftshare-border:var(--dsw-alias-settings-card-stroke,#44464f); --ftshare-control:var(--dsw-alias-border-l4,#696c77); --ftshare-input:var(--dsw-alias-bg-layer-1,#1d1e23); --ftshare-link:var(--dsw-alias-link,#d8c4fc); --ftshare-error:var(--dsw-alias-state-error-primary,#ffb5ad); --ftshare-accent:var(--ft-accent,#f0c433); --ftshare-accent-ink:var(--ft-accent-ink,#171717); --ftshare-accent-on-surface:color-mix(in srgb,var(--ftshare-accent) 50%,var(--dsw-alias-label-primary,#f4f4f5)); }\n.ftshare-settings { color:var(--ftshare-text); max-width:760px; font-size:14px; line-height:1.6; }\n.ftshare-settings * { box-sizing:border-box; }\n.ftshare-settings h2 { font-size:26px; margin:4px 0 8px; }\n.ftshare-settings h3 { font-size:15px; margin:0 0 12px; }\n.ftshare-settings p { margin:8px 0; color:var(--ftshare-muted); }\n.ftshare-settings header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:20px; }\n.ftshare-settings small { display:block; color:var(--ftshare-muted); font-size:12px; margin:5px 0 12px; }\n.ftshare-settings :is(button,input,a):focus-visible { outline:2px solid var(--ftshare-accent-on-surface); outline-offset:3px; }\n.ftshare-settings a { color:var(--ftshare-link); }\n@media(max-width:540px) { .ftshare-settings header { flex-direction:column; gap:10px; } }\n";
