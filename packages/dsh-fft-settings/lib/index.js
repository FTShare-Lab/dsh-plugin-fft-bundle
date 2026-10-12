import { createSettingsHost } from './core/module-registry.js';
import { apiKeyModule } from './features/api-key/index.js';
import { createSettingsRoute } from './core/transport.js';
export * from './contract.js';
export { defineSettingsModule } from './core/module-registry.js';
export const name = '@ft/dsh-fft-settings';
/**
 * Host services this plugin's own built-in modules resolve at registration.
 * A consuming plugin declares its own requirement; settings never declares
 * services on a module's behalf.
 */
export const inject = ['credentials'];
export const provide = ['ftshareSettings'];
export function apply(ctx) {
    const { service, handler } = createSettingsHost();
    ctx.provide('ftshareSettings', service);
    // Built-in namespaces take the same path a third-party module would take.
    service.modules.register(apiKeyModule, ctx);
    ctx.inject(['connection'], scoped => {
        const connection = scoped.get('connection');
        scoped.effect(() => connection.fetch.register(createSettingsRoute({ handler })), 'dsh-fft-settings: /api route');
    });
}
