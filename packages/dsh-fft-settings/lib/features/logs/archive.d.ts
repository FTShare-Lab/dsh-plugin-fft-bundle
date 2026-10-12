/**
 * 诊断包（P2，规格 §9 / §12 决策 3）：把单文件导出与额外来源原文打成一个 zip。
 *
 * 归档结构与封顶语义：
 *
 * - `manifest.json`：生成时间、插件版本、运行时、`$DSH_HOME` 展示名、上限、`truncated`、
 *   各来源统计（label/path/lines/bytes/firstAt/lastAt/missing/truncated）、四条覆盖盲区；
 * - `ft-runtime.log`：与单文件导出**完全相同**的文本（复用 `loadLogExport` + `renderLogExport`）；
 * - `sources/<n>-<basename>`：配置的额外来源文件原文，编号稳定、按路径去重；缺失来源只进 manifest。
 *
 * 封顶沿用规格 §9：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`；归档以**未压缩字节**
 * 计入同一个 8 MiB 预算（`ft-runtime.log` 先算，剩余额度再分给 `sources/*`），超限截断并在
 * manifest 标 `truncated: true`。
 *
 * 本文件是 Host 半边（Node 文件系统 + `fflate`），不得被浏览器半边引用：卡片只用
 * `./contract.js` 里的 `LOGS_ARCHIVE_ROUTE` 与 `<a download>`。
 */
import type { SettingsRoute } from '../../core/rpc-core.js';
import { LOGS_ARCHIVE_ROUTE, type LogsSourceSummary } from './contract.js';
import { type ExportOptions } from './export.js';
/**
 * 与 core 的 `SettingsRoute` 同形，只把 `path` 从「那一条 POST 路由」放宽到本 feature 的精确路径。
 * core 因此不需要认识 `/logs.zip`（架构守护测试要求 core 无 feature 词汇）。
 */
export interface LogsArchiveRoute extends Omit<SettingsRoute, 'path'> {
    readonly path: typeof LOGS_ARCHIVE_ROUTE;
}
/** 载体侧的注册面：与 core 的 `HostFetch` 同形，收本 feature 自己的路由。 */
export interface LogsArchiveRouteRegistry {
    register(route: LogsArchiveRoute): () => Promise<void>;
}
/** 归档选项：来源定义与 header 元信息（`filePath`/`sources`/`homeDisplay`/`environment`）。 */
export interface LogsArchiveOptions extends Omit<ExportOptions, 'pluginVersion' | 'now'> {
    /** 插件版本；允许传 promise，`readPluginVersion()` 的结果可以直接塞进来。 */
    readonly pluginVersion: string | Promise<string>;
    /** 读文件前刷盘（采集器的 10 秒合并窗口）；省略时直接读当前文件。 */
    readonly flush?: () => Promise<void>;
    readonly now?: () => number;
}
/** manifest 里的一个来源：规格 §9 的统计字段，外加它落在归档里的条目名。 */
export interface LogsArchiveManifestSource extends LogsSourceSummary {
    /** 归档内的条目路径；缺失或未纳入时不存在。 */
    readonly entry?: string;
}
export interface LogsArchiveEntry {
    readonly name: string;
    readonly bytes: number;
}
export interface LogsArchiveManifest {
    readonly generatedAt: string;
    readonly pluginVersion: string;
    readonly runtime: string;
    /** `$DSH_HOME` 的展示名（`~/.dsh` 或 `$DSH_HOME`），不写绝对路径。 */
    readonly home: string;
    readonly limits: {
        readonly sourceBytes: number;
        readonly archiveBytes: number;
        readonly maxSourceFiles: number;
    };
    /** 未压缩字节是否触到任一上限。 */
    readonly truncated: boolean;
    /** 归档内除 `manifest.json` 自身之外的条目（它无法记录自己的字节数）。 */
    readonly entries: readonly LogsArchiveEntry[];
    readonly sources: readonly LogsArchiveManifestSource[];
    readonly blindSpots: readonly string[];
}
export interface LogsArchive {
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly truncated: boolean;
    readonly manifest: LogsArchiveManifest;
}
/**
 * 生成诊断包：单文件导出文本 + manifest + 额外来源原文。
 * @param options - 来源定义与 header 元信息。
 * @returns 归档字节、文件名、manifest 与整体 `truncated`。
 */
export declare function buildLogArchive(options: LogsArchiveOptions): Promise<LogsArchive>;
/**
 * 挂到 `/api` 载体上的精确 GET 路由。
 *
 * 不读任何请求参数、不重复鉴权（`/api` 前缀的信任与认证由载体负责）；每次请求现算归档，
 * 因此刷盘与版本解析都在这里发生。
 * @param options - 归档选项。
 * @returns 交给 `connection.fetch.register` 的路由定义。
 */
export declare function createLogsArchiveRoute(options: LogsArchiveOptions): LogsArchiveRoute;
