import type { Context } from '@deepseek-ai/cordis';
import { FTSHARE_SETTINGS_API_VERSION } from './contract.js';
import { type SettingsRpcMethods } from './rpc-core.js';
export interface SettingsModule<N extends string = string, S = unknown> {
    readonly namespace: N;
    readonly inject: readonly string[];
    /** Register lifecycle cleanup through ctx.effect/on; never return browser secrets as RPC methods. */
    create(ctx: Context): {
        service: S;
        rpcMethods: SettingsRpcMethods;
    };
}
export declare function defineSettingsModule<const N extends string, S>(module: SettingsModule<N, S>): SettingsModule<N, S>;
export type SettingsServices<M extends readonly SettingsModule[]> = {
    readonly [Entry in M[number] as Entry['namespace']]: ReturnType<Entry['create']>['service'];
};
export declare function assembleSettings<const M extends readonly SettingsModule[]>(ctx: Context, modules: M): {
    service: {
        readonly apiVersion: typeof FTSHARE_SETTINGS_API_VERSION;
    } & SettingsServices<M>;
    handler: import("./rpc-core.js").RpcHandler;
};
