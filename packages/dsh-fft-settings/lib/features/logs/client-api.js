import { LOGS_DEFAULT_PREVIEW_LINES, } from './contract.js';
import { callSettingsRpc } from '../../core/rpc-core.js';
/** 浏览器适配器：只读，且不暴露本地路径以外的任何 Host 能力（刷盘与释放句柄）。 */
export function createLogsClient(transport) {
    const call = (method, payload = {}) => callSettingsRpc(transport, 'logs', method, payload);
    return {
        stats: () => call('stats'),
        preview: (lines = LOGS_DEFAULT_PREVIEW_LINES) => call('preview', { lines }),
        export: () => call('export'),
    };
}
