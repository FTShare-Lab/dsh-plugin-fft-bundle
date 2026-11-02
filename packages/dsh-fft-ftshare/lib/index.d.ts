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
import type { Context, Logger } from '@deepseek-ai/cordis';
import { type FtshareDataService } from './contract.js';
import { type FailureStore } from './status.js';
import { type FtshareTransport } from './transport.js';
export * from './contract.js';
export { FTSHARE_GATEWAY_ENDPOINT } from './transport.js';
export { statusStore } from './status.js';
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
    /** 失败账本；缺省用进程级实例，测试传隔离实例。 */
    statusStore?: FailureStore;
}
/** 一次成功载荷的观测结果。 */
export interface PayloadObservation {
    /** 明细行；`available` 的依据。 */
    rows: Record<string, unknown>[];
    /** 已知数据容器存在且为空数组：这是 `empty` 的唯一正向证据。 */
    emptyEvidence: boolean;
    /** 顶层键，用于未识别载荷的诊断。 */
    keys: string[];
    /** 成功信封里既没有行、也没有空证据。 */
    unrecognized: boolean;
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
export declare function observePayload(value: unknown, depth?: number): PayloadObservation;
/**
 * 从任意上游载荷里找出明细行（`observePayload` 的兼容薄包装）。
 * @param value - 上游结构化载荷。
 * @returns 明细行；空数组表示没有行（**不**代表 `empty`，见 `observePayload`）。
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