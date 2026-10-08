import { type ReactNode } from 'react';
import { type ShellReader } from '../../shell.js';
/**
 * Version and check-for-updates entry, above the credentials card.
 *
 * The desktop shell is the only source: version and update state deliberately do
 * not travel over the plugin RPC surface, so this card declares no injection.
 */
export declare const appVersionCard: import("../../card-registry.js").SettingsCard;
export declare function AppVersionCard({ shell }: {
    readonly shell: ShellReader;
}): ReactNode;
