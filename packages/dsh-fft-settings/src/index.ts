import type { Context } from '@deepseek-ai/cordis'
import { type FtshareSettingsService } from './contract.js'
import { createSettingsHost } from './module-registry.js'
import { settingsModules } from './modules.js'
import type { HostFetch } from './rpc-core.js'
import { createSettingsRoute } from './transport.js'
export * from './contract.js'
export { defineSettingsModule } from './module-registry.js'
export const name = '@ft/dsh-fft-settings'
/**
 * Host services this plugin's own built-in modules resolve at registration.
 * A consuming plugin declares its own requirement; settings never declares
 * services on a module's behalf.
 */
export const inject = ['credentials']
export const provide = ['ftshareSettings']
declare module '@deepseek-ai/cordis' {
  interface Context { ftshareSettings: FtshareSettingsService }
}
export function apply(ctx: Context): void {
  const { service, handler } = createSettingsHost()
  ctx.provide('ftshareSettings', service)
  // Built-in namespaces take the same path as a third-party module would.
  for (const module of settingsModules) service.modules.register(module, ctx)
  ctx.inject(['connection'], scoped => {
    const connection = scoped.get('connection') as { fetch: HostFetch }
    scoped.effect(() => connection.fetch.register(createSettingsRoute({ handler })), 'dsh-fft-settings: /api route')
  })
}
