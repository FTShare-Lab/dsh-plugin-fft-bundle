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
import { zipSync } from 'fflate';
import { LOGS_ARCHIVE_LOG, LOGS_ARCHIVE_MANIFEST, LOGS_ARCHIVE_ROUTE, LOGS_ARCHIVE_SOURCE_DIR, LOGS_EXPORT_MAX_BYTES, LOGS_MAX_SOURCE_FILES, LOGS_SOURCE_MAX_BYTES, } from './contract.js';
import { LOG_BLIND_SPOTS, loadLogExport, renderLogExport } from './export.js';
import { byteLength, formatArchiveFileName, formatLogTimestamp } from './format.js';
import { basename } from 'node:path';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });
/** 按 UTF-8 字节上限截断原文副本，并丢掉最后一个不完整行。 */
function truncateToBytes(text, maxBytes) {
    let slice = decoder.decode(encoder.encode(text).subarray(0, Math.max(0, maxBytes)));
    // 截断点可能落在多字节字符中间，去掉 UTF-8 替换字符。
    while (slice.endsWith('\uFFFD'))
        slice = slice.slice(0, -1);
    const lastBreak = slice.lastIndexOf('\n');
    return lastBreak === -1 ? slice : slice.slice(0, lastBreak + 1);
}
/**
 * 生成诊断包：单文件导出文本 + manifest + 额外来源原文。
 * @param options - 来源定义与 header 元信息。
 * @returns 归档字节、文件名、manifest 与整体 `truncated`。
 */
export async function buildLogArchive(options) {
    await options.flush?.();
    const pluginVersion = await options.pluginVersion;
    const generatedAt = (options.now ?? Date.now)();
    const { loaded, truncated: logTruncated } = await loadLogExport(options);
    const rendered = renderLogExport({
        loaded,
        truncated: logTruncated,
        generatedAt,
        homeDisplay: options.homeDisplay,
        pluginVersion,
        environment: options.environment,
    });
    let truncated = logTruncated;
    // 未压缩字节共用同一个 8 MiB 预算：ft-runtime.log 先占，剩下的才分给原文副本。
    let remaining = LOGS_EXPORT_MAX_BYTES - rendered.bytes;
    const content = [[LOGS_ARCHIVE_LOG, encoder.encode(rendered.text)]];
    const entries = [{ name: LOGS_ARCHIVE_LOG, bytes: content[0][1].byteLength }];
    const sources = [];
    const seen = new Set();
    let index = 0;
    for (const [position, item] of loaded.entries()) {
        const summary = item.summary;
        // 第一条固定是主日志：它的内容已经完整进了 ft-runtime.log。
        if (position === 0) {
            sources.push({ ...summary, entry: LOGS_ARCHIVE_LOG });
            continue;
        }
        if (summary.missing === true) {
            sources.push({ ...summary });
            continue;
        }
        let entry;
        let sourceTruncated = summary.truncated;
        if (seen.has(summary.path)) {
            // 同一路径被配置两次：归档内只留一份原文，编号仍然稳定。
        }
        else if (remaining <= 0) {
            truncated = true;
            sourceTruncated = true;
        }
        else {
            const budget = Math.min(LOGS_SOURCE_MAX_BYTES, remaining);
            let text = item.content;
            if (byteLength(text) > budget) {
                text = truncateToBytes(text, budget);
                truncated = true;
                sourceTruncated = true;
                // 一份来源被切短即表示预算耗尽：剩下的零头不再喂给后续来源，条目数保持确定。
                remaining = 0;
            }
            else {
                remaining -= byteLength(text);
            }
            if (text !== '' || item.content === '') {
                index += 1;
                entry = `${LOGS_ARCHIVE_SOURCE_DIR}${index}-${basename(summary.path)}`;
                seen.add(summary.path);
                const bytes = encoder.encode(text);
                content.push([entry, bytes]);
                entries.push({ name: entry, bytes: bytes.byteLength });
            }
        }
        sources.push({ ...summary, truncated: sourceTruncated, ...(entry === undefined ? {} : { entry }) });
    }
    const manifest = {
        generatedAt: formatLogTimestamp(generatedAt),
        pluginVersion: `@dsh-ft/dsh-fft-settings ${pluginVersion}`,
        runtime: options.environment ?? process.version,
        home: options.homeDisplay,
        limits: {
            sourceBytes: LOGS_SOURCE_MAX_BYTES,
            archiveBytes: LOGS_EXPORT_MAX_BYTES,
            maxSourceFiles: LOGS_MAX_SOURCE_FILES,
        },
        truncated,
        entries,
        sources,
        blindSpots: [...LOG_BLIND_SPOTS],
    };
    // manifest 排第一，其余条目按 ft-runtime.log → sources/<n>-… 的顺序写入（对象键保持插入序）。
    const files = {
        [LOGS_ARCHIVE_MANIFEST]: encoder.encode(JSON.stringify(manifest, null, 2)),
    };
    for (const [name, bytes] of content)
        files[name] = bytes;
    return { fileName: formatArchiveFileName(generatedAt), bytes: zipSync(files), truncated, manifest };
}
/**
 * 挂到 `/api` 载体上的精确 GET 路由。
 *
 * 不读任何请求参数、不重复鉴权（`/api` 前缀的信任与认证由载体负责）；每次请求现算归档，
 * 因此刷盘与版本解析都在这里发生。
 * @param options - 归档选项。
 * @returns 交给 `connection.fetch.register` 的路由定义。
 */
export function createLogsArchiveRoute(options) {
    return {
        path: LOGS_ARCHIVE_ROUTE,
        methods: ['GET'],
        // GET 不读体；buffered 只是与载体约定「本路由不消费请求体」。
        requestBody: 'buffered',
        fetch: async () => {
            const archive = await buildLogArchive(options);
            // 复制成独立 ArrayBuffer 承载的视图：`Response` 的 BodyInit 不接受 ArrayBufferLike 视图。
            const body = new Uint8Array(archive.bytes);
            return new Response(body, {
                status: 200,
                headers: {
                    'content-type': 'application/zip',
                    'content-disposition': `attachment; filename="${archive.fileName}"`,
                    'cache-control': 'no-store',
                    'content-length': String(body.byteLength),
                },
            });
        },
    };
}
