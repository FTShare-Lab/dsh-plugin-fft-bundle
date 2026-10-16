/**
 * 宿主助手：把 `ctx.ftshareData` 挂到跨平面路由上（**消费方自己挂**）。
 *
 * 底座不声明 `dsh.client` —— 它不是客户端面，只发布两段实现。需要浏览器取数的消费方
 * 自己挂这一行：
 *
 * ```ts
 * ctx.inject(['connection', 'ftshareData'], scope =>
 *   scope.effect(() => registerFtshareRoute(scope.ctx, scope.ftshareData), 'ftshare: /api route'))
 * ```
 *
 * 路由是 `connection.fetch` 的**精确**路由，复用 `/api` 载体的 Host/Origin 围栏与
 * 浏览器鉴权。契约（设计 §5.1）：
 *
 * - **原样过桥**：成功就是一份 `FtshareCallResult`，`notice` 与 `upgradeUrl` 一起带，
 *   面板才能把「没权限」渲染成「去升级」而不是「没有数据」；
 * - **接口名校验**：只接受目录里的接口名，否则 400 —— 底座不能变成任意上游的穿透代理；
 * - **取消与超时**：`request.signal` 原样转给 `call({ signal })`，面板的连点与切标的
 *   因此能真的取消掉在途请求。
 * @module @ft/dsh-fft-ftshare/route
 */
import { catalogEntryOf, missingRequiredArgs } from './catalog.js';
import { loadCatalog } from './catalog-host.js';
import { FTSHARE_DATA_ROUTE } from './contract.js';
import { isRecord } from './errors.js';
/**
 * 造一条只回答 `/api/ftshare-data` 的路由定义（纯函数，便于测试）。
 * @param data - 宿主侧的 `ctx.ftshareData`。
 * @returns 路由定义。
 */
export function createFtshareRoute(data) {
    return {
        path: FTSHARE_DATA_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
            const body = await readJsonBody(request);
            if (body === undefined)
                return errorResponse(400, 'bad_request', '请求体不是合法的 JSON 对象');
            const name = typeof body.interface === 'string' ? body.interface.trim() : '';
            const args = isRecord(body.args) ? body.args : undefined;
            if (name === '')
                return errorResponse(400, 'bad_request', '缺少 interface');
            const entry = catalogEntryOf(loadCatalog(), name);
            if (entry === undefined)
                return errorResponse(400, 'unknown_interface', `接口 ${name} 不在目录里，不能直调`);
            const missing = missingRequiredArgs(entry, args);
            if (missing.length > 0)
                return errorResponse(400, 'missing_arguments', `缺必填入参：${missing.join('、')}`);
            const result = await data.call(name, args ?? {}, { signal: request.signal });
            // 四态**原样**过桥：这里不翻译、不裁字段，面板与宿主看到同一份东西。
            return json(200, result);
        },
    };
}
/**
 * 注册路由；调用方自己决定挂在哪一层（返回值就是载体的 disposer）。
 * @param ctx - 已经 inject 到 `connection` 的上下文。
 * @param data - 宿主侧的 `ctx.ftshareData`。
 * @returns 载体的注销函数，交给 `ctx.effect` 管。
 */
export function registerFtshareRoute(ctx, data) {
    const connection = ctx.get('connection');
    const fetch = connection?.fetch;
    if (fetch === undefined)
        throw new Error('registerFtshareRoute 需要 connection.fetch：先把 connection inject 进来');
    return fetch.register(createFtshareRoute(data));
}
/** 读一个 JSON 对象请求体；非法或非对象时 undefined。 */
async function readJsonBody(request) {
    try {
        const parsed = await request.json();
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/** 错误信封：客户端按 `error.code` / `error.message` 渲染成 `failed`。 */
function errorResponse(status, code, message) {
    return json(status, { error: { code, message } });
}
/** JSON 应答。 */
function json(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
//# sourceMappingURL=route.js.map