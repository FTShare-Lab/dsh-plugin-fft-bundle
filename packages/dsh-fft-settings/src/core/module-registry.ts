import type { Context } from '@deepseek-ai/cordis'
import { FTSHARE_SETTINGS_API_VERSION, type FtshareSettingsService } from './contract.js'
import { assertSettingsName, assertSettingsRpcModule, createSettingsRpcHandler, type SettingsRpcHandler, type SettingsRpcMethods } from './rpc-core.js'

/**
 * One contribution to the settings service: a namespace, the host services it
 * needs, and a synchronous factory for its service instance and RPC methods.
 * Third parties may write this shape structurally; `defineSettingsModule` only
 * buys type inference.
 */
export interface SettingsModule<N extends string = string, S = unknown> {
  /** Namespace: the RPC endpoint prefix and the service property name. */
  readonly namespace: N
  /** Host services this module resolves on its owner context at registration. */
  readonly inject: readonly string[]
  /** Register lifecycle cleanup through ctx.effect/on; never return browser secrets as RPC methods. */
  create(ctx: Context): { service: S; rpcMethods: SettingsRpcMethods }
}
export function defineSettingsModule<const N extends string, S>(module: SettingsModule<N, S>): SettingsModule<N, S> { return module }
/** Handle returned by {@link FtshareSettingsModuleRegistry.register}. */
export interface SettingsRegistration<N extends string = string, S = unknown> {
  readonly namespace: N
  readonly service: S
  /** Idempotent; also runs when the owner fiber releases. */
  dispose(): void
}
/** Live namespace registry behind `ctx.ftshareSettings.modules`. */
export interface FtshareSettingsModuleRegistry {
  register<const N extends string, S>(module: SettingsModule<N, S>, owner: Context): SettingsRegistration<N, S>
  /** Namespaces currently published on the service object, in registration order. */
  namespaces(): readonly string[]
}
/** The host half assembled by {@link createSettingsHost}. */
export interface FtshareSettingsHost {
  /** Service object published as `ctx.ftshareSettings`; namespaces appear on it at runtime. */
  readonly service: FtshareSettingsService
  /** Live dispatch table; mount it once and let namespaces come and go. */
  readonly handler: SettingsRpcHandler
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
export function createSettingsHost(): FtshareSettingsHost {
  const handler = createSettingsRpcHandler()
  /** Namespaces published by this host, in registration order. */
  const published = new Map<string, SettingsRegistration<string, unknown>>()
  const target: Record<string, unknown> = { apiVersion: FTSHARE_SETTINGS_API_VERSION }

  function register<N extends string, S>(module: SettingsModule<N, S>, owner: Context): SettingsRegistration<N, S> {
    // Validate everything knowable before the first write. `rpcMethods` exists
    // only after `create`, so its endpoint names are checked immediately after,
    // still before this registration publishes anything.
    assertSettingsName(module.namespace)
    if (published.has(module.namespace)) throw new Error(`Duplicate settings namespace: ${module.namespace}`)
    for (const name of module.inject) {
      if (owner.get(name) === undefined) throw new Error(`Missing settings module dependency for ${module.namespace}: ${name}`)
    }
    let released = false
    let committed = false
    let instance: S | undefined
    const release = (): void => {
      if (released) return
      released = true
      if (!committed) return
      if (target[module.namespace] === instance) delete target[module.namespace]
      if (published.get(module.namespace) === registration) {
        published.delete(module.namespace)
        handler.unregister(module.namespace)
      }
    }
    const registration: SettingsRegistration<N, S> = {
      namespace: module.namespace,
      get service() { return instance as S },
      dispose() { release() },
    }
    // Install the release effect first: an inactive owner then fails before
    // this module allocates anything of its own.
    owner.effect(() => release, `dsh-fft-settings: namespace ${module.namespace}`)
    const created = module.create(owner)
    instance = created.service
    assertSettingsRpcModule({ namespace: module.namespace, rpcMethods: created.rpcMethods })
    handler.register({ namespace: module.namespace, rpcMethods: created.rpcMethods })
    Object.defineProperty(target, module.namespace, { value: created.service, enumerable: true, writable: true, configurable: true })
    published.set(module.namespace, registration as SettingsRegistration<string, unknown>)
    committed = true
    return registration
  }

  const registry: FtshareSettingsModuleRegistry = { register, namespaces: () => [...published.keys()] }
  target.modules = registry
  return { service: target as unknown as FtshareSettingsService, handler }
}
