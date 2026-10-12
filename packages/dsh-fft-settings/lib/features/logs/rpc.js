/**
 * `logs` 命名空间的 RPC 方法：只暴露显式登记的三个只读方法，沿用严格 payload 校验。
 */
import { LOGS_DEFAULT_PREVIEW_LINES, LOGS_MAX_PREVIEW_LINES } from './contract.js';
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const empty = (value) => record(value) && Object.keys(value).length === 0;
/** 只允许 `{ lines?: number }`，且值必须落在预览上限内。 */
const previewPayload = (value) => {
    if (!record(value))
        return false;
    const keys = Object.keys(value);
    if (keys.some(key => key !== 'lines'))
        return false;
    if (value.lines === undefined)
        return true;
    return typeof value.lines === 'number' && Number.isInteger(value.lines) && value.lines >= 1 && value.lines <= LOGS_MAX_PREVIEW_LINES;
};
export function createLogsRpcMethods(service) {
    return {
        stats: { validate: empty, invoke: () => service.stats() },
        preview: {
            validate: previewPayload,
            invoke: payload => service.preview(payload.lines ?? LOGS_DEFAULT_PREVIEW_LINES),
        },
        export: { validate: empty, invoke: () => service.export() },
    };
}
