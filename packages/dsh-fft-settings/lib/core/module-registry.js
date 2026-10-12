import { FTSHARE_SETTINGS_API_VERSION } from './contract.js';
import { assertSettingsName, assertSettingsRpcModule, createSettingsRpcHandler } from './rpc-core.js';
export function defineSettingsModule(module) { return module; }
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
export function createSettingsHost() {
    const handler = createSettingsRpcHandler();
    /** Namespaces published by this host, in registration order. */
    const published = new Map();
    const target = { apiVersion: FTSHARE_SETTINGS_API_VERSION };
    function register(module, owner) {
        // Validate everything knowable before the first write. `rpcMethods` exists
        // only after `create`, so its endpoint names are checked immediately after,
        // still before this registration publishes anything.
        assertSettingsName(module.namespace);
        if (published.has(module.namespace))
            throw new Error(`Duplicate settings namespace: ${module.namespace}`);
        for (const name of module.inject) {
            if (owner.get(name) === undefined)
                throw new Error(`Missing settings module dependency for ${module.namespace}: ${name}`);
        }
        let released = false;
        let committed = false;
        let instance;
        const release = () => {
            if (released)
                return;
            released = true;
            if (!committed)
                return;
            if (target[module.namespace] === instance)
                delete target[module.namespace];
            if (published.get(module.namespace) === registration) {
                published.delete(module.namespace);
                handler.unregister(module.namespace);
            }
        };
        const registration = {
            namespace: module.namespace,
            get service() { return instance; },
            dispose() { release(); },
        };
        // Install the release effect first: an inactive owner then fails before
        // this module allocates anything of its own.
        owner.effect(() => release, `dsh-fft-settings: namespace ${module.namespace}`);
        const created = module.create(owner);
        instance = created.service;
        assertSettingsRpcModule({ namespace: module.namespace, rpcMethods: created.rpcMethods });
        handler.register({ namespace: module.namespace, rpcMethods: created.rpcMethods });
        Object.defineProperty(target, module.namespace, { value: created.service, enumerable: true, writable: true, configurable: true });
        published.set(module.namespace, registration);
        committed = true;
        return registration;
    }
    const registry = { register, namespaces: () => [...published.keys()] };
    target.modules = registry;
    return { service: target, handler };
}
