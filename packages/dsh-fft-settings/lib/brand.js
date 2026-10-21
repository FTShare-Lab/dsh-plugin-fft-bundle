/**
 * FT brand tokens published as a host theme override layer.
 *
 * The layer only *adds* four variables on `body`; it never overrides a
 * `--dsw-alias-*` value, so host chrome keeps its own palette and any user
 * theme keeps working underneath. Consumers read `var(--ft-*)` with the same
 * value as their fallback: the layer is a convenience, not a dependency, so
 * every sub-plugin keeps its brand colors when this plugin is absent (or when
 * the host has no `theme` service at all).
 *
 * Keep those fallbacks equal to {@link FT_BRAND_TOKENS}; `tests/brand.test.mjs`
 * scans every package for the pairing and fails on a drift.
 */
/** One value for both palettes: brand fills are scheme-invariant. */
const invariant = (value) => ({ light: value, dark: value });
/** Layer identity reported to `ctx.theme.overrideTokens` (one layer per source). */
export const FT_BRAND_SOURCE = '@ft/dsh-fft-settings';
/**
 * The published brand colors.
 *
 * `accent` is the FT yellow used by this plugin's primary action and eyebrow;
 * `wechat` is the enterprise-WeChat green the SSO card keeps as its identity.
 * Both inks are the text colors that sit on those fills.
 */
export const FT_BRAND_TOKENS = Object.freeze({
    '--ft-accent': invariant('#f0c433'),
    '--ft-accent-ink': invariant('#171717'),
    '--ft-wechat': invariant('#2ebd68'),
    '--ft-wechat-ink': invariant('#102419'),
});
/**
 * Stack the brand layer once the host theme service exists.
 *
 * The deferred `inject` is deliberate: this plugin's declared client context
 * names only the services its cards read, and a host without `theme` must
 * still load the settings page — the CSS fallbacks then carry the colors.
 * @param ctx - client context carrying the host theme service.
 */
export function applyBrandTokens(ctx) {
    ctx.inject(['theme'], (scope) => {
        scope.effect(() => scope.theme.overrideTokens(FT_BRAND_SOURCE, FT_BRAND_TOKENS), 'ft-settings: FT brand tokens');
    });
}
