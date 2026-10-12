import { type ApiKeyCardContext } from './features/api-key/card.js';
export * from './core/shell.js';
/** Browser context this plugin's own client half requires. */
export type FtshareSettingsClientContext = ApiKeyCardContext;
export declare const inject: string[];
export declare function apply(ctx: FtshareSettingsClientContext): void;
/** Contribute the section shell, then the built-in cards through the slot it declares. */
export declare function registerFtshareSettings(ctx: FtshareSettingsClientContext): void;
