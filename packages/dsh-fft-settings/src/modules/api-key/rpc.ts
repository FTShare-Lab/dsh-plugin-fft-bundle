import type { ApiKeyPublicApi } from '../../contract.js'
import { createSettingsRpcHandler, type SettingsRpcMethods } from '../../rpc-core.js'
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const empty = (value: unknown) => record(value) && Object.keys(value).length === 0
const keyValue = (value: unknown) => record(value) && Object.keys(value).length === 1 && Object.keys(value)[0] === 'value' && typeof value.value === 'string' && value.value.length <= 1024
export function createApiKeyRpcMethods(api: ApiKeyPublicApi): SettingsRpcMethods {
  return {
    describe: { validate: empty, invoke: () => api.describe() },
    set: { validate: keyValue, invoke: payload => api.set((payload as { value: string }).value) },
    clear: { validate: empty, invoke: () => api.clear() },
    configureAndTest: { validate: keyValue, invoke: payload => api.configureAndTest((payload as { value: string }).value) },
    testConnection: { validate: empty, invoke: () => api.testConnection() },
    getValidationStatus: { validate: empty, invoke: () => api.getValidationStatus() },
  }
}
export function createApiKeyRpcHandler(api: ApiKeyPublicApi) {
  return createSettingsRpcHandler([{ namespace: 'apiKey', rpcMethods: createApiKeyRpcMethods(api) }])
}
