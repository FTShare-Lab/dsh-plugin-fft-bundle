import type { Context } from '@deepseek-ai/cordis';
import { type FtshareSettingsService } from './contract.js';
export * from './contract.js';
export { defineSettingsModule } from './core/module-registry.js';
export declare const name = "@ft/dsh-fft-settings";
/**
 * Host services this plugin's own built-in modules resolve at registration.
 * A consuming plugin declares its own requirement; settings never declares
 * services on a module's behalf.
 */
export declare const inject: string[];
export declare const provide: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        ftshareSettings: FtshareSettingsService;
    }
}
export declare function apply(ctx: Context): void;
