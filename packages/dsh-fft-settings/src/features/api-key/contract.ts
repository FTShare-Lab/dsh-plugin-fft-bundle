/**
 * API Key namespace contract: the credential reference and lifecycle events,
 * the status/validation vocabulary, and the two faces the namespace exposes
 * (the browser-safe subset and the host-only superset).
 *
 * It merges its own line into the generic {@link FtshareSettingsNamespaces}
 * merge point, so `ctx.ftshareSettings.apiKey` keeps its existing type for
 * every consumer.
 */
export const FTSHARE_API_KEY_REF = 'FTSHARE_API_KEY' as const
export const FTSHARE_CREDENTIAL_EVENTS = ['credentials/reference-updated'] as const
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
/** Everything the browser adapter may call; `resolve`/`createEnvironment` are not here. */
export interface ApiKeyPublicApi {
  describe(): Promise<ApiKeyStatus>
  set(value: string): Promise<void>
  clear(): Promise<void>
  configureAndTest(value: string): Promise<ConfigureResult>
  testConnection(): Promise<ValidationResult>
  getValidationStatus(): Promise<ValidationResult>
}
/** The host namespace object: the public API plus the secret-bearing host methods. */
export interface ApiKeySettings extends ApiKeyPublicApi {
  readonly credentialRef: typeof FTSHARE_API_KEY_REF
  /** Host only. Re-resolve per operation; never send this value to browsers. */
  resolve(): Promise<string | undefined>
  createEnvironment(base?: Readonly<Record<string, string | undefined>>): Promise<Record<string, string | undefined>>
  subscribe: SubscribeChanges
}
declare module '../../core/contract.js' {
  interface FtshareSettingsNamespaces { apiKey: ApiKeySettings }
}
