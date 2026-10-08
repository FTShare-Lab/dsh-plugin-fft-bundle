import { assembleSettings } from './module-registry.js';
import { settingsModules } from './modules.js';
import { createSettingsRoute } from './transport.js';
export * from './contract.js';
export const name = '@ft/dsh-fft-settings';
export const inject = [...new Set(settingsModules.flatMap(module => [...module.inject]))];
export const provide = ['ftshareSettings'];
export function apply(ctx) {
    const { service, handler } = assembleSettings(ctx, settingsModules);
    ctx.provide('ftshareSettings', service);
    ctx.inject(['connection'], scoped => {
        const connection = scoped.get('connection');
        scoped.effect(() => connection.fetch.register(createSettingsRoute({ handler })), 'dsh-fft-settings: /api route');
    });
}
