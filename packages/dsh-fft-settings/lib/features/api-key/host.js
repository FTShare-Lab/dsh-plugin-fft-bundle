import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { FTSHARE_API_KEY_REF, FTSHARE_CREDENTIAL_EVENTS } from './contract.js';
import { createApiKeySettings } from './service.js';
import { defineSettingsModule } from '../../core/module-registry.js';
import { createApiKeyRpcMethods } from './rpc.js';
export const apiKeyModule = defineSettingsModule({
    namespace: 'apiKey', inject: ['credentials'],
    create(ctx) {
        const ref = credentialRef(FTSHARE_API_KEY_REF);
        const owner = createApiKeySettings({
            resolve: async () => (await ctx.credentials.resolve(ref))?.value,
            describe: () => ctx.credentials.describe(ref),
            set: value => ctx.credentials.set(ref, value),
            clear: () => ctx.credentials.unset(ref),
        });
        for (const event of FTSHARE_CREDENTIAL_EVENTS)
            ctx.on(event, changed => { if (changed === ref)
                owner.invalidate(); });
        ctx.effect(() => () => owner.dispose(), 'ftshare-settings: API key lifecycle');
        return { service: owner.api, rpcMethods: createApiKeyRpcMethods(owner.api) };
    },
});
