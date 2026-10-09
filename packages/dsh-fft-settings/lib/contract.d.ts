import type { SettingsServices } from './module-registry.js';
import type { settingsModules } from './modules.js';
/** Browser-safe contract. Theme and preferences can become sibling namespaces. */
export declare const FTSHARE_SETTINGS_API_VERSION: 1;
export declare const FTSHARE_API_KEY_REF: "FTSHARE_API_KEY";
/**
 * Identity of the settings section that carries this plugin's cards.
 *
 * The id replaces the old `ftshare`; the label is the brand this plugin shows
 * for itself, independent of any host application name.
 */
export declare const FTSHARE_SETTINGS_SECTION: {
    readonly id: "dsh-fft";
    readonly order: 120;
    readonly label: "非凸金融终端";
};
export declare const FTSHARE_CREDENTIAL_EVENTS: readonly ["credentials/reference-updated"];
/**
 * Browser-facing route for this plugin's settings calls.
 *
 * It sits below `/api` so the shared connection carrier applies the Host/Origin
 * fence and browser authentication before dispatch; this plugin only handles
 * the call itself.
 */
export declare const FTSHARE_SETTINGS_ROUTE: "/api/ftshare-settings";
/** Largest request body accepted on {@link FTSHARE_SETTINGS_ROUTE}. */
export declare const FTSHARE_SETTINGS_MAX_BODY_BYTES: number;
export declare const API_KEY_METHODS: readonly ["describe", "set", "clear", "configureAndTest", "testConnection", "getValidationStatus"];
export type ApiKeyMethod = typeof API_KEY_METHODS[number];
export type SubscribeChanges = (listener: () => void) => () => void;
export interface CredentialStatus {
    configured: boolean;
    writable: boolean;
    source?: string;
}
export type ProbeState = 'available' | 'auth_required' | 'auth_failed' | 'permission_denied' | 'quota_exceeded' | 'rate_limited' | 'network_error' | 'timeout' | 'upstream_error' | 'invalid_response' | 'not_run';
export interface ProbeResult {
    status: ProbeState;
    message: string;
}
export interface ValidationResult {
    status: 'not_tested' | 'not_run' | 'passed' | 'partial' | 'failed' | 'superseded';
    remote: ProbeResult;
    apiKey: ProbeResult;
    testedAt?: string;
}
export interface ApiKeyStatus extends CredentialStatus {
    /** Display only. Fixed mask plus last four characters; never submit as a Key. */
    maskedValue?: string;
    revision: number;
    validation: ValidationResult;
}
export interface ConfigureResult {
    save: {
        status: 'saved' | 'failed';
        code?: 'invalid_input' | 'read_only' | 'save_failed';
        message: string;
    };
    validation: ValidationResult;
}
/** Local syntax validation, never an assertion of upstream validity. */
export declare function normalizeApiKey(input: string): string;
export declare function untested(status?: 'not_tested' | 'not_run' | 'superseded', message?: string): ValidationResult;
export interface ApiKeyPublicApi {
    describe(): Promise<ApiKeyStatus>;
    set(value: string): Promise<void>;
    clear(): Promise<void>;
    configureAndTest(value: string): Promise<ConfigureResult>;
    testConnection(): Promise<ValidationResult>;
    getValidationStatus(): Promise<ValidationResult>;
}
export interface ApiKeySettings extends ApiKeyPublicApi {
    readonly credentialRef: typeof FTSHARE_API_KEY_REF;
    /** Host only. Re-resolve per operation; never send this value to browsers. */
    resolve(): Promise<string | undefined>;
    createEnvironment(base?: Readonly<Record<string, string | undefined>>): Promise<Record<string, string | undefined>>;
    subscribe: SubscribeChanges;
}
export interface FtshareSettingsService extends SettingsServices<typeof settingsModules> {
    readonly apiVersion: typeof FTSHARE_SETTINGS_API_VERSION;
}
