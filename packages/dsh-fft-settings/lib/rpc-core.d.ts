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
export declare function assertSettingsName(name: string): void;
/** Only explicitly registered methods are callable; never reflects over a service. */
export declare function createSettingsRpcHandler(modules: readonly SettingsRpcModule[]): RpcHandler;
export declare function callSettingsRpc<T>(transport: ClientTransport, namespace: string, method: string, payload?: unknown): Promise<T>;
