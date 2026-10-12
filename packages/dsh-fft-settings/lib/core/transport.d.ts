/**
 * Host half of the settings transport.
 *
 * One exact route on the shared `/api` carrier: the carrier owns the Host/Origin
 * fence and browser authentication, so this layer only decodes the call, bounds
 * the body and returns the result envelope. Registering through
 * `connection.rpc.handle` instead would read `webServer` through the context
 * property proxy, whose resolution is ancestor-only and therefore fails for a
 * plugin mounted beside the Web server.
 */
import type { RpcHandler, SettingsRoute } from './rpc-core.js';
/**
 * Build the exact Fetch route served by the connection carrier.
 * @param options - the settings call handler.
 * @returns route definition ready for `connection.fetch.register`.
 */
export declare function createSettingsRoute({ handler }: {
    readonly handler: RpcHandler;
}): SettingsRoute;
