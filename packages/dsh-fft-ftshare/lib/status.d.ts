/**
 * 失败现场与目录漂移的进程内聚合（`ftshare_status` 的数据源）。
 *
 * 为什么在内存里：日志是给导出用的长文本，模型问「为什么取不到」时没有便宜的读法；
 * 一个按指纹聚合的环形账本能把「同一个 429 打了几千次、首次/末次是什么、原文是什么」
 * 一次答完。它只记事实，不做归因，也不主动联网。
 * @module @dsh-ft/dsh-fft-ftshare/status
 */
import type { FtshareToolInfo } from './contract.js';
/** 一个失败指纹的聚合记录。 */
export interface FailureRecord {
    fingerprint: string;
    /** 最近一次失败的接口名。 */
    tool: string;
    state: 'denied' | 'failed';
    code?: string;
    status?: number;
    /** 最近一次的上游原文/事实说明。 */
    message: string;
    /** 命中次数。 */
    count: number;
    /** 首次出现时间（ISO）。 */
    firstAt: string;
    /** 最近一次出现时间（ISO）。 */
    lastAt: string;
    /** 最近一次耗时。 */
    lastDurationMs: number;
}
/** 记一条失败所需的输入。 */
export interface FailureInput {
    fingerprint: string;
    tool: string;
    state: 'denied' | 'failed';
    code?: string;
    status?: number;
    message: string;
    durationMs: number;
    /** 事件时间；默认当前时间。 */
    at?: Date;
}
/** 目录漂移的观测结果：随包快照 vs 上游实时清单。 */
export interface CatalogObservation {
    /** 随包目录条目数。 */
    shippedCount: number;
    /** 随包目录的规范化哈希。 */
    shippedHash: string;
    /** 上游实时清单条目数；还没拉过时为 undefined。 */
    liveCount?: number;
    /** 上游实时清单的规范化哈希。 */
    liveHash?: string;
    /** 是否与随包快照不一致。 */
    changed?: boolean;
    /** 最近一次检查时间（ISO）。 */
    checkedAt?: string;
}
/** `ftshare_status` 的快照。 */
export interface StatusSnapshot {
    /** 失败指纹，按次数从多到少。 */
    failures: FailureRecord[];
    /** 目录漂移观测。 */
    catalog: CatalogObservation;
    /** 进程启动以来记录到的失败总次数。 */
    totalFailures: number;
    /** 账本创建时间（ISO）。 */
    since: string;
}
/** 失败账本：服务写、状态工具读；测试可以 new 一个隔离实例。 */
export interface FailureStore {
    /**
     * 记一次失败。
     * @param input - 失败事实。
     * @returns 聚合后的记录与「是否首次出现」。
     */
    recordFailure(input: FailureInput): {
        record: FailureRecord;
        isNew: boolean;
    };
    /**
     * 记一次目录检查。
     * @param live - 上游实时清单。
     */
    recordCatalog(live: readonly FtshareToolInfo[]): void;
    /** 读快照（拷贝，调用方改不到账本）。 */
    snapshot(): StatusSnapshot;
    /** 清空账本（测试用）。 */
    clear(): void;
}
/**
 * 随包目录的规范化摘要。
 * @returns 条目数与哈希。
 */
export declare function shippedCatalogSummary(): {
    count: number;
    hash: string;
};
/**
 * 造一个失败账本。
 * @returns 空账本。
 */
export declare function createFailureStore(): FailureStore;
/** 进程级账本：服务写、`ftshare_status` 读。 */
export declare const statusStore: FailureStore;
//# sourceMappingURL=status.d.ts.map