import type { ApiKeyPublicApi } from './contract.js';
import { type SettingsRpcMethods } from '../../core/rpc-core.js';
export declare function createApiKeyRpcMethods(api: ApiKeyPublicApi): SettingsRpcMethods;
export declare function createApiKeyRpcHandler(api: ApiKeyPublicApi): import("../../core/rpc-core.js").SettingsRpcHandler;
