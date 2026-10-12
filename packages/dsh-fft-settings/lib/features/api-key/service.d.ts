import { type ApiKeySettings, type CredentialStatus, type ValidationResult } from './contract.js';
import type { FeatureLogger } from './logging.js';
export interface CredentialStore {
    resolve(): Promise<string | undefined>;
    describe(): Promise<CredentialStatus>;
    set(value: string): Promise<void>;
    clear(): Promise<void>;
}
export type Validator = (key: string | undefined, signal: AbortSignal) => Promise<ValidationResult>;
/**
 * One Host instance owns validation state; the DSH provider owns all secrets.
 *
 * `logger` is optional so a directly constructed instance (tests, embeddings)
 * stays silent: the plugin entry passes `ctx.logger()` in through
 * `createApiKeyModule`. Fields never carry the Key or any token value.
 */
export declare function createApiKeySettings(store: CredentialStore, validator?: Validator, logger?: FeatureLogger): {
    api: ApiKeySettings;
    invalidate: () => void;
    dispose(): void;
};
