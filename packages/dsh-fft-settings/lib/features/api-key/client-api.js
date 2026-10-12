import { callSettingsRpc } from '../../core/rpc-core.js';
/** Browser adapter deliberately has no resolve/createEnvironment method. */
export function createApiKeyClient(transport) {
    async function call(method, payload = {}) {
        return callSettingsRpc(transport, 'apiKey', method, payload);
    }
    return {
        describe: () => call('describe'), set: value => call('set', { value }), clear: () => call('clear'),
        configureAndTest: value => call('configureAndTest', { value }), testConnection: () => call('testConnection'), getValidationStatus: () => call('getValidationStatus'),
    };
}
