/**
 * Agent-plane entry for the FT prompt contract.
 *
 * Mounted by an agent preset so the contract exists only for that preset's
 * agents; the package's host entry keeps providing the settings service and
 * must not be mounted from a preset (a service row there needs an isolate
 * realm). The texts and the registration both live in `./guidance.ts`, so this
 * entry adds no second copy.
 * @module @dsh-ft/dsh-fft-settings/agent
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "@dsh-ft/dsh-fft-settings/agent";
/**
 * The prompt registry this entry contributes to. `ftshareSettings` is optional
 * and mounted in `installGuidance`, so a missing settings row costs only the
 * credential fact instead of the whole contract.
 */
export declare const inject: string[];
/**
 * Register the FT prompt contract in the mounting scope.
 * @param ctx - the preset subtree's context; the preset's agents are the scope.
 */
export declare function apply(ctx: Context): void;
