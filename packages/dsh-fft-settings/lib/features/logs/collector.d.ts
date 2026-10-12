/**
 * FT 运行日志采集器（Host 侧，不依赖 cordis，便于单测）。
 *
 * 职责：接收 cordis exporter 的记录 → 节流合并 → 脱敏 → 追加 `$DSH_HOME/logs/ft/current.log`，
 * 超限轮转、保留 `keep` 份；写失败 / 轮转 / 丢弃一律自报 stderr，绝不抛回业务插件。
 */
import { type LogLevelName } from './contract.js';
/** 采集器接受的最小记录形状；cordis 的 `Message` 结构上满足它。 */
export interface CollectorRecord {
    readonly ts: number;
    readonly type: LogLevelName;
    readonly name: string;
    readonly args: readonly unknown[];
}
export interface CollectorOptions {
    /** 落盘目录，通常是 `$DSH_HOME/logs/ft`。 */
    readonly directory: string;
    readonly level: LogLevelName;
    readonly maxBytes: number;
    readonly keep: number;
    /** 已知密钥（如当前 FTShare Key）的延时提供者；取不到时按空处理。 */
    readonly secrets?: () => Promise<readonly string[]>;
    readonly fileName?: string;
    /** 注入时钟，便于测试。 */
    readonly now?: () => number;
    /** 注入定时器；返回取消函数。默认 `setTimeout().unref()`，不阻止进程退出。 */
    readonly schedule?: (run: () => void, delayMs: number) => () => void;
    /** 自报通道；默认写 stderr。日志系统不能静默失败。 */
    readonly selfReport?: (message: string) => void;
}
export interface CollectorSnapshot {
    readonly filePath: string;
    readonly fileBytes: number;
    readonly records: number;
    readonly dropped: number;
    readonly rotations: number;
    readonly writeFailures: number;
    readonly firstTs?: number;
    readonly lastTs?: number;
    readonly byName: Readonly<Record<string, number>>;
}
/** 常驻采集器；生命周期由调用方（cordis `ctx.effect`）负责关闭。 */
export declare class FtLogCollector {
    readonly filePath: string;
    readonly threshold: number;
    private readonly directory;
    private readonly options;
    private readonly now;
    private readonly schedule;
    private readonly report;
    private readonly pending;
    private readonly byName;
    private chain;
    private ready;
    private cancelTimer;
    private timerDeadline;
    private bytes;
    private records;
    private dropped;
    private rotations;
    private writeFailures;
    private firstTs;
    private lastTs;
    private cachedSecrets;
    private secretsAt;
    private closed;
    constructor(options: CollectorOptions);
    /** 接收一条 cordis 记录：同 key 在 10 秒窗口内合并为一行并累计重复次数。 */
    append(record: CollectorRecord): void;
    /** 注册时回填 cordis 内置缓冲里剩余的 `error`/`info`（`warn`/`debug` 已丢，不可恢复）。 */
    backfill(records: readonly CollectorRecord[]): Promise<void>;
    /** 把队列全部落盘（导出前调用），等待写入链结束。 */
    flush(): Promise<void>;
    /** 关闭句柄与队列；之后 `append` 变为空操作。 */
    dispose(): Promise<void>;
    stats(): CollectorSnapshot;
    /** 当前已知密钥（带 TTL 缓存，避免每次写盘都解析凭据）。 */
    private currentSecrets;
    private armTimer;
    private cancel;
    /** 把窗口已过期的待写条目交给写入链（保持插入顺序）。 */
    private sweep;
    private dropOldest;
    private enqueue;
    private write;
    private rotate;
    /** 同一毫秒内可能连续轮转两次（小 maxBytes + 突发），文件名必须唯一，否则会互相覆盖。 */
    private uniqueRotationPath;
    /** 保留策略按修改时间（而不是文件名）排序：同一毫秒连转时的 `-N` 后缀不影响新旧判断。 */
    private prune;
}
