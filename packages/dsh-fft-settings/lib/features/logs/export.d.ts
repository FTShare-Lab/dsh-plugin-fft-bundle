/**
 * 导出物组装（Host 侧）：读主日志与配置的 sources，拼成单个 `.log` 文本。
 *
 * 体积上限按规格 §9：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`；
 * 超限按“保留最新”截断，并在 header 标注 `truncated=true`。
 */
import { type LogsSourceSummary, type LogsSourceState } from './contract.js';
/**
 * 单文件导出选项：来源定义（与诊断包共用的 {@link LoadExportOptions}）加上 header 元信息。
 */
export interface ExportOptions extends LoadExportOptions {
    readonly homeDisplay: string;
    readonly pluginVersion: string;
    readonly now?: () => number;
    readonly environment?: string;
}
export interface ExportResult {
    readonly text: string;
    readonly fileName: string;
    readonly bytes: number;
    readonly truncated: boolean;
    readonly summaries: readonly LogsSourceSummary[];
}
/** 读来源只用到这两项；诊断包复用同一加载过程。 */
export interface LoadExportOptions {
    /** 主日志文件（`current.log`）的绝对路径。 */
    readonly filePath: string;
    /** 配置里的额外来源（原样，可能带 `~`）。 */
    readonly sources: readonly string[];
}
/** 一次封装后的来源内容；`content` 已按上限截断。 */
export interface LoadedSource {
    readonly summary: LogsSourceSummary;
    readonly content: string;
}
/** 加载结果：来源清单加正文，以及整体是否被截断。 */
export interface LoadedExport {
    readonly loaded: readonly LoadedSource[];
    readonly truncated: boolean;
}
/** 渲染导出文本所需的元信息（时间戳由调用方给定，保证同一份导出只有一个生成时间）。 */
export interface RenderExportOptions {
    readonly loaded: readonly LoadedSource[];
    readonly truncated: boolean;
    readonly generatedAt: number;
    readonly homeDisplay: string;
    readonly pluginVersion: string;
    readonly environment?: string;
}
/** 尾读一个文件，最多 `maxBytes` 字节；超出时丢掉首个不完整行。 */
export declare function readTail(path: string, maxBytes: number): Promise<{
    text: string;
    truncated: boolean;
    size: number;
}>;
/** 读文件尾部最近的 N 行；同时受字节上限约束。 */
export declare function readTailLines(path: string, lines: number, maxBytes: number): Promise<{
    lines: string[];
    bytes: number;
    truncated: boolean;
    fileBytes: number;
}>;
/** 统计正文的行数与时间范围（时间戳取行首北京时间）。 */
export declare function summarizeContent(text: string): {
    lines: number;
    firstAt?: string;
    lastAt?: string;
};
/** 判断配置的来源当前形态；目录会被展开成文件清单（最多 20 个）。 */
export declare function resolveSource(rawPath: string): Promise<{
    state: LogsSourceState;
    files: readonly string[];
}>;
/** 各来源的存在性快照，供设置页展示。 */
export declare function describeSources(sources: readonly string[]): Promise<LogsSourceState[]>;
/** 导出物 header 与 manifest 共用的四条覆盖盲区（规格 §5）。 */
export declare const LOG_BLIND_SPOTS: string[];
/**
 * 按规格 §9 的封顶语义读取主日志与额外来源：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`。
 *
 * 单文件导出与诊断包共用这一步，两者的 `truncated` 语义因此完全一致。
 * @param options - 主日志路径与配置的额外来源。
 * @returns 每个来源的统计与正文，以及整体是否截断。
 */
export declare function loadLogExport(options: LoadExportOptions): Promise<LoadedExport>;
/** 拼装导出文本：header（来源清单、条数、时间范围、truncated、盲区）+ 来源段落。 */
export declare function renderLogExport(options: RenderExportOptions): {
    text: string;
    bytes: number;
};
/** 单文件导出：加载 + 渲染，附文件名与各来源统计。 */
export declare function buildLogExport(options: ExportOptions): Promise<ExportResult>;
