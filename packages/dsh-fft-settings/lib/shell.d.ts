import type { ReactNode } from 'react';
import type { PropsRenderSlots, PropsRuntime, SlotCore, SlotMap } from '@deepseek-ai/dsh-client-ui-slots';
import { FTSHARE_SETTINGS_CARD_SLOT } from './contract.js';
/** Section slot this seam contributes into; declared by the settings shell. */
declare const FTSHARE_SETTINGS_SECTION_NAME: "settings.section";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** One card inside the FTShare settings section; `order` sets its position. */
        'ftshare.settings.card': {
            kind: 'list';
            scope: 'root';
            owner: FtshareSettingsCardOwnerProps;
        };
    }
}
/** Owner share of a card: the section supplies no card-specific props. */
export interface FtshareSettingsCardOwnerProps {
    /** Marker field: card owner props are intentionally empty. */
    children?: never;
}
/**
 * The slice of the renderer-owned slots service this seam uses.
 *
 * `register` IS the ui-slots registration signature (the runtime registry
 * reuses it verbatim, adding disposal through the caller's fiber); `inject`
 * is the runtime wrapper's declaration-lifetime hook, which is why it is
 * mirrored structurally here.
 */
export interface FtshareSettingsSlotsService {
    readonly register: SlotCore['register'];
    /** Run `callback` for each declaration lifetime of `key`. */
    inject(key: keyof SlotMap & string, callback: () => () => void): () => void;
}
/**
 * Browser context this plugin's client half requires. The renderer provides
 * `slots`; `remote` carries credential invalidation and `on` the connection
 * reset that also invalidates a cached status.
 */
export interface FtshareSettingsClientContext {
    slots: FtshareSettingsSlotsService;
    remote: {
        $on(event: string, listener: (ref: string) => void): () => void;
    };
    on(event: 'connection/reset', listener: () => void): () => void;
}
/** Composed props of the section entry: the shell's owner share plus its declared child render. */
export type FtshareSettingsSectionProps = PropsRuntime<typeof FTSHARE_SETTINGS_SECTION_NAME> & PropsRenderSlots<typeof FTSHARE_SETTINGS_CARD_SLOT>;
/**
 * The settings section shell: core CSS variables, the section chrome, and the
 * single render site every card appears at. Cards own everything inside it.
 */
export declare function FtshareSettingsSection({ renderSlot }: FtshareSettingsSectionProps): ReactNode;
/**
 * Declare the card slot and contribute the section that renders it.
 *
 * Declaring the child slot is what authorizes the render site; a card
 * registering through {@link FTSHARE_SETTINGS_CARD_SLOT} before this runs waits
 * for the declaration instead of failing.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the section and its declaration.
 */
export declare function registerSettingsSection(ctx: FtshareSettingsClientContext): () => void;
export {};
