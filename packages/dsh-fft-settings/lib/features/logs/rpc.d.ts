/**
 * `logs` 命名空间的 RPC 方法：只暴露显式登记的三个只读方法，沿用严格 payload 校验。
 */
import { type LogsSettings } from './contract.js';
import type { SettingsRpcMethods } from '../../core/rpc-core.js';
export declare function createLogsRpcMethods(service: LogsSettings): SettingsRpcMethods;
