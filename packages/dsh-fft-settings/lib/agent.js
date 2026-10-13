/**
 * Agent-plane entry for the FT prompt contract.
 *
 * Mounted by an agent preset so the contract exists only for that preset's
 * agents; the package's host entry keeps providing the settings service and
 * must not be mounted from a preset (a service row there needs an isolate
 * realm). The texts and the registration both live in `./guidance.ts`, so this
 * entry adds no second copy.
 * @module @ft/dsh-fft-settings/agent
 */
import { installGuidance } from './guidance.js';
/** Cordis plugin name. */
export const name = '@ft/dsh-fft-settings/agent';
/**
 * The prompt registry this entry contributes to. `ftshareSettings` is optional
 * and mounted in `installGuidance`, so a missing settings row costs only the
 * credential fact instead of the whole contract.
 */
export const inject = ['systemPrompt'];
/**
 * Register the FT prompt contract in the mounting scope.
 * @param ctx - the preset subtree's context; the preset's agents are the scope.
 */
export function apply(ctx) {
    installGuidance(ctx);
}
