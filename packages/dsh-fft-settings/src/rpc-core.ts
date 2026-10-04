import type { FTSHARE_SETTINGS_ROUTE } from './contract.js'
export interface RpcResult<T> { ok: boolean; value?: T; error?: { code: string; message: string; details: Record<string, unknown> } }
/** Browser caller for this plugin's route. */
export interface ClientTransport { call(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>> }
export type RpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>
/** Structural shape of one exact Fetch route; `connection.fetch.register` accepts it. */
export interface SettingsRoute {
  readonly path: typeof FTSHARE_SETTINGS_ROUTE
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}
/** Host registry for exact Fetch routes on the shared `/api` carrier. */
export interface HostFetch { register(route: SettingsRoute): () => Promise<void> }
export interface SettingsRpcMethod {
  validate(payload: unknown): boolean
  invoke(payload: unknown, signal: AbortSignal): unknown | Promise<unknown>
}
export type SettingsRpcMethods = Readonly<Record<string, SettingsRpcMethod>>
export interface SettingsRpcModule { namespace: string; rpcMethods: SettingsRpcMethods }
const fail = (code: string, message: string): RpcResult<unknown> => ({ ok: false, error: { code, message, details: {} } })
export function assertSettingsName(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || ['apiVersion', 'constructor', 'prototype', '__proto__'].includes(name)) throw new Error(`Invalid settings name: ${name}`)
}
/** Only explicitly registered methods are callable; never reflects over a service. */
export function createSettingsRpcHandler(modules: readonly SettingsRpcModule[]): RpcHandler {
  const routes = new Map<string, SettingsRpcMethod>()
  const namespaces = new Set<string>()
  for (const module of modules) {
    assertSettingsName(module.namespace)
    if (namespaces.has(module.namespace)) throw new Error(`Duplicate settings namespace: ${module.namespace}`)
    namespaces.add(module.namespace)
    for (const [name, method] of Object.entries(module.rpcMethods)) {
      assertSettingsName(name)
      routes.set(`${module.namespace}/${name}`, method)
    }
  }
  return async (endpoint, payload, signal) => {
    const method = routes.get(endpoint)
    if (!method) return fail('not_found', '接口不存在')
    if (signal.aborted) return fail('cancelled', '请求已取消')
    try {
      if (!method.validate(payload)) return fail('bad_request', '请求参数不正确')
      return { ok: true, value: (await method.invoke(payload, signal)) ?? null }
    } catch { return fail('operation_failed', '操作失败，请刷新状态后重试') }
  }
}
export async function callSettingsRpc<T>(transport: ClientTransport, namespace: string, method: string, payload: unknown = {}): Promise<T> {
  const result = await transport.call(`${namespace}/${method}`, payload)
  if (!result.ok) throw new Error('FTShare 设置操作失败，请重试')
  return result.value as T
}
