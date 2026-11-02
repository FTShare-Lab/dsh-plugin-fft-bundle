/**
 * 宿主平面（**全局**）入口：`provide('ftshareData')`。
 *
 * 为什么这一行必须挂在全局、而不是金融 preset 里：preset 内 `provide` 会直接抛
 * `Preset services require isolate realms`
 * （`@deepseek-ai/dsh-agent-preset-registry` 的 `mount.ts`，`mountPreset` 结尾的
 * `leakedServices` 检查）；而按提示加上 `isolate` 之后，服务会变成 preset 私有
 * 的隔离域，preset 之外的插件再也 `inject` 不到，公用底座就白叫了。所以：
 * **provider 全局，工具与投影钩子在 preset**（见 `./tools`、`./project`）。
 *
 * 载荷判定只有一条硬规则：`empty` 必须**正向证据**——已知数据容器存在且为空数组。
 * 成功信封里既没有行、也没有空容器证据时落 `failed`，绝不冒充「没有数据」（P8 的
 * 病根）；但非空载荷仍保留兜底（单对象/任意数组），避免把能用的接口判死。
 *
 * 凭据一律走 `ctx.ftshareSettings.apiKey.resolve()`，本包不读任何凭据文件。
 * @module @dsh-ft/dsh-fft-ftshare
 */
import { FTSHARE_DATA_SERVICE, } from './contract.js';
import { asText, classifyFailure, fingerprintOf, isRecord, permissionNoticeFromPayload } from './errors.js';
import { statusStore } from './status.js';
import { createFtshareTransport } from './transport.js';
export * from './contract.js';
export { FTSHARE_GATEWAY_ENDPOINT } from './transport.js';
export { statusStore } from './status.js';
/** Cordis 插件名。 */
export const name = '@dsh-ft/dsh-fft-ftshare';
/** 凭据来自设置服务；缺这一项本行挂起等待，属刻意的 fail-loud。 */
export const inject = ['ftshareSettings'];
/** 本行发布的服务名。 */
export const provide = [FTSHARE_DATA_SERVICE];
/**
 * 载荷里当「明细容器」看待的键，按优先级排列。
 *
 * 这个列表只用于**读容器**：非空时仍允许兜底（单对象/任意数组），但「空」必须来自
 * 列表里的容器为空数组——否则无法区分「真的没有」和「形状变了」。
 */
const PAYLOAD_KEYS = ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response'];
/** 只描述调用本身、不含事实的键；判断「是否存在事实」与「是不是一行」时忽略。 */
const ENVELOPE_KEYS = new Set(['ok', 'success', 'cached', 'metadata', 'message', 'error', 'code', 'status', 'request_id', 'permission', 'permissions', 'source']);
/** 载荷递归深度上限，防止异常结构把递归拖深。 */
const MAX_PAYLOAD_DEPTH = 3;
/** 只留下记录元素。 */
function recordsOf(value) {
    return value.filter(isRecord);
}
/**
 * 观测上游载荷：只回答「有没有行」「空有没有证据」「是不是不认识」。
 *
 * 规则：数组本身是行；已知容器里的非空数组/对象是行；任意数组键里的记录是行；
 * 非信封、非容器、非数组的字段让整条记录成为一行；以上都没有时，只有「已知容器
 * 为空数组」才算 `emptyEvidence`，否则是 `unrecognized`。
 * @param value - 上游结构化载荷。
 * @param depth - 当前递归深度（内部用）。
 * @returns 观测结果。
 */
export function observePayload(value, depth = 0) {
    if (Array.isArray(value)) {
        return { rows: recordsOf(value), emptyEvidence: value.length === 0, keys: [], unrecognized: false };
    }
    if (!isRecord(value))
        return { rows: [], emptyEvidence: false, keys: [], unrecognized: true };
    const keys = Object.keys(value);
    if (depth < MAX_PAYLOAD_DEPTH) {
        for (const key of PAYLOAD_KEYS) {
            if (!(key in value))
                continue;
            const child = value[key];
            if (Array.isArray(child)) {
                return { rows: recordsOf(child), emptyEvidence: child.length === 0, keys, unrecognized: false };
            }
            if (isRecord(child)) {
                const nested = observePayload(child, depth + 1);
                if (nested.rows.length > 0 || nested.emptyEvidence)
                    return { ...nested, keys };
            }
        }
    }
    // 非空兜底：任意数组键里的记录，或整条记录当一行（单对象返回值也是数据）。
    for (const [key, candidate] of Object.entries(value)) {
        if (ENVELOPE_KEYS.has(key) || !Array.isArray(candidate))
            continue;
        const rows = recordsOf(candidate);
        if (rows.length > 0)
            return { rows, emptyEvidence: false, keys, unrecognized: false };
    }
    const meaningful = keys.filter(key => !ENVELOPE_KEYS.has(key) && !PAYLOAD_KEYS.includes(key) && !Array.isArray(value[key]));
    if (meaningful.length > 0)
        return { rows: [value], emptyEvidence: false, keys, unrecognized: false };
    return { rows: [], emptyEvidence: false, keys, unrecognized: true };
}
/**
 * 从任意上游载荷里找出明细行（`observePayload` 的兼容薄包装）。
 * @param value - 上游结构化载荷。
 * @returns 明细行；空数组表示没有行（**不**代表 `empty`，见 `observePayload`）。
 */
export function normalizeRows(value) {
    return observePayload(value).rows;
}
/**
 * 未识别载荷的提示：这是本地事实（上游成功了，但我们读不出数据容器），不是上游原文。
 * @param value - 上游结构化载荷。
 * @param keys - 顶层键。
 * @returns 失败提示。
 */
function unrecognizedPayloadNotice(value, keys) {
    const raw = JSON.stringify(value);
    return {
        message: `上游返回成功，但没有可识别的数据容器（顶层键：${keys.join('、') === '' ? '无' : keys.join('、')}）`,
        retryable: false,
        upstream: {
            raw: raw.slice(0, 2048),
            fingerprint: fingerprintOf(undefined, undefined, `unrecognized|${keys.slice().sort().join(',')}`),
        },
    };
}
/**
 * 记一次失败到账本，并按指纹节流日志：首次带原文，之后每 100 次带一次计数。
 *
 * 线上同一个 429 一天能打几千行（日志里 5835/11653 行是同一个指纹），节流的依据是
 * 指纹本身，不是「这条日志重不重复」。
 * @param logger - 具名 logger。
 * @param store - 失败账本。
 * @param tool - 上游接口名。
 * @param state - 结局。
 * @param notice - 提示。
 * @param durationMs - 本次耗时。
 */
function recordFailure(logger, store, tool, state, notice, durationMs) {
    const fingerprint = notice.upstream?.fingerprint ?? fingerprintOf(undefined, notice.code, notice.message);
    const message = notice.upstream?.raw ?? notice.message;
    const { record, isNew } = store.recordFailure({
        fingerprint,
        tool,
        state: state === 'denied' ? 'denied' : 'failed',
        ...notice.code !== undefined ? { code: notice.code } : {},
        ...notice.upstream?.status !== undefined ? { status: notice.upstream.status } : {},
        message,
        durationMs,
    });
    if (logger === undefined)
        return;
    if (isNew) {
        logger.warn('ftshare.call_classified', {
            tool,
            state,
            ...notice.code !== undefined ? { code: notice.code } : {},
            ...notice.upstream?.status !== undefined ? { status: notice.upstream.status } : {},
            fingerprint,
            durationMs,
            count: record.count,
            message: message.slice(0, 1000),
        });
    }
    else if (record.count % 100 === 0) {
        logger.warn('ftshare.call_classified', {
            tool,
            state,
            ...notice.code !== undefined ? { code: notice.code } : {},
            ...notice.upstream?.status !== undefined ? { status: notice.upstream.status } : {},
            fingerprint,
            durationMs,
            count: record.count,
        });
    }
}
/**
 * 上游接口清单的缓存时长。清单一天最多变几次，而目录产物是发版时生成的，运行期
 * 只用来回答「这个接口名上游认不认」，所以短缓存足够。
 */
const TOOLS_TTL_MS = 5 * 60_000;
/**
 * 建一个 `ctx.ftshareData`。
 * @param options - 见 {@link FtshareDataServiceOptions}。
 * @returns 服务实现；`call` 不抛异常，失败走 `state`/`notice`。
 */
export function createFtshareDataService(options) {
    const now = options.now ?? (() => new Date());
    const store = options.statusStore ?? statusStore;
    let cache;
    return {
        async call(interfaceName, args = {}, callOptions) {
            const source = { name: 'FTShare', fetchedAt: now().toISOString() };
            const startedAt = Date.now();
            try {
                const { value } = await options.transport.call(interfaceName, args, callOptions);
                const observation = observePayload(value);
                if (observation.rows.length > 0)
                    return { ok: true, state: 'available', rows: observation.rows, source };
                // 成功信封 + 显式权限标记 = denied，不是没有数据。这是 P8 的第二种形态。
                const gated = permissionNoticeFromPayload(interfaceName, value);
                if (gated !== undefined) {
                    recordFailure(options.logger, store, interfaceName, 'denied', gated, Date.now() - startedAt);
                    return { ok: false, state: 'denied', rows: [], notice: gated, source };
                }
                if (observation.emptyEvidence)
                    return { ok: true, state: 'empty', rows: [], source };
                const notice = unrecognizedPayloadNotice(value, observation.keys);
                recordFailure(options.logger, store, interfaceName, 'failed', notice, Date.now() - startedAt);
                return { ok: false, state: 'failed', rows: [], notice, source };
            }
            catch (error) {
                const { state, notice } = classifyFailure(error, interfaceName);
                recordFailure(options.logger, store, interfaceName, state, notice, Date.now() - startedAt);
                return { ok: false, state, rows: [], notice, source };
            }
        },
        async listTools() {
            if (cache !== undefined && Date.now() - cache.at < TOOLS_TTL_MS)
                return cache.tools;
            try {
                const tools = await options.transport.listTools();
                cache = { tools, at: Date.now() };
                // 目录漂移：随包快照 vs 上游实时清单的规范化哈希，不一致就留痕。
                store.recordCatalog(tools);
                const observation = store.snapshot().catalog;
                if (observation.changed === true) {
                    options.logger?.warn('ftshare.catalog_changed', {
                        shippedCount: observation.shippedCount,
                        liveCount: observation.liveCount,
                        shippedHash: observation.shippedHash,
                        liveHash: observation.liveHash,
                    });
                }
                return tools;
            }
            catch (error) {
                // 清单是增强信息，不该让调用方拿到异常；失败就退回上一次的清单。
                options.logger?.warn('ftshare.list_tools_failed', { message: error instanceof Error ? error.message : String(error) });
                return cache?.tools ?? [];
            }
        },
    };
}
/**
 * 取一次凭据。设置服务缺失或读取抛错都不让整行崩掉：返回 undefined，网关会以
 * 「未携带 API Key」给出可诊断的拒绝。
 * @param ctx - 宿主上下文。
 * @param logger - 具名 logger。
 * @returns API Key，或 undefined。
 */
async function resolveApiKey(ctx, logger) {
    const apiKey = ctx.ftshareSettings?.apiKey;
    if (apiKey === undefined) {
        logger.warn('ftshare.api_key_namespace_missing', { message: '设置服务未注册 API Key 命名空间，FTShare 取数将不可用' });
        return undefined;
    }
    try {
        return asText(await apiKey.resolve());
    }
    catch (error) {
        logger.warn('ftshare.api_key_resolve_failed', { message: error instanceof Error ? error.message : String(error) });
        return undefined;
    }
}
/**
 * 注册 `ctx.ftshareData`。
 * @param ctx - 宿主上下文；必须是全局（根 loader）子树，preset 子树会抛错。
 * @param config - 可选配置。
 */
export function apply(ctx, config) {
    const logger = ctx.logger('dsh-fft-ftshare');
    const transport = createFtshareTransport({
        endpoint: config?.endpoint,
        clientName: config?.clientName,
        resolveApiKey: () => resolveApiKey(ctx, logger),
        logger,
    });
    const host = ctx;
    host.provide(FTSHARE_DATA_SERVICE, createFtshareDataService({ transport, logger }));
}
//# sourceMappingURL=index.js.map