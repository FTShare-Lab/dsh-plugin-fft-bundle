const fail = (code, message) => ({ ok: false, error: { code, message, details: {} } });
export function assertSettingsName(name) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || ['apiVersion', 'constructor', 'prototype', '__proto__'].includes(name))
        throw new Error(`Invalid settings name: ${name}`);
}
/** Only explicitly registered methods are callable; never reflects over a service. */
export function createSettingsRpcHandler(modules) {
    const routes = new Map();
    const namespaces = new Set();
    for (const module of modules) {
        assertSettingsName(module.namespace);
        if (namespaces.has(module.namespace))
            throw new Error(`Duplicate settings namespace: ${module.namespace}`);
        namespaces.add(module.namespace);
        for (const [name, method] of Object.entries(module.rpcMethods)) {
            assertSettingsName(name);
            routes.set(`${module.namespace}/${name}`, method);
        }
    }
    return async (endpoint, payload, signal) => {
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
    };
}
export async function callSettingsRpc(transport, namespace, method, payload = {}) {
    const result = await transport.call(`${namespace}/${method}`, payload);
    if (!result.ok)
        throw new Error('FTShare 设置操作失败，请重试');
    return result.value;
}
