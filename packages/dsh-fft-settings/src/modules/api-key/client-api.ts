import type { ApiKeyPublicApi, ApiKeyMethod } from '../../contract.js'
import { callSettingsRpc, type ClientTransport } from '../../rpc-core.js'
/** Browser adapter deliberately has no resolve/createEnvironment method. */
export function createApiKeyClient(transport: ClientTransport): ApiKeyPublicApi {
  async function call<T>(method: ApiKeyMethod, payload: unknown = {}): Promise<T> {
    return callSettingsRpc<T>(transport, 'apiKey', method, payload)
  }
  return {
    describe: () => call('describe'), set: value => call('set', { value }), clear: () => call('clear'),
    configureAndTest: value => call('configureAndTest', { value }), testConnection: () => call('testConnection'), getValidationStatus: () => call('getValidationStatus'),
  }
}
