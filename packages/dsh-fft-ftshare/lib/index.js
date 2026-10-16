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
 * 凭据一律走 `ctx.ftshareSettings.apiKey.resolve()`，本包不读任何凭据文件。
 * @module @ft/dsh-fft-ftshare
 */
import { FTSHARE_DATA_SERVICE } from './contract.js';
import { asText, classifyFailure, isRecord, permissionNoticeFromPayload } from './errors.js';
import { createFtshareTransport } from './transport.js';
export * from './contract.js';
export { FTSHARE_GATEWAY_ENDPOINT } from './transport.js';
/** Cordis 插件名。 */
export const name = '@ft/dsh-fft-ftshare';
/** 凭据来自设置服务；缺这一项本行挂起等待，属刻意的 fail-loud。 */
export const inject = ['ftshareSettings'];
/** 本行发布的服务名。 */
export const provide = [FTSHARE_DATA_SERVICE];
/**
 * 载荷里当「明细容器」看待的键，按优先级排列。
 *
 * 上游数据接口的返回形态不统一：多数是 `{"data":[…]}`，也有 `rows`/`items`/
 * `result`。这个列表是**读取顺序**，不是白名单——列表里没有的键会在兜底扫描里
 * 作为「任意数组」被找到。
 */
const PAYLOAD_KEYS = ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response'];
/** 只描述调用本身、不含事实的键；判断「是否存在事实」时忽略。 */
const ENVELOPE_KEYS = new Set(['ok', 'success', 'cached', 'metadata', 'message', 'error', 'code', 'status', 'request_id', 'permission', 'permissions', 'source']);
/** 只留下记录元素。 */
function recordsOf(value) {
    return value.filter(isRecord);
}
/**
 * 从任意上游载荷里找出明细行。
 *
 * 规则按优先级：数组自己就是行；`data`/`rows`/… 里第一个非空数组是行；否则找第一
 * 个「元素是对象的数组」；再否则，若记录里还有非信封字段，就把整条记录当作一行
 * （单对象返回值也是数据）。只有「信封里什么都没有」才返回空数组，也就是
 * `empty`——这正是「真的没有数据」的定义。
 * @param value - 上游结构化载荷。
 * @returns 明细行；空数组表示确实没有数据。
 */
export function normalizeRows(value) {
    if (Array.isArray(value))
        return recordsOf(value);
    if (!isRecord(value))
        return [];
    for (const key of PAYLOAD_KEYS) {
        if (!(key in value))
            continue;
        const found = normalizeRows(value[key]);
        if (found.length > 0)
            return found;
    }
    for (const [key, candidate] of Object.entries(value)) {
        if (ENVELOPE_KEYS.has(key) || !Array.isArray(candidate))
            continue;
        const found = recordsOf(candidate);
        if (found.length > 0)
            return found;
    }
    // 兜底：没有任何数组键、但确实带了非信封字段时，整条记录算一行。数组键（哪怕是
    // 空数组）已经在上面的扫描里表过态，不能再把 `{"data": []}` 读成「有一条数据」。
    const meaningful = Object.keys(value).filter(key => !ENVELOPE_KEYS.has(key) && !Array.isArray(value[key]));
    return meaningful.length > 0 ? [value] : [];
}
/**
 * 建一个 `ctx.ftshareData`。
 * @param options - 见 {@link FtshareDataServiceOptions}。
 * @returns 服务实现；`call` 不抛异常，失败走 `state`/`notice`。
 */
export function createFtshareDataService(options) {
    const now = options.now ?? (() => new Date());
    let tools = [];
    /**
     * 刷新上游工具清单。失败只记日志：清单是增强信息，不该让取数失败。
     */
    async function refreshTools() {
        try {
            tools = await options.transport.listTools();
        }
        catch (error) {
            options.logger?.warn('ftshare.list_tools_failed', { message: error instanceof Error ? error.message : String(error) });
        }
    }
    return {
        async call(tool, args = {}, callOptions) {
            const source = { name: 'FTShare', fetchedAt: now().toISOString() };
            const startedAt = Date.now();
            try {
                const { value } = await options.transport.call(tool, args, callOptions);
                // 工具清单只在真的调通之后刷新，避免挂起的网络请求。
                void refreshTools();
                const rows = normalizeRows(value);
                if (rows.length > 0)
                    return { ok: true, state: 'available', rows, source };
                const gated = permissionNoticeFromPayload(tool, value);
                // 成功信封 + 权限标记 = 无权，不是没有数据。这是 P8 的第二种形态。
                if (gated !== undefined)
                    return { ok: false, state: 'denied', rows: [], notice: gated, source };
                return { ok: true, state: 'empty', rows: [], source };
            }
            catch (error) {
                const { state, notice } = classifyFailure(error, tool);
                options.logger?.warn('ftshare.call_classified', { tool, state, code: notice.code, durationMs: Date.now() - startedAt });
                return { ok: false, state, rows: [], notice, source };
            }
        },
        listTools() {
            return tools;
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