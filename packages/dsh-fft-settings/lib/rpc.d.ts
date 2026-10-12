/**
 * `@ft/dsh-fft-settings/client-api` — the generic browser caller entry.
 *
 * Transport plus envelope helpers and their types, nothing feature-specific: a
 * card for any namespace uses `callSettingsRpc` against the namespace and
 * method its own host module registered. A feature's browser adapter lives
 * beside that feature instead of growing this entry.
 */
export * from './core/rpc-core.js';
export { createSettingsTransport } from './core/client-transport.js';
