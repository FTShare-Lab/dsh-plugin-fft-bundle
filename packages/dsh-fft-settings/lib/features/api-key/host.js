import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { FTSHARE_API_KEY_REF, FTSHARE_CREDENTIAL_EVENTS } from './contract.js';
import { createApiKeySettings } from './service.js';
import { defineSettingsModule } from '../../core/module-registry.js';
import { createApiKeyRpcMethods } from './rpc.js';
/**
 * Build the `apiKey` module, closing over the plugin's named logger.
 *
 * 工厂化与 `createLogsModule` 一致：插件入口在 `apply` 里取一次 `ctx.logger()`
 * （无参 = 插件名）再传进来，因此 feature 不依赖模块级单例，也不认识 cordis。
 * @param logger - 可选具名 logger；省略时本模块不写任何日志（既有调用方不变）。
 * @returns 可交给 `ctx.ftshareSettings.modules.register` 的模块。
 */
export function createApiKeyModule(logger) {
    return defineSettingsModule({
        namespace: 'apiKey', inject: ['credentials'],
        create(ctx) {
            const ref = credentialRef(FTSHARE_API_KEY_REF);
            const owner = createApiKeySettings({
                resolve: async () => (await ctx.credentials.resolve(ref))?.value,
                describe: () => ctx.credentials.describe(ref),
                set: value => ctx.credentials.set(ref, value),
                clear: () => ctx.credentials.unset(ref),
            }, undefined, logger);
            for (const event of FTSHARE_CREDENTIAL_EVENTS)
                ctx.on(event, changed => { if (changed === ref)
                    owner.invalidate(); });
            ctx.effect(() => () => owner.dispose(), 'ftshare-settings: API key lifecycle');
            return { service: owner.api, rpcMethods: createApiKeyRpcMethods(owner.api) };
        },
    });
}
