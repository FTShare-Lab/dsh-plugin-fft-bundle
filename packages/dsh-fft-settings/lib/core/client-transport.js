/**
 * Browser half of the settings transport.
 *
 * Calls are same-origin fetches to the plugin route, so the browser session
 * cookie carries authentication and this plugin needs no Connection RPC client.
 */
import { FTSHARE_SETTINGS_ROUTE } from './contract.js';
/**
 * Create the browser-backed caller used by the settings cards.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @returns caller that owns request encoding and envelope decoding.
 */
export function createSettingsTransport(doFetch) {
    const send = doFetch ?? ((input, init) => globalThis.fetch(input, init));
    return {
        async call(endpoint, payload = {}, signal) {
            const response = await send(FTSHARE_SETTINGS_ROUTE, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ endpoint, payload }),
                ...signal === undefined ? {} : { signal },
            });
            if (!response.ok) {
                // The carrier answers 401/403 before dispatch; anything else is a route
                // or plugin-level failure. Both are transport failures for the caller.
                throw new Error(`transport failure for ${endpoint}: HTTP ${response.status}`);
            }
            return await response.json();
        },
    };
}
