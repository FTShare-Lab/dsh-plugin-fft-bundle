import { type FtshareSettingsClientContext } from './card-registry.js';
export type { FtshareSettingsClientContext } from './card-registry.js';
export { FtshareSettingsSection } from './modules/api-key/card.js';
/** Re-exported so other plugins read the shell protocol instead of re-implementing it (FR-15). */
export * from './shell.js';
export declare const inject: string[];
export declare function apply(ctx: FtshareSettingsClientContext): void;
export declare function registerFtshareSettings(ctx: FtshareSettingsClientContext): void;
