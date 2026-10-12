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
export async function callSettingsRpc(transport, namespace, method, payload = {}) {
    const result = await transport.call(`${namespace}/${method}`, payload);
    if (!result.ok)
        throw new Error('FTShare 设置操作失败，请重试');
    return result.value;
}
