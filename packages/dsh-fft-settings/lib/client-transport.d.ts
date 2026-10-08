/**
 * Browser half of the settings transport.
 *
 * Calls are same-origin fetches to the plugin route, so the browser session
 * cookie carries authentication and this plugin needs no Connection RPC client.
 */
import type { ClientTransport } from './rpc-core.js';
/** Transport this caller posts through; same signature as the global `fetch`. */
export type SettingsFetch = (input: string, init: RequestInit) => Promise<Response>;
/**
 * Create the browser-backed caller used by the settings cards.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @returns caller that owns request encoding and envelope decoding.
 */
export declare function createSettingsTransport(doFetch?: SettingsFetch): ClientTransport;
