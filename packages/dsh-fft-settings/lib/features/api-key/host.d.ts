import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
import { type ApiKeySettings } from './contract.js';
import type { FeatureLogger } from './logging.js';
declare module '@deepseek-ai/cordis' {
    interface Events {
        'credentials/reference-updated'(ref: CredentialRef): void;
    }
}
/**
 * Build the `apiKey` module, closing over the plugin's named logger.
 *
 * 工厂化与 `createLogsModule` 一致：插件入口在 `apply` 里取一次 `ctx.logger()`
 * （无参 = 插件名）再传进来，因此 feature 不依赖模块级单例，也不认识 cordis。
 * @param logger - 可选具名 logger；省略时本模块不写任何日志（既有调用方不变）。
 * @returns 可交给 `ctx.ftshareSettings.modules.register` 的模块。
 */
export declare function createApiKeyModule(logger?: FeatureLogger): import("../../core/module-registry.js").SettingsModule<"apiKey", ApiKeySettings>;
