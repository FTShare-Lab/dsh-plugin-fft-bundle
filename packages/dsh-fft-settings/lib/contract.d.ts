/**
 * `@ft/dsh-fft-settings/contract` — the aggregate contract entry.
 *
 * Re-exports the generic seam contract plus every built-in feature contract,
 * so `FtshareSettingsService`, the route constants and the API Key / logs
 * vocabulary keep arriving from one import. It has no Node runtime dependency, so it is
 * safe in a browser bundle and in a host plugin alike. Two type sources feed
 * it: the Host contract (`./core/contract.js` plus each feature contract) and,
 * for UI composition, `@ft/dsh-fft-settings/client`, which merges the card
 * slot into the renderer's SlotMap.
 */
export * from './core/contract.js';
export * from './features/api-key/contract.js';
export * from './features/logs/contract.js';
