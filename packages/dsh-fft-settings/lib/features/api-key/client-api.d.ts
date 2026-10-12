import type { ApiKeyPublicApi } from './contract.js';
import { type ClientTransport } from '../../core/rpc-core.js';
/** Browser adapter deliberately has no resolve/createEnvironment method. */
export declare function createApiKeyClient(transport: ClientTransport): ApiKeyPublicApi;
