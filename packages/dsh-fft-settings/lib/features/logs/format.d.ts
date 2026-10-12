/**
 * 日志行格式化与脱敏（纯函数，无 Node 依赖，浏览器半边也可导入）。
 *
 * 行格式（规格 §8）：
 * `<ISO8601+08:00> <LEVEL> <plugin-name> <message> <k=v …>`，单行上限 8 KiB。
 */
import { type LogLevelName } from './contract.js';
/** 行首时间戳：`2026-10-12T15:04:05.123+08:00`。 */
export declare function formatLogTimestamp(ts: number): string;
/** 下载文件名时间戳：`yyyyMMdd-HHmmss`。 */
export declare function formatCompactStamp(ts: number): string;
/** 轮转文件名时间戳：`2026-10-12T15-04-05-123+0800`（去掉文件系统不友好的 `:`/`.`）。 */
export declare function formatRotationStamp(ts: number): string;
/** 导出物文件名：`ft-runtime-<yyyyMMdd-HHmmss>.log`。 */
export declare function formatDownloadFileName(ts: number): string;
/** 轮转文件名：`ft-<ISO时间戳>.log`（与当前文件名 `current.log` 不冲突）。 */
export declare function formatRotationFileName(ts: number): string;
/** 文本 UTF-8 字节数（不依赖 Buffer，浏览器可用）。 */
export declare function byteLength(text: string): number;
/** 按 UTF-8 字节截断单行，并在上限内补 `...[已截断]`。 */
export declare function truncateLine(line: string, maxBytes?: number): string;
/** 把可能的多行文本压成单行（换行转义），保持「一条记录一行」。 */
export declare function singleLine(text: string): string;
/** 把任意值渲染成短、稳定、可读的文本；键按字典序排列以便节流合并可比。 */
export declare function renderValue(value: unknown, depth?: number): string;
/**
 * 渲染一条记录的正文，语义对齐 cordis `Logger.format`：
 * 首参是 Error 时取 message，首参非字符串时当作字段对象；`%s/%d/%i/%f/%o/%O/%c/%%` 生效，
 * 对象参数统一渲染为 `k=v`（而不是 JSON），且结果恒为单行。
 */
export declare function formatLogMessage(args: readonly unknown[]): string;
/** 当前 FTShare Key 等已知密钥的精确值替换（长度过短的值不参与，避免误伤普通文本）。 */
export declare function redactSecrets(text: string, secrets?: readonly string[]): string;
/** 组装一行：`<时间> <LEVEL> <name> <正文>`（`WARN` 之类按 5 字符对齐）。 */
export declare function formatLogLine(record: {
    ts: number;
    type: LogLevelName;
    name: string;
    args: readonly unknown[];
}): string;
