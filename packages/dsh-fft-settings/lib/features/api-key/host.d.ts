import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
import { type ApiKeySettings } from './contract.js';
declare module '@deepseek-ai/cordis' {
    interface Events {
        'credentials/reference-updated'(ref: CredentialRef): void;
    }
}
export declare const apiKeyModule: import("../../core/module-registry.js").SettingsModule<"apiKey", ApiKeySettings>;
