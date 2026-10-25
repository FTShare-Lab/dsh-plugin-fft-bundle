import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type FtshareSettingsService } from './contract.js';
import { DEFAULT_LOGS_CONFIG, type LogsConfig } from './features/logs/config.js';
export * from './contract.js';
export { defineSettingsModule } from './core/module-registry.js';
export declare const name = "@dsh-ft/dsh-fft-settings";
/**
 * Host services this plugin's own built-in modules resolve at registration.
 * A consuming plugin declares its own requirement; settings never declares
 * services on a module's behalf. The FT prompt contract lives in the `./agent`
 * entry, which only an agent preset mounts.
 */
export declare const inject: string[];
export declare const provide: string[];
/** Plugin config, assembled from each feature's own slice schema. */
export interface FtshareSettingsConfig {
    logs: LogsConfig;
}
/**
 * Native Schemastery schema of the whole plugin config: the features own their
 * slices, this entry only composes them. DSH's config collector accepts
 * nothing but a native Schemastery schema.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    logs: z<Schemastery.ObjectS<NoInfer<{
        level: z<"warn" | "debug", "warn" | "debug", "defined">;
        maxBytes: z<number, number, "defined">;
        keep: z<number, number, "defined">;
        sources: z<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        level: z<"warn" | "debug", "warn" | "debug", "defined">;
        maxBytes: z<number, number, "defined">;
        keep: z<number, number, "defined">;
        sources: z<string[], string[], "defined">;
    }>>, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    logs: z<Schemastery.ObjectS<NoInfer<{
        level: z<"warn" | "debug", "warn" | "debug", "defined">;
        maxBytes: z<number, number, "defined">;
        keep: z<number, number, "defined">;
        sources: z<string[], string[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        level: z<"warn" | "debug", "warn" | "debug", "defined">;
        maxBytes: z<number, number, "defined">;
        keep: z<number, number, "defined">;
        sources: z<string[], string[], "defined">;
    }>>, "defined">;
}>>, "plain">;
export { DEFAULT_LOGS_CONFIG };
export type { LogsConfig };
declare module '@deepseek-ai/cordis' {
    interface Context {
        ftshareSettings: FtshareSettingsService;
    }
}
/**
 * @param config - validated plugin config. Each built-in module is registered
 * eagerly, so the log collector starts here, unconditionally, instead of
 * waiting for a settings-page render.
 *
 * The parameter default is deliberately **not** relied on: cordis validates the
 * raw row through {@link Config} before this call, and a direct `apply(ctx)`
 * call (tests, hand-built contexts) never triggers one — so the fallback parse
 * happens in the body and every feature slice is always defined.
 */
export declare function apply(ctx: Context, config?: FtshareSettingsConfig): void;
