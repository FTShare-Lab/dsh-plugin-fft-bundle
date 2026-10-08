/** Browser-safe contract. Theme and preferences can become sibling namespaces. */
export const FTSHARE_SETTINGS_API_VERSION = 1;
export const FTSHARE_API_KEY_REF = 'FTSHARE_API_KEY';
/**
 * Identity of the settings section that carries this plugin's cards.
 *
 * The id replaces the old `ftshare`; the label is also the brand shown next to
 * the desktop version, while the shell's own `productName` stays `DSH FFT`
 * (spec B.5 Q6 leaves that rename out of scope).
 */
export const FTSHARE_SETTINGS_SECTION = { id: 'dsh-fft', order: 120, label: '非凸金融终端' };
export const FTSHARE_CREDENTIAL_EVENTS = ['credentials/reference-updated'];
/**
 * Browser-facing route for this plugin's settings calls.
 *
 * It sits below `/api` so the shared connection carrier applies the Host/Origin
 * fence and browser authentication before dispatch; this plugin only handles
 * the call itself.
 */
export const FTSHARE_SETTINGS_ROUTE = '/api/ftshare-settings';
/** Largest request body accepted on {@link FTSHARE_SETTINGS_ROUTE}. */
export const FTSHARE_SETTINGS_MAX_BODY_BYTES = 64 * 1024;
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
