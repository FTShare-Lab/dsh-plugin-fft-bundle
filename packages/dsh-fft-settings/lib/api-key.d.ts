import { type ApiKeySettings, type CredentialStatus, type ValidationResult } from './contract.js';
export interface CredentialStore {
    resolve(): Promise<string | undefined>;
    describe(): Promise<CredentialStatus>;
    set(value: string): Promise<void>;
    clear(): Promise<void>;
}
export type Validator = (key: string | undefined, signal: AbortSignal) => Promise<ValidationResult>;
/** One Host instance owns validation state; the DSH provider owns all secrets. */
export declare function createApiKeySettings(store: CredentialStore, validator?: Validator): {
    api: ApiKeySettings;
    invalidate: () => void;
    dispose(): void;
};
