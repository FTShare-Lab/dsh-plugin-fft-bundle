import {
  LOGS_DEFAULT_PREVIEW_LINES,
  type LogsExport,
  type LogsMethod,
  type LogsPreview,
  type LogsPublicApi,
  type LogsStats,
} from './contract.js'
import { callSettingsRpc, type ClientTransport } from '../../core/rpc-core.js'

/** 浏览器适配器：只读，且不暴露本地路径以外的任何 Host 能力（刷盘与释放句柄）。 */
export function createLogsClient(transport: ClientTransport): LogsPublicApi {
  const call = <T>(method: LogsMethod, payload: unknown = {}): Promise<T> =>
    callSettingsRpc<T>(transport, 'logs', method, payload)
  return {
    stats: () => call<LogsStats>('stats'),
    preview: (lines = LOGS_DEFAULT_PREVIEW_LINES) => call<LogsPreview>('preview', { lines }),
    export: () => call<LogsExport>('export'),
  }
}
