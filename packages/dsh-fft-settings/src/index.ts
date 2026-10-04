import type { Context } from '@deepseek-ai/cordis'
import { type FtshareSettingsService } from './contract.js'
import { assembleSettings } from './module-registry.js'
import { settingsModules } from './modules.js'
import type { HostFetch } from './rpc-core.js'
import { createSettingsRoute } from './transport.js'
export * from './contract.js'
export const name = '@ft/dsh-fft-settings'
export const inject = [...new Set(settingsModules.flatMap(module => [...module.inject]))]
export const provide = ['ftshareSettings']
declare module '@deepseek-ai/cordis' {
  interface Context { ftshareSettings: FtshareSettingsService }
}
export function apply(ctx: Context): void {
  const { service, handler } = assembleSettings(ctx, settingsModules)
  ctx.provide('ftshareSettings', service)
  ctx.inject(['connection'], scoped => {
    const connection = scoped.get('connection') as { fetch: HostFetch }
    scoped.effect(() => connection.fetch.register(createSettingsRoute({ handler })), 'dsh-fft-settings: /api route')
  })
}
