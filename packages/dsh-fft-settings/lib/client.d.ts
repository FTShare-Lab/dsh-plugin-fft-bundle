import { type FtshareSettingsClientContext } from './shell.js';
export * from './shell.js';
export declare const inject: string[];
export declare function apply(ctx: FtshareSettingsClientContext): void;
/** Contribute the section shell, then the built-in cards through the slot it declares. */
export declare function registerFtshareSettings(ctx: FtshareSettingsClientContext): void;
