/**
 * Host half of the API Key feature: the entry a host assembly imports.
 *
 * The directory is written to be liftable into its own package (§10.4): this
 * file is the host entry, `./contract.js` its contract, and `./card.js` the
 * browser entry that browser code imports directly instead of going through
 * here (a browser half must never pull credential or probe code).
 */
export * from './contract.js'
export { apiKeyModule } from './host.js'
export { createApiKeySettings, type CredentialStore, type Validator } from './service.js'
export { createApiKeyRpcMethods, createApiKeyRpcHandler } from './rpc.js'
