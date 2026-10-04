import type { Context } from '@deepseek-ai/cordis'
import { FTSHARE_SETTINGS_API_VERSION } from './contract.js'
import { assertSettingsName, createSettingsRpcHandler, type SettingsRpcMethods } from './rpc-core.js'
export interface SettingsModule<N extends string = string, S = unknown> {
  readonly namespace: N
  readonly inject: readonly string[]
  /** Register lifecycle cleanup through ctx.effect/on; never return browser secrets as RPC methods. */
  create(ctx: Context): { service: S; rpcMethods: SettingsRpcMethods }
}
export function defineSettingsModule<const N extends string, S>(module: SettingsModule<N, S>): SettingsModule<N, S> { return module }
export type SettingsServices<M extends readonly SettingsModule[]> = {
  readonly [Entry in M[number] as Entry['namespace']]: ReturnType<Entry['create']>['service']
}
export function assembleSettings<const M extends readonly SettingsModule[]>(ctx: Context, modules: M) {
  const seen = new Set<string>()
  // Reject configuration errors before creating any module resources.
  for (const module of modules) {
    assertSettingsName(module.namespace)
    if (seen.has(module.namespace)) throw new Error(`Duplicate settings namespace: ${module.namespace}`)
    seen.add(module.namespace)
  }
  const instances = modules.map(module => ({ namespace: module.namespace, ...module.create(ctx) }))
  const service = Object.assign({ apiVersion: FTSHARE_SETTINGS_API_VERSION }, Object.fromEntries(instances.map(item => [item.namespace, item.service]))) as { readonly apiVersion: typeof FTSHARE_SETTINGS_API_VERSION } & SettingsServices<M>
  return { service, handler: createSettingsRpcHandler(instances) }
}
