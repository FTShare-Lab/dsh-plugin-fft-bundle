import { type LogsPublicApi } from './contract.js';
import { type ClientTransport } from '../../core/rpc-core.js';
/** 浏览器适配器：只读，且不暴露本地路径以外的任何 Host 能力（刷盘与释放句柄）。 */
export declare function createLogsClient(transport: ClientTransport): LogsPublicApi;
