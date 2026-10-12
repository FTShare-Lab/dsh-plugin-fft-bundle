import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { FTSHARE_SETTINGS_CARD_SLOT, FTSHARE_SETTINGS_SECTION } from './contract.js';
import { SETTINGS_CSS } from './styles.js';
/** Section slot this seam contributes into; declared by the settings shell. */
const FTSHARE_SETTINGS_SECTION_NAME = 'settings.section';
/**
 * The settings section shell: core CSS variables, the section chrome, and the
 * single render site every card appears at. Cards own everything inside it.
 */
export function FtshareSettingsSection({ renderSlot }) {
    return _jsxs(_Fragment, { children: [_jsx("style", { children: SETTINGS_CSS }), renderSlot(FTSHARE_SETTINGS_CARD_SLOT, {})] });
}
/**
 * Declare the card slot and contribute the section that renders it.
 *
 * Declaring the child slot is what authorizes the render site; a card
 * registering through {@link FTSHARE_SETTINGS_CARD_SLOT} before this runs waits
 * for the declaration instead of failing.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the section and its declaration.
 */
export function registerSettingsSection(ctx) {
    return ctx.slots.inject(FTSHARE_SETTINGS_SECTION_NAME, () => ctx.slots.register({
        name: FTSHARE_SETTINGS_SECTION_NAME,
        ...FTSHARE_SETTINGS_SECTION,
        children: { [FTSHARE_SETTINGS_CARD_SLOT]: { kind: 'list', scope: 'root' } },
    }, FtshareSettingsSection));
}
