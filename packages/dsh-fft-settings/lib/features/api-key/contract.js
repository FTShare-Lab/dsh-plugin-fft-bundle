/**
 * API Key namespace contract: the credential reference and lifecycle events,
 * the status/validation vocabulary, and the two faces the namespace exposes
 * (the browser-safe subset and the host-only superset).
 *
 * It merges its own line into the generic {@link FtshareSettingsNamespaces}
 * merge point, so `ctx.ftshareSettings.apiKey` keeps its existing type for
 * every consumer.
 */
export const FTSHARE_API_KEY_REF = 'FTSHARE_API_KEY';
export const FTSHARE_CREDENTIAL_EVENTS = ['credentials/reference-updated'];
export const API_KEY_METHODS = ['describe', 'set', 'clear', 'configureAndTest', 'testConnection', 'getValidationStatus'];
/** Local syntax validation, never an assertion of upstream validity. */
export function normalizeApiKey(input) {
    const value = input.trim();
    if (!value)
        throw new Error('请输入 API Key');
    if (value.length > 512 || /[\x00-\x1f\x7f]/.test(value))
        throw new Error('API Key 长度不能超过 512 个字符，且不能包含控制字符');
    return value;
}
export function untested(status = 'not_tested', message = '尚未测试') {
    return { status, remote: { status: 'not_run', message }, apiKey: { status: 'not_run', message } };
}
