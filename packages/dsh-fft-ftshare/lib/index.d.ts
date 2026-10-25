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
 * @module @dsh-ft/dsh-fft-ftshare
 */
import type { Context, Logger } from '@deepseek-ai/cordis';
import { type FtshareDataService } from './contract.js';
import { type FtshareTransport } from './transport.js';
export * from './contract.js';
export { FTSHARE_GATEWAY_ENDPOINT } from './transport.js';
/** Cordis 插件名。 */
export declare const name = "@dsh-ft/dsh-fft-ftshare";
/** 凭据来自设置服务；缺这一项本行挂起等待，属刻意的 fail-loud。 */
export declare const inject: string[];
/** 本行发布的服务名。 */
export declare const provide: "ftshareData"[];
/** 宿主行的可选配置。 */
export interface FtshareDataConfig {
    /** 覆盖网关地址；默认 {@link FTSHARE_GATEWAY_ENDPOINT}。 */
    endpoint?: string;
    /** MCP 客户端自称的名字，只影响上游日志。 */
    clientName?: string;
}
/** 建服务所需的依赖，全部可注入，便于测试。 */
export interface FtshareDataServiceOptions {
    /** 传输层；测试注入假实现即可完全不联网。 */
    transport: FtshareTransport;
    /** 具名 logger。 */
    logger?: Logger;
    /** 时钟，测试用来固定 `source.fetchedAt`。 */
    now?: () => Date;
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
export declare function normalizeRows(value: unknown): Record<string, unknown>[];
/**
 * 建一个 `ctx.ftshareData`。
 * @param options - 见 {@link FtshareDataServiceOptions}。
 * @returns 服务实现；`call` 不抛异常，失败走 `state`/`notice`。
 */
export declare function createFtshareDataService(options: FtshareDataServiceOptions): FtshareDataService;
/**
 * 注册 `ctx.ftshareData`。
 * @param ctx - 宿主上下文；必须是全局（根 loader）子树，preset 子树会抛错。
 * @param config - 可选配置。
 */
export declare function apply(ctx: Context, config?: FtshareDataConfig): void;
//# sourceMappingURL=index.d.ts.map