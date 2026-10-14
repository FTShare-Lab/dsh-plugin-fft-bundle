import z from '@deepseek-ai/schemastery';
import { createSettingsHost } from './core/module-registry.js';
import { createApiKeyModule } from './features/api-key/index.js';
import { DEFAULT_LOGS_CONFIG, logsConfigSchema, resolveLogsConfig } from './features/logs/config.js';
import { createLogsModule } from './features/logs/index.js';
import { createSettingsRoute } from './core/transport.js';
import { installDefaultPresetOnce } from './default-preset.js';
export * from './contract.js';
export { defineSettingsModule } from './core/module-registry.js';
export const name = '@ft/dsh-fft-settings';
/**
 * Host services this plugin's own built-in modules resolve at registration.
 * A consuming plugin declares its own requirement; settings never declares
 * services on a module's behalf. The FT prompt contract lives in the `./agent`
 * entry, which only an agent preset mounts.
 */
export const inject = ['credentials'];
export const provide = ['ftshareSettings'];
/**
 * Native Schemastery schema of the whole plugin config: the features own their
 * slices, this entry only composes them. DSH's config collector accepts
 * nothing but a native Schemastery schema.
 */
export const Config = z.object({ logs: logsConfigSchema });
export { DEFAULT_LOGS_CONFIG };
/**
 * @param config - validated plugin config. Each built-in module is registered
 * eagerly, so the log collector starts here, unconditionally, instead of
 * waiting for a settings-page render.
 *
 * The parameter default is deliberately **not** relied on: cordis validates the
 * raw row through {@link Config} before this call, and a direct `apply(ctx)`
 * call (tests, hand-built contexts) never triggers one — so the fallback parse
 * happens in the body and every feature slice is always defined.
 */
export function apply(ctx, config) {
    const { service, handler } = createSettingsHost();
    ctx.provide('ftshareSettings', service);
    // 具名 logger：`ctx.logger()` 无参调用时 logger name = 插件名（cordis 既有语义），
    // 采集器据此把「是哪个包打的」自动带上。feature 不接受模块级单例。
    const logger = ctx.logger();
    // Built-in namespaces take the same path a third-party module would take.
    service.modules.register(createApiKeyModule(logger), ctx);
    service.modules.register(createLogsModule(resolveLogsConfig(config)), ctx);
    installDefaultPresetOnce(ctx);
    ctx.inject(['connection'], scoped => {
        const connection = scoped.get('connection');
        scoped.effect(() => connection.fetch.register(createSettingsRoute({ handler })), 'dsh-fft-settings: /api route');
    });
}
