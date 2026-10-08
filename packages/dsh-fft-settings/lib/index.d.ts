import type { Context } from '@deepseek-ai/cordis';
import { type FtshareSettingsService } from './contract.js';
export * from './contract.js';
export declare const name = "@ft/dsh-fft-settings";
export declare const inject: string[];
export declare const provide: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        ftshareSettings: FtshareSettingsService;
    }
}
export declare function apply(ctx: Context): void;
