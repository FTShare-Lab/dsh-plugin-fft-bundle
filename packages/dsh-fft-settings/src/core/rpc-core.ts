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
/**
 * Live dispatch table behind {@link createSettingsRpcHandler}: routes appear
 * when a namespace is registered and disappear when it is released, so the one
 * route mounted at boot keeps serving namespaces that arrive later.
 */
export interface SettingsRpcTable {
  /** Validate one whole module, then publish its routes; a failure writes nothing. */
  register(module: SettingsRpcModule): void
  /** Remove one namespace and every route under it; unknown namespaces are a no-op. */
  unregister(namespace: string): void
  /** Namespaces currently owning at least one route, in registration order. */
  namespaces(): readonly string[]
}
/** The dispatcher callable plus the increment/decrement surface of its route table. */
export type SettingsRpcHandler = RpcHandler & SettingsRpcTable
const fail = (code: string, message: string): RpcResult<unknown> => ({ ok: false, error: { code, message, details: {} } })
/** Names the service object and the route table reserve for themselves. */
export const SETTINGS_RESERVED_NAMES = ['apiVersion', 'modules', 'constructor', 'prototype', '__proto__'] as const
export function assertSettingsName(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || (SETTINGS_RESERVED_NAMES as readonly string[]).includes(name)) throw new Error(`Invalid settings name: ${name}`)
}
/** Validate every endpoint part of one module without writing to any table. */
export function assertSettingsRpcModule(module: SettingsRpcModule): void {
  assertSettingsName(module.namespace)
  for (const name of Object.keys(module.rpcMethods)) assertSettingsName(name)
}
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
export function createSettingsRpcHandler(modules: readonly SettingsRpcModule[] = []): SettingsRpcHandler {
  const routes = new Map<string, SettingsRpcMethod>()
  const namespaces = new Set<string>()
  const register = (module: SettingsRpcModule): void => {
    assertSettingsRpcModule(module)
    if (namespaces.has(module.namespace)) throw new Error(`Duplicate settings namespace: ${module.namespace}`)
    // Committed: every check above ran before the first write.
    namespaces.add(module.namespace)
    for (const [name, method] of Object.entries(module.rpcMethods)) routes.set(`${module.namespace}/${name}`, method)
  }
  const unregister = (namespace: string): void => {
    if (!namespaces.delete(namespace)) return
    const prefix = `${namespace}/`
    for (const endpoint of [...routes.keys()]) if (endpoint.startsWith(prefix)) routes.delete(endpoint)
  }
  const handler = (async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    const method = routes.get(endpoint)
    if (!method) return fail('not_found', '接口不存在')
    if (signal.aborted) return fail('cancelled', '请求已取消')
    try {
      if (!method.validate(payload)) return fail('bad_request', '请求参数不正确')
      return { ok: true, value: (await method.invoke(payload, signal)) ?? null }
    } catch { return fail('operation_failed', '操作失败，请刷新状态后重试') }
  }) as SettingsRpcHandler
  handler.register = register
  handler.unregister = unregister
  handler.namespaces = () => [...namespaces]
  for (const module of modules) register(module)
  return handler
}
export async function callSettingsRpc<T>(transport: ClientTransport, namespace: string, method: string, payload: unknown = {}): Promise<T> {
  const result = await transport.call(`${namespace}/${method}`, payload)
  if (!result.ok) throw new Error('FTShare 设置操作失败，请重试')
  return result.value as T
}
