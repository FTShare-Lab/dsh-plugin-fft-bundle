/**
 * FT brand tokens published as a host theme override layer.
 *
 * The layer only *adds* brand variables on `body`; it never overrides a
 * `--dsw-alias-*` value, so host chrome keeps its own palette and any user
 * theme keeps working underneath. Consumers read `var(--ft-*)` with the same
 * value as their fallback: the layer is a convenience, not a dependency, so
 * every sub-plugin keeps its brand colors when this plugin is absent (or when
 * the host has no `theme` service at all). Scheme-invariant tokens repeat one
 * value; palette-aware tokens spell both with `light-dark()`.
 *
 * Keep those fallbacks equal to {@link FT_BRAND_TOKENS}; `tests/brand.test.mjs`
 * scans every package for the pairing and fails on a drift.
 */

/** One token value per palette mode; the host rejects a bare string. */
export interface BrandTokenModes {
  readonly light: string
  readonly dark: string
}

/** One value for both palettes: brand fills are scheme-invariant. */
const invariant = (value: string): BrandTokenModes => ({ light: value, dark: value })

/** Layer identity reported to `ctx.theme.overrideTokens` (one layer per source). */
export const FT_BRAND_SOURCE = '@ft/dsh-fft-settings'

/**
 * The published brand colors.
 *
 * `accent` is the FT yellow used by this plugin's primary action and eyebrow;
 * `accent-warm` is the orange trading accent shared by market and trade
 * surfaces (it is the only palette-aware group); `wechat` is the enterprise-
 * WeChat green the SSO card keeps as its identity. Inks are the text colors on
 * those fills, and `-soft` is the tinted surface behind the accent.
 */
export const FT_BRAND_TOKENS: Readonly<Record<string, BrandTokenModes>> = Object.freeze({
  '--ft-accent': invariant('#f0c433'),
  '--ft-accent-ink': invariant('#171717'),
  '--ft-accent-warm': { light: '#cf5623', dark: '#ff8352' },
  '--ft-accent-warm-hover': { light: '#b8481b', dark: '#ff9a72' },
  '--ft-accent-warm-ink': { light: '#ffffff', dark: '#1a120e' },
  '--ft-accent-warm-soft': { light: '#fbeee8', dark: '#2b1d16' },
  '--ft-wechat': invariant('#2ebd68'),
  '--ft-wechat-ink': invariant('#102419'),
})

/** The slice of the host theme service this layer uses. */
export interface BrandThemeService {
  overrideTokens(source: string, tokens: Readonly<Record<string, BrandTokenModes>>): () => void
}

/** Scoped context delivered once the `theme` service is available. */
export interface BrandThemeScope {
  readonly theme: BrandThemeService
  effect(callback: () => () => void, label: string): void
}

/** The slice of the client context this layer needs: a deferred service inject. */
export interface BrandThemeContext {
  inject(deps: readonly string[], callback: (scope: BrandThemeScope) => void): void
}

/**
 * Stack the brand layer once the host theme service exists.
 *
 * The deferred `inject` is deliberate: this plugin's declared client context
 * names only the services its cards read, and a host without `theme` must
 * still load the settings page — the CSS fallbacks then carry the colors.
 * @param ctx - client context carrying the host theme service.
 */
export function applyBrandTokens(ctx: BrandThemeContext): void {
  ctx.inject(['theme'], (scope) => {
    scope.effect(
      () => scope.theme.overrideTokens(FT_BRAND_SOURCE, FT_BRAND_TOKENS),
      'ft-settings: FT brand tokens',
    )
  })
}
