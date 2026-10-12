import type { Context } from '@deepseek-ai/cordis';
import { type FtshareSettingsService } from './contract.js';
import { type SettingsRpcHandler, type SettingsRpcMethods } from './rpc-core.js';
/**
 * One contribution to the settings service: a namespace, the host services it
 * needs, and a synchronous factory for its service instance and RPC methods.
 * Third parties may write this shape structurally; `defineSettingsModule` only
 * buys type inference.
 */
export interface SettingsModule<N extends string = string, S = unknown> {
    /** Namespace: the RPC endpoint prefix and the service property name. */
    readonly namespace: N;
    /** Host services this module resolves on its owner context at registration. */
    readonly inject: readonly string[];
    /** Register lifecycle cleanup through ctx.effect/on; never return browser secrets as RPC methods. */
    create(ctx: Context): {
        service: S;
        rpcMethods: SettingsRpcMethods;
    };
}
export declare function defineSettingsModule<const N extends string, S>(module: SettingsModule<N, S>): SettingsModule<N, S>;
/** Handle returned by {@link FtshareSettingsModuleRegistry.register}. */
export interface SettingsRegistration<N extends string = string, S = unknown> {
    readonly namespace: N;
    readonly service: S;
    /** Idempotent; also runs when the owner fiber releases. */
    dispose(): void;
}
/** Live namespace registry behind `ctx.ftshareSettings.modules`. */
export interface FtshareSettingsModuleRegistry {
    register<const N extends string, S>(module: SettingsModule<N, S>, owner: Context): SettingsRegistration<N, S>;
    /** Namespaces currently published on the service object, in registration order. */
    namespaces(): readonly string[];
}
/** The host half assembled by {@link createSettingsHost}. */
export interface FtshareSettingsHost {
    /** Service object published as `ctx.ftshareSettings`; namespaces appear on it at runtime. */
    readonly service: FtshareSettingsService;
    /** Live dispatch table; mount it once and let namespaces come and go. */
    readonly handler: SettingsRpcHandler;
}
/**
 * Assemble the host half of the seam: one service object plus one live route
 * table that namespaces register into.
 *
 * Registration is validate-then-write: a bad namespace, a reserved name, a
 * duplicate, or an unresolvable `module.inject` entry throws before `create`
 * runs and leaves no service property or route behind. A successful
 * registration installs a release effect on the owner fiber, so unloading the
 * owner removes the service property and every route of that namespace
 * together; the returned `dispose()` is idempotent and equivalent.
 * @returns the service object and its route table.
 */
export declare function createSettingsHost(): FtshareSettingsHost;
