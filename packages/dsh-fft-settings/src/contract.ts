import type { FtshareSettingsModuleRegistry } from './module-registry.js'
export type { FtshareSettingsModuleRegistry, SettingsModule, SettingsRegistration } from './module-registry.js'
export type { SettingsRpcMethod, SettingsRpcMethods } from './rpc-core.js'
/** Contract of this plugin's settings service. Theme and preferences can become sibling namespaces. */
export const FTSHARE_SETTINGS_API_VERSION = 1 as const
export const FTSHARE_API_KEY_REF = 'FTSHARE_API_KEY' as const
/**
 * Identity of the settings section that carries this plugin's cards.
 *
 * The id replaces the old `ftshare`; the label is the brand this plugin shows
 * for itself, independent of any host application name.
 */
export const FTSHARE_SETTINGS_SECTION = { id: 'dsh-fft', order: 120, label: '非凸金融终端' } as const
/**
 * Child slot of {@link FTSHARE_SETTINGS_SECTION} that carries its cards.
 *
 * The section declares the slot when it registers; every card — ours and a
 * third party's — contributes through it with `id`/`order`/`label`, and
 * `order` (ascending, default 100) decides the card's position.
 */
export const FTSHARE_SETTINGS_CARD_SLOT = 'ftshare.settings.card' as const
export const FTSHARE_CREDENTIAL_EVENTS = ['credentials/reference-updated'] as const
/**
 * Browser-facing route for this plugin's settings calls.
 *
 * It sits below `/api` so the shared connection carrier applies the Host/Origin
 * fence and browser authentication before dispatch; this plugin only handles
 * the call itself.
 */
export const FTSHARE_SETTINGS_ROUTE = '/api/ftshare-settings' as const
/** Largest request body accepted on {@link FTSHARE_SETTINGS_ROUTE}. */
export const FTSHARE_SETTINGS_MAX_BODY_BYTES = 64 * 1024
export const API_KEY_METHODS = ['describe', 'set', 'clear', 'configureAndTest', 'testConnection', 'getValidationStatus'] as const
export type ApiKeyMethod = typeof API_KEY_METHODS[number]
export type SubscribeChanges = (listener: () => void) => () => void
export interface CredentialStatus { configured: boolean; writable: boolean; source?: string }
export type ProbeState = 'available' | 'auth_required' | 'auth_failed' | 'permission_denied' | 'quota_exceeded' | 'rate_limited' | 'network_error' | 'timeout' | 'upstream_error' | 'invalid_response' | 'not_run'
export interface ProbeResult { status: ProbeState; message: string }
export interface ValidationResult {
  status: 'not_tested' | 'not_run' | 'passed' | 'partial' | 'failed' | 'superseded'
  remote: ProbeResult
  apiKey: ProbeResult
  testedAt?: string
}
export interface ApiKeyStatus extends CredentialStatus {
  /** Display only. Fixed mask plus last four characters; never submit as a Key. */
  maskedValue?: string
  revision: number
  validation: ValidationResult
}
export interface ConfigureResult {
  save: { status: 'saved' | 'failed'; code?: 'invalid_input' | 'read_only' | 'save_failed'; message: string }
  validation: ValidationResult
}
/** Local syntax validation, never an assertion of upstream validity. */
export function normalizeApiKey(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('请输入 API Key')
  if (value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('API Key 长度不能超过 512 个字符，且不能包含控制字符')
  return value
}
export function untested(status: 'not_tested' | 'not_run' | 'superseded' = 'not_tested', message = '尚未测试'): ValidationResult {
  return { status, remote: { status: 'not_run', message }, apiKey: { status: 'not_run', message } }
}
export interface ApiKeyPublicApi {
  describe(): Promise<ApiKeyStatus>
  set(value: string): Promise<void>
  clear(): Promise<void>
  configureAndTest(value: string): Promise<ConfigureResult>
  testConnection(): Promise<ValidationResult>
  getValidationStatus(): Promise<ValidationResult>
}
export interface ApiKeySettings extends ApiKeyPublicApi {
  readonly credentialRef: typeof FTSHARE_API_KEY_REF
  /** Host only. Re-resolve per operation; never send this value to browsers. */
  resolve(): Promise<string | undefined>
  createEnvironment(base?: Readonly<Record<string, string | undefined>>): Promise<Record<string, string | undefined>>
  subscribe: SubscribeChanges
}
/**
 * Merge point for namespaces a package reads but does not produce. A producer
 * gets its type from `register` inference; a consumer that reads someone
 * else's namespace declares one line, e.g. `cockpit: CockpitSettings`.
 */
export interface FtshareSettingsNamespaces {
  apiKey: ApiKeySettings
}
/**
 * Host service published as `ctx.ftshareSettings`.
 *
 * `apiVersion` and `modules` are permanent; every other member appears only
 * while its namespace is registered, so consumers must read properties at call
 * time instead of caching them during their own apply.
 */
export type FtshareSettingsService =
  & {
    readonly apiVersion: typeof FTSHARE_SETTINGS_API_VERSION
    readonly modules: FtshareSettingsModuleRegistry
  }
  & { readonly [N in keyof FtshareSettingsNamespaces & string]: FtshareSettingsNamespaces[N] }
