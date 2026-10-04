/** Compatibility exports for the existing /client-api entry point. */
export * from './rpc-core.js'
export { createSettingsTransport } from './client-transport.js'
export { createApiKeyClient } from './modules/api-key/client-api.js'
export { createApiKeyRpcHandler } from './modules/api-key/rpc.js'
