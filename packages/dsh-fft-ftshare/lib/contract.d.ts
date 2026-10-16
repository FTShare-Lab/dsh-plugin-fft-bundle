/**
 * `@ft/dsh-fft-ftshare/contract` —— FTShare 公用底座的冻结契约。
 *
 * 消费方只需要 `import type { FtshareDataService } from '@ft/dsh-fft-ftshare/contract'`，
 * 不依赖本包的实现、传输层或 MCP SDK。本模块只有类型与常量，没有运行时依赖，
 * 因此宿主插件与测试都能安全引用。
 *
 * 设计要点是 **四态归一**：FTShare 网关把「真的没有数据」「套餐无权限（403
 * route_not_allowed）」「取数失败」三种情况都表现为「空」，调用方若只判断空数组就
 * 会把「无权限」误读成「没有数据」。{@link FtshareCallResult.state} 强制区分这四种
 * 结局，并把权限提示挂在 {@link FtshareCallResult.notice} 上。
 * @module @ft/dsh-fft-ftshare/contract
 */
/** 服务在 cordis `Context` 上的名字，也是 `ctx.provide` 的键。 */
export declare const FTSHARE_DATA_SERVICE: "ftshareData";
/** 用户可升级订阅的页面，{@link FtshareNotice.upgradeUrl} 的默认值。 */
export declare const FTSHARE_UPGRADE_URL: "https://ftai.chat/me/profile?tab=subscription";
/**
 * 一次取数的四态结局。
 *
 * - `available`：调用成功且至少返回了一行；
 * - `empty`：调用成功但确实没有数据；
 * - `denied`：上游拒绝（API Key 无效或套餐未开通该接口，HTTP 403
 *   route_not_allowed / capability_limited）—— **不是**「没有数据」；
 * - `failed`：连接、超时、参数或上游 5xx 等其他失败。
 */
export type FtshareCallState = 'available' | 'empty' | 'denied' | 'failed';
/**
 * 四态归一后的取数结果。
 *
 * 形状已冻结：字段只增不改，消费方按需读取。
 */
export interface FtshareCallResult {
    /**
     * 调用是否走通到「上游给出了答复」这一步：`available` 与 `empty` 为真，
     * `denied` 与 `failed` 为假。它回答的是「通道是否可用」，不回答「有没有数据」——
     * 后者看 {@link state}。把两者分开是有意的：只有 `empty` 才允许下游说
     * 「没有数据」。
     */
    ok: boolean;
    /** 四态结局，见 {@link FtshareCallState}。 */
    state: FtshareCallState;
    /** 归一后的明细行；`available` 之外通常为空数组，绝不是权限判断依据。 */
    rows: Record<string, unknown>[];
    /** 需要向用户/模型解释的异常，权限与失败各有措辞；成功时为 undefined。 */
    notice?: FtshareNotice;
    /** 取数来源与时点，用于在报告里给出处。 */
    source: FtshareSource;
}
/** 面向用户/模型的异常说明。 */
export interface FtshareNotice {
    /** 上游或本包归一后的错误码，如 `route_not_allowed`、`capability_limited`。 */
    code: string;
    /** 中文说明，可直接展示。 */
    message: string;
    /** 建议订阅档位（Free/Basic/Advanced/Pro），由接口版本推断，属提示而非断言。 */
    requiredPlan?: string;
    /** 升级入口。 */
    upgradeUrl?: string;
    /** 是否值得原样重试：限流、超时、网络失败为真；权限与参数错误为假。 */
    retryable: boolean;
}
/** 取数来源与时点。 */
export interface FtshareSource {
    name: 'FTShare';
    /** ISO-8601 取数时点。 */
    fetchedAt: string;
}
/** 单次调用的可选项。 */
export interface FtshareCallOptions {
    /** 调用方取消信号；已取消时立刻抛出/返回 `failed`，不发起连接。 */
    signal?: AbortSignal;
}
/** 上游 FTShare MCP 网关暴露的一个工具。 */
export interface FtshareToolInfo {
    /** 上游工具名，例如 `ft_v1_finance_income`。 */
    tool: string;
    /** 上游标题；上游未提供时回落为工具名。 */
    title: string;
    /** 上游说明原文；随包目录的两份产物都由它生成。 */
    description?: string;
    /** 上游入参 JSON Schema 原文；`ftshare_call` 的本地预校验用它。 */
    inputSchema?: unknown;
}
/**
 * `ctx.ftshareData`：FTShare 取数的唯一入口。
 *
 * 实现由本包的宿主入口（裸包名 `@ft/dsh-fft-ftshare`）`provide`，且必须挂在
 * **全局平面**：preset 内的 `provide` 会直接抛
 * `Preset services require isolate realms`（`agent-preset-registry` 的
 * `mount.ts`），而加上 isolate 之后服务会变成 preset 私有，preset 之外的插件再也
 * inject 不到。消费方因此统一用 `inject: ['ftshareData']` 声明依赖。
 */
export interface FtshareDataService {
    /**
     * 调一个上游 FTShare 接口并把结果归一成 {@link FtshareCallResult}。
     * @param interfaceName - 上游接口名，例如 `ft_v1_finance_income`。
     * @param args - 上游接口入参，原样透传。
     * @param options - 取消信号等。
     * @returns 归一后的结果；本方法不抛异常，权限与失败都走 `state`/`notice`。
     */
    call(interfaceName: string, args?: Record<string, unknown>, options?: FtshareCallOptions): Promise<FtshareCallResult>;
    /**
     * 上游当前可用的接口清单（名字、标题、说明、入参 schema）。
     *
     * 自己触发拉取并做短 TTL 缓存：不依赖「先调通一次」才有人填缓存。上游不可达时
     * 返回上一次的清单，没有则返回空数组——清单是增强信息，不该让取数失败。
     */
    listTools(): Promise<readonly FtshareToolInfo[]>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        ftshareData: FtshareDataService;
    }
}
//# sourceMappingURL=contract.d.ts.map