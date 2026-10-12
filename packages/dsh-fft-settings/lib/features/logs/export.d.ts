/**
 * 导出物组装（Host 侧）：读主日志与配置的 sources，拼成单个 `.log` 文本。
 *
 * 体积上限按规格 §9：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`；
 * 超限按“保留最新”截断，并在 header 标注 `truncated=true`。
 */
import { type LogsSourceSummary, type LogsSourceState } from './contract.js';
export interface ExportOptions {
    /** 主日志文件（`current.log`）的绝对路径。 */
    readonly filePath: string;
    /** 配置里的额外来源（原样，可能带 `~`）。 */
    readonly sources: readonly string[];
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
/** 拼装导出文本：header（来源清单、条数、时间范围、truncated、盲区）+ 来源段落。 */
export declare function buildLogExport(options: ExportOptions): Promise<ExportResult>;
