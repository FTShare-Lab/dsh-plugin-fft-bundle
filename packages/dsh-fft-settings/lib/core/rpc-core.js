const fail = (code, message) => ({ ok: false, error: { code, message, details: {} } });
/** Names the service object and the route table reserve for themselves. */
export const SETTINGS_RESERVED_NAMES = ['apiVersion', 'modules', 'constructor', 'prototype', '__proto__'];
export function assertSettingsName(name) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || SETTINGS_RESERVED_NAMES.includes(name))
        throw new Error(`Invalid settings name: ${name}`);
}
/** Validate every endpoint part of one module without writing to any table. */
export function assertSettingsRpcModule(module) {
    assertSettingsName(module.namespace);
    for (const name of Object.keys(module.rpcMethods))
        assertSettingsName(name);
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
export function createSettingsRpcHandler(modules = []) {
    const routes = new Map();
    const namespaces = new Set();
    const register = (module) => {
        assertSettingsRpcModule(module);
        if (namespaces.has(module.namespace))
            throw new Error(`Duplicate settings namespace: ${module.namespace}`);
        // Committed: every check above ran before the first write.
        namespaces.add(module.namespace);
        for (const [name, method] of Object.entries(module.rpcMethods))
            routes.set(`${module.namespace}/${name}`, method);
    };
    const unregister = (namespace) => {
        if (!namespaces.delete(namespace))
            return;
        const prefix = `${namespace}/`;
        for (const endpoint of [...routes.keys()])
            if (endpoint.startsWith(prefix))
                routes.delete(endpoint);
    };
    const handler = (async (endpoint, payload, signal) => {
        const method = routes.get(endpoint);
        if (!method)
            return fail('not_found', '接口不存在');
        if (signal.aborted)
            return fail('cancelled', '请求已取消');
        try {
            if (!method.validate(payload))
                return fail('bad_request', '请求参数不正确');
            return { ok: true, value: (await method.invoke(payload, signal)) ?? null };
        }
        catch {
            return fail('operation_failed', '操作失败，请刷新状态后重试');
        }
    });
    handler.register = register;
    handler.unregister = unregister;
    handler.namespaces = () => [...namespaces];
    for (const module of modules)
        register(module);
    return handler;
}
/**
 * 把一次失败的信封翻译成调用方能展示的原因。
 *
 * `not_found` 是「浏览器半边比宿主半边新」的可观测症状：升级插件后客户端 bundle 由磁盘重新
 * 加载，而宿主进程仍持有旧包，它没有新命名空间。此时重试永远不会成功，必须点名重启宿主。
 * @param endpoint - 这次调用的 `<namespace>/<method>`。
 * @param error - 宿主回传的失败原因，畸形信封下可能缺省。
 * @returns 面向用户的失败描述。
 */
function describeSettingsFailure(endpoint, error) {
    if (error?.code === 'not_found')
        return `FTShare 设置接口 ${endpoint} 不存在：宿主插件还是升级前的版本，重启 DSH 后再试`;
    return `FTShare 设置操作失败（${error?.code ?? 'unknown'}）：${error?.message ?? '宿主未说明原因'}`;
}
export async function callSettingsRpc(transport, namespace, method, payload = {}) {
    const endpoint = `${namespace}/${method}`;
    const result = await transport.call(endpoint, payload);
    if (!result.ok)
        throw new Error(describeSettingsFailure(endpoint, result.error));
    return result.value;
}
