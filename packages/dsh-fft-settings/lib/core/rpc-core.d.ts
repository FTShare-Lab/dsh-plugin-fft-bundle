import type { FTSHARE_SETTINGS_ROUTE } from './contract.js';
export interface RpcResult<T> {
    ok: boolean;
    value?: T;
    error?: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
}
/** Browser caller for this plugin's route. */
export interface ClientTransport {
    call(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>;
}
export type RpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
/** Structural shape of one exact Fetch route; `connection.fetch.register` accepts it. */
export interface SettingsRoute {
    readonly path: typeof FTSHARE_SETTINGS_ROUTE;
    readonly methods: readonly string[];
    readonly requestBody: 'buffered' | 'streaming';
    readonly fetch: (request: Request) => Promise<Response>;
}
/** Host registry for exact Fetch routes on the shared `/api` carrier. */
export interface HostFetch {
    register(route: SettingsRoute): () => Promise<void>;
}
export interface SettingsRpcMethod {
    validate(payload: unknown): boolean;
    invoke(payload: unknown, signal: AbortSignal): unknown | Promise<unknown>;
}
export type SettingsRpcMethods = Readonly<Record<string, SettingsRpcMethod>>;
export interface SettingsRpcModule {
    namespace: string;
    rpcMethods: SettingsRpcMethods;
}
/**
 * Live dispatch table behind {@link createSettingsRpcHandler}: routes appear
 * when a namespace is registered and disappear when it is released, so the one
 * route mounted at boot keeps serving namespaces that arrive later.
 */
export interface SettingsRpcTable {
    /** Validate one whole module, then publish its routes; a failure writes nothing. */
    register(module: SettingsRpcModule): void;
    /** Remove one namespace and every route under it; unknown namespaces are a no-op. */
    unregister(namespace: string): void;
    /** Namespaces currently owning at least one route, in registration order. */
    namespaces(): readonly string[];
}
/** The dispatcher callable plus the increment/decrement surface of its route table. */
export type SettingsRpcHandler = RpcHandler & SettingsRpcTable;
/** Names the service object and the route table reserve for themselves. */
export declare const SETTINGS_RESERVED_NAMES: readonly ["apiVersion", "modules", "constructor", "prototype", "__proto__"];
export declare function assertSettingsName(name: string): void;
/** Validate every endpoint part of one module without writing to any table. */
export declare function assertSettingsRpcModule(module: SettingsRpcModule): void;
/**
 * Build the live dispatcher for this plugin's route.
 *
 * Only explicitly registered methods are callable; never reflects over a
 * service. The returned function carries its own route table, so the caller
 * mounts the route once and mutates through `register` / `unregister`
 * afterwards. Each `register` validates the whole module first — namespace
 * format, reserved names, duplicates, and every method name — and writes
 * nothing when any check fails.
 * @param modules - optional initial namespaces, registered in order.
 * @returns dispatcher with the live route table attached.
 */
export declare function createSettingsRpcHandler(modules?: readonly SettingsRpcModule[]): SettingsRpcHandler;
export declare function callSettingsRpc<T>(transport: ClientTransport, namespace: string, method: string, payload?: unknown): Promise<T>;
