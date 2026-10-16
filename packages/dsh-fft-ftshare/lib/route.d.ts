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
import type { Context } from '@deepseek-ai/cordis';
import { type FtshareDataService } from './contract.js';
/** 交给 `connection.fetch.register` 的精确路由定义。 */
export interface FtshareRoute {
    /** 精确路径，不接受通配。 */
    readonly path: string;
    /** 允许的方法。 */
    readonly methods: readonly string[];
    /** 载体预读请求体的方式。 */
    readonly requestBody: 'buffered';
    /** 处理一次请求。 */
    readonly fetch: (request: Request) => Promise<Response>;
}
/**
 * 造一条只回答 `/api/ftshare-data` 的路由定义（纯函数，便于测试）。
 * @param data - 宿主侧的 `ctx.ftshareData`。
 * @returns 路由定义。
 */
export declare function createFtshareRoute(data: FtshareDataService): FtshareRoute;
/**
 * 注册路由；调用方自己决定挂在哪一层（返回值就是载体的 disposer）。
 * @param ctx - 已经 inject 到 `connection` 的上下文。
 * @param data - 宿主侧的 `ctx.ftshareData`。
 * @returns 载体的注销函数，交给 `ctx.effect` 管。
 */
export declare function registerFtshareRoute(ctx: Context, data: FtshareDataService): () => Promise<void>;
//# sourceMappingURL=route.d.ts.map