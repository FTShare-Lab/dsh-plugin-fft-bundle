import { FTSHARE_SETTINGS_API_VERSION } from './contract.js';
import { assertSettingsName, createSettingsRpcHandler } from './rpc-core.js';
export function defineSettingsModule(module) { return module; }
export function assembleSettings(ctx, modules) {
    const seen = new Set();
    // Reject configuration errors before creating any module resources.
    for (const module of modules) {
        assertSettingsName(module.namespace);
        if (seen.has(module.namespace))
            throw new Error(`Duplicate settings namespace: ${module.namespace}`);
        seen.add(module.namespace);
    }
    const instances = modules.map(module => ({ namespace: module.namespace, ...module.create(ctx) }));
    const service = Object.assign({ apiVersion: FTSHARE_SETTINGS_API_VERSION }, Object.fromEntries(instances.map(item => [item.namespace, item.service])));
    return { service, handler: createSettingsRpcHandler(instances) };
}
