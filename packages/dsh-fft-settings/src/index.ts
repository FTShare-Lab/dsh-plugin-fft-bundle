import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { type FtshareSettingsService } from './contract.js'
import { createSettingsHost } from './core/module-registry.js'
import { apiKeyModule } from './features/api-key/index.js'
import { DEFAULT_LOGS_CONFIG, logsConfigSchema, resolveLogsConfig, type LogsConfig } from './features/logs/config.js'
import { createLogsModule } from './features/logs/index.js'
import type { HostFetch } from './core/rpc-core.js'
import { createSettingsRoute } from './core/transport.js'
export * from './contract.js'
export { defineSettingsModule } from './core/module-registry.js'
export const name = '@ft/dsh-fft-settings'
/**
 * Host services this plugin's own built-in modules resolve at registration.
 * A consuming plugin declares its own requirement; settings never declares
 * services on a module's behalf.
 */
export const inject = ['credentials']
export const provide = ['ftshareSettings']
/** Plugin config, assembled from each feature's own slice schema. */
export interface FtshareSettingsConfig { logs: LogsConfig }
/**
 * Native Schemastery schema of the whole plugin config: the features own their
 * slices, this entry only composes them. DSH's config collector accepts
 * nothing but a native Schemastery schema.
 */
export const Config = z.object({ logs: logsConfigSchema })
export { DEFAULT_LOGS_CONFIG }
export type { LogsConfig }
declare module '@deepseek-ai/cordis' {
  interface Context { ftshareSettings: FtshareSettingsService }
}
/**
 * @param config - validated plugin config. Each built-in module is registered
 * eagerly, so the log collector starts here, unconditionally, instead of
 * waiting for a settings-page render.
 *
 * The parameter default is deliberately **not** relied on: with no config row
 * cordis passes `{}` (not `undefined`), and `{}` does not trigger a default
 * parameter — so the fallback parse happens in the body and every feature
 * slice is always defined.
 */
export function apply(ctx: Context, config?: FtshareSettingsConfig): void {
  const { service, handler } = createSettingsHost()
  ctx.provide('ftshareSettings', service)
  // Built-in namespaces take the same path a third-party module would take.
  service.modules.register(apiKeyModule, ctx)
  service.modules.register(createLogsModule(resolveLogsConfig(config)), ctx)
  ctx.inject(['connection'], scoped => {
    const connection = scoped.get('connection') as { fetch: HostFetch }
    scoped.effect(() => connection.fetch.register(createSettingsRoute({ handler })), 'dsh-fft-settings: /api route')
  })
}
