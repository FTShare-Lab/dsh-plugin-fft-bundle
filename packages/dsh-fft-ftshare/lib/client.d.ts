/**
 * 浏览器助手：造一个与宿主**同名同形**的 `ftshareData`（**消费方自己挂**）。
 *
 * ```ts
 * ctx.provide('ftshareData', createFtshareClient({ catalog, fetch: window.fetch.bind(window) }))
 * ```
 *
 * 面板因此与宿主消费方写法一致：`state === 'denied'` 显示「去升级」，
 * `state === 'empty'` 才是「没有数据」。两处刻意的差别（设计 §5.2）：
 *
 * - **可调集合是目录全量**，不是模型那张策展接口表 —— 面板不受提示词预算约束；
 * - **发现靠本地 `search()`**，是对目录的纯函数，不发网络。
 *
 * 这个模块是**只读子集**：不碰凭据、不碰网关地址、不维护接口表。它只认两样输入——
 * 随包的目录与被注入的 `fetch`；`@ft/dsh-fft-ftshare/route` 与网关常量都不在这里的
 * 依赖里，`scripts/test-crossplane.mjs` 会 grep 产物把这条钉住。
 * @module @ft/dsh-fft-ftshare/client
 */
import { type CatalogEntry } from './catalog.js';
import { type FtshareDataService } from './contract.js';
/** 浏览器侧可用的 `fetch` 子集；测试直接注入假实现。 */
export type FtshareFetch = (input: string, init: RequestInit) => Promise<Response>;
/** 客户端服务的调用选项。 */
export interface FtshareClientOptions {
    /** 随包目录（`catalog.json` 的解析结果），决定哪些接口可调。 */
    catalog: unknown;
    /** 同源 fetch；浏览器传 `window.fetch.bind(window)`。 */
    fetch: FtshareFetch;
    /** 路由覆盖，默认 {@link FTSHARE_DATA_ROUTE}。 */
    route?: string;
    /** 成功结果的缓存时长；`denied` 与失败从不缓存。 */
    ttlMs?: number;
    /** 时钟，测试用来固定 `source.fetchedAt`。 */
    now?: () => Date;
}
/** 客户端服务：与 {@link FtshareDataService} 同名同形，另加一个本地检索。 */
export interface FtshareClientService extends FtshareDataService {
    /**
     * 在目录里本地检索（纯函数，不发网络）。
     * @param query - 关键词，大小写不敏感；空串返回前 `limit` 条。
     * @param limit - 最多返回条数，默认 20。
     * @returns 命中的目录条目。
     */
    search(query: string, limit?: number): CatalogEntry[];
}
/**
 * 造一个客户端 `ftshareData`。
 * @param options - 见 {@link FtshareClientOptions}。
 * @returns 与宿主同名同形的服务，外加本地 `search()`。
 */
export declare function createFtshareClient(options: FtshareClientOptions): FtshareClientService;
//# sourceMappingURL=client.d.ts.map