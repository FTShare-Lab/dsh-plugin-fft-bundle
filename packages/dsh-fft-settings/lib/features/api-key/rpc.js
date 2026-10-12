import { createSettingsRpcHandler } from '../../core/rpc-core.js';
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const empty = (value) => record(value) && Object.keys(value).length === 0;
const keyValue = (value) => record(value) && Object.keys(value).length === 1 && Object.keys(value)[0] === 'value' && typeof value.value === 'string' && value.value.length <= 1024;
export function createApiKeyRpcMethods(api) {
    return {
        describe: { validate: empty, invoke: () => api.describe() },
        set: { validate: keyValue, invoke: payload => api.set(payload.value) },
        clear: { validate: empty, invoke: () => api.clear() },
        configureAndTest: { validate: keyValue, invoke: payload => api.configureAndTest(payload.value) },
        testConnection: { validate: empty, invoke: () => api.testConnection() },
        getValidationStatus: { validate: empty, invoke: () => api.getValidationStatus() },
    };
}
export function createApiKeyRpcHandler(api) {
    return createSettingsRpcHandler([{ namespace: 'apiKey', rpcMethods: createApiKeyRpcMethods(api) }]);
}
