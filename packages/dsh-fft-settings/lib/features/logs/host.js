/**
 * `logs` 命名空间 Host 半边：常驻采集器 + 导出器。
 *
 * 采集器在 `create()` 里**无条件启动**（`apply()` 期注册即执行，与设置页是否渲染无关）；
 * exporter 由 cordis 绑定当前 fiber，另用 `ctx.effect` 明确关闭文件句柄与队列。
 *
 * 工厂化：dev 的接缝里 `create(ctx)` 不再收配置，模块由 `apply()` 用一个闭包把
 * 已解析的 `logs` 配置带进来（`createLogsModule(logsConfig)`）。这样采集器仍然在
 * 注册期、而不是等到设置页打开才启动。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { FTSHARE_API_KEY_REF } from '../api-key/contract.js';
import { defineSettingsModule } from '../../core/module-registry.js';
import { FtLogCollector } from './collector.js';
import { LOGS_DEFAULT_PREVIEW_LINES, LOGS_MAX_PREVIEW_LINES, LOGS_PREVIEW_MAX_BYTES, } from './contract.js';
import { buildLogExport, describeSources, readTailLines } from './export.js';
import { formatLogTimestamp } from './format.js';
import { displayDshHome, logsDirectory, resolveDshHome } from './home.js';
import { createLogsRpcMethods } from './rpc.js';
/** 从本包 `package.json` 读版本；读不到时退回 `unknown`，不影响导出。 */
async function readPluginVersion() {
    try {
        const url = new URL('../../../package.json', import.meta.url);
        const { readFile } = await import('node:fs/promises');
        const parsed = JSON.parse(await readFile(url, 'utf8'));
        return typeof parsed.version === 'string' ? parsed.version : 'unknown';
    }
    catch {
        return 'unknown';
    }
}
/**
 * 构建 `logs` 模块：把已解析的配置闭包进 `create`。
 * @param config - 本 feature 的 `logs` 配置（`resolveLogsConfig` 的输出，永远完整）。
 * @returns 可交给 `ctx.ftshareSettings.modules.register` 的模块。
 */
export function createLogsModule(config) {
    return defineSettingsModule({
        namespace: 'logs',
        inject: ['credentials'],
        create(ctx) {
            const home = resolveDshHome();
            const directory = logsDirectory(home);
            const collector = new FtLogCollector({
                directory,
                level: config.level,
                maxBytes: config.maxBytes,
                keep: config.keep,
                // 当前 FTShare Key 的精确值替换：取不到就退化为纯模式脱敏。
                secrets: async () => {
                    const ref = credentialRef(FTSHARE_API_KEY_REF);
                    const resolved = await ctx.credentials.resolve(ref);
                    return resolved?.value === undefined ? [] : [resolved.value];
                },
            });
            const version = readPluginVersion();
            const service = {
                filePath: collector.filePath,
                flush: () => collector.flush(),
                dispose: () => collector.dispose(),
                stats: async () => {
                    const snapshot = collector.stats();
                    return {
                        file: snapshot.filePath,
                        fileBytes: snapshot.fileBytes,
                        level: config.level,
                        maxBytes: config.maxBytes,
                        keep: config.keep,
                        records: snapshot.records,
                        dropped: snapshot.dropped,
                        rotations: snapshot.rotations,
                        writeFailures: snapshot.writeFailures,
                        firstAt: snapshot.firstTs === undefined ? undefined : formatLogTimestamp(snapshot.firstTs),
                        lastAt: snapshot.lastTs === undefined ? undefined : formatLogTimestamp(snapshot.lastTs),
                        byName: snapshot.byName,
                        sources: await describeSources(config.sources),
                    };
                },
                preview: async (lines = LOGS_DEFAULT_PREVIEW_LINES) => {
                    await collector.flush();
                    const wanted = Math.min(LOGS_MAX_PREVIEW_LINES, Math.max(1, Math.trunc(lines)));
                    try {
                        const tail = await readTailLines(collector.filePath, wanted, LOGS_PREVIEW_MAX_BYTES);
                        return { lines: tail.lines, bytes: tail.bytes, truncated: tail.truncated, fileBytes: tail.fileBytes };
                    }
                    catch {
                        // 还没有任何日志时不是错误：返回空预览。
                        return { lines: [], bytes: 0, truncated: false, fileBytes: 0 };
                    }
                },
                export: async () => {
                    await collector.flush();
                    const result = await buildLogExport({
                        filePath: collector.filePath,
                        sources: config.sources,
                        homeDisplay: displayDshHome(home),
                        pluginVersion: await version,
                        environment: `node ${process.version} ${process.platform} ${process.arch}`,
                    });
                    return { fileName: result.fileName, text: result.text, bytes: result.bytes, truncated: result.truncated, sources: result.summaries };
                },
            };
            const disposeExporter = ctx.logger.exporter({
                // levels 是接收上限：warn=2 收 error/info/warn，debug=3 全收。
                levels: { default: collector.threshold },
                export: message => collector.append(message),
            });
            ctx.effect(() => () => {
                disposeExporter();
                void collector.dispose();
            }, 'ftshare-settings: FT 日志采集器');
            // 回填内置缓冲里残留的 error/info（warn/debug 已被默认门槛丢弃，不可恢复）。
            const buffered = ctx.logger.buffer.filter(message => message.type === 'error' || message.type === 'info');
            void collector.backfill(buffered);
            return { service, rpcMethods: createLogsRpcMethods(service) };
        },
    });
}
