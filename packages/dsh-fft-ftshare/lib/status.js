/**
 * 失败现场与目录漂移的进程内聚合（`ftshare_status` 的数据源）。
 *
 * 为什么在内存里：日志是给导出用的长文本，模型问「为什么取不到」时没有便宜的读法；
 * 一个按指纹聚合的环形账本能把「同一个 429 打了几千次、首次/末次是什么、原文是什么」
 * 一次答完。它只记事实，不做归因，也不主动联网。
 * @module @dsh-ft/dsh-fft-ftshare/status
 */
import { loadCatalog } from './catalog-host.js';
import { hashText } from './errors.js';
/** 最多保留的失败指纹数；超出按最后出现时间淘汰。 */
const MAX_FAILURES = 50;
/** 存进账本的原文上限；完整原文在日志与当次工具结果里。 */
const MESSAGE_MAX = 500;
/** 按字段名排序的稳定序列化，用于目录哈希。 */
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(item => stableStringify(item)).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const record = value;
        const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}
/** 一条目录/清单条目的规范化文本；两侧用同一个形状才能直接比哈希。 */
function canonicalLine(entry) {
    return stableStringify({
        name: entry.name,
        title: entry.title,
        description: entry.description ?? '',
        inputSchema: entry.inputSchema ?? null,
    });
}
/** 随包目录的条目数与哈希（懒算一次）。 */
let shippedCatalog;
/**
 * 随包目录的规范化摘要。
 * @returns 条目数与哈希。
 */
export function shippedCatalogSummary() {
    if (shippedCatalog !== undefined)
        return shippedCatalog;
    const entries = loadCatalog().entries;
    const hash = hashText(entries.map(entry => canonicalLine(entry)).sort().join('\n'));
    shippedCatalog = { count: entries.length, hash };
    return shippedCatalog;
}
/** 随包目录的初始观测（还没拉上游清单）。 */
function shippedObservation() {
    const shipped = shippedCatalogSummary();
    return { shippedCount: shipped.count, shippedHash: shipped.hash };
}
/**
 * 造一个失败账本。
 * @returns 空账本。
 */
export function createFailureStore() {
    const failures = new Map();
    const since = new Date().toISOString();
    let total = 0;
    let catalog = shippedObservation();
    const evict = () => {
        if (failures.size <= MAX_FAILURES)
            return;
        const oldest = [...failures.values()].sort((left, right) => left.lastAt.localeCompare(right.lastAt))[0];
        if (oldest !== undefined)
            failures.delete(oldest.fingerprint);
    };
    return {
        recordFailure(input) {
            const at = (input.at ?? new Date()).toISOString();
            const existing = failures.get(input.fingerprint);
            total += 1;
            if (existing === undefined) {
                const record = {
                    fingerprint: input.fingerprint,
                    tool: input.tool,
                    state: input.state,
                    ...input.code !== undefined ? { code: input.code } : {},
                    ...input.status !== undefined ? { status: input.status } : {},
                    message: input.message.slice(0, MESSAGE_MAX),
                    count: 1,
                    firstAt: at,
                    lastAt: at,
                    lastDurationMs: input.durationMs,
                };
                failures.set(input.fingerprint, record);
                evict();
                return { record: { ...record }, isNew: true };
            }
            existing.tool = input.tool;
            existing.state = input.state;
            existing.code = input.code;
            existing.status = input.status;
            existing.message = input.message.slice(0, MESSAGE_MAX);
            existing.count += 1;
            existing.lastAt = at;
            existing.lastDurationMs = input.durationMs;
            return { record: { ...existing }, isNew: false };
        },
        recordCatalog(live) {
            const hash = hashText(live.map(tool => canonicalLine({
                name: tool.tool,
                title: tool.title,
                ...tool.description !== undefined ? { description: tool.description } : {},
                ...tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {},
            })).sort().join('\n'));
            catalog = {
                ...shippedObservation(),
                liveCount: live.length,
                liveHash: hash,
                changed: hash !== catalog.shippedHash,
                checkedAt: new Date().toISOString(),
            };
        },
        snapshot() {
            return {
                failures: [...failures.values()].sort((left, right) => right.count - left.count).map(record => ({ ...record })),
                catalog: { ...catalog },
                totalFailures: total,
                since,
            };
        },
        clear() {
            failures.clear();
            total = 0;
            catalog = shippedObservation();
        },
    };
}
/** 进程级账本：服务写、`ftshare_status` 读。 */
export const statusStore = createFailureStore();
//# sourceMappingURL=status.js.map