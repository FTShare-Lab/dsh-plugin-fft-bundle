import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { LOGS_ARCHIVE_ROUTE, LOGS_CARD_ID, LOGS_CARD_ORDER, LOGS_DEFAULT_PREVIEW_LINES, LOGS_MAX_PREVIEW_LINES, } from './contract.js';
import { createLogsClient } from './client-api.js';
import { createSettingsTransport } from '../../core/client-transport.js';
import { FTSHARE_SETTINGS_CARD_SLOT } from '../../core/contract.js';
import { LOGS_CARD_CSS } from './styles.js';
/** 预览行数候选：上限由 Host 侧校验兜底。 */
const PREVIEW_CHOICES = [50, LOGS_DEFAULT_PREVIEW_LINES, LOGS_MAX_PREVIEW_LINES];
/**
 * 快照缺失时的占位文案。
 *
 * 失败后不能继续写「读取中…」：那会把一次已经结束的失败说成正在进行的读取，掩盖真正的
 * 原因（例如宿主插件没有这个接口，重试永远不会成功）。
 * @param failed - 本次读取是否已经失败。
 * @returns 失败提示，或仍在读取的提示。
 */
export function statsPlaceholder(failed) {
    return failed ? '读取失败' : '读取中…';
}
function displayBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
/** 把文本包成 Blob，用 a[download] 触发下载（Web 与桌面同一套）。 */
function downloadText(fileName, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
/**
 * Contribute the built-in runtime-log card through the same slot a third-party
 * card uses. Nothing about it is privileged: same declaration, same options.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the card registration.
 */
export function registerLogsCard(ctx) {
    return ctx.slots.inject(FTSHARE_SETTINGS_CARD_SLOT, () => ctx.slots.register({ name: FTSHARE_SETTINGS_CARD_SLOT, id: LOGS_CARD_ID, order: LOGS_CARD_ORDER }, createLogsCard()));
}
/** Bind the card's adapter; the component only reads through it. */
function createLogsCard() {
    const api = createLogsClient(createSettingsTransport());
    return () => _jsx(LogsSection, { api: api });
}
export function LogsSection({ api }) {
    const [stats, setStats] = useState();
    const [preview, setPreview] = useState();
    const [lines, setLines] = useState(LOGS_DEFAULT_PREVIEW_LINES);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    /** 读取已失败且还没有任何快照时，每个字段都必须说出来，而不是假装还在读。 */
    const placeholder = statsPlaceholder(error !== '');
    const refresh = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            setStats(await api.stats());
            setPreview(await api.preview(lines));
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : '读取日志状态失败');
        }
        finally {
            setBusy(false);
        }
    }, [api, lines]);
    useEffect(() => { void refresh(); }, [refresh]);
    const doExport = async () => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await api.export();
            downloadText(result.fileName, result.text);
            setMessage(`已导出 ${result.fileName}（${displayBytes(result.bytes)}${result.truncated ? '，已达体积上限并截断' : ''}）`);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : '导出日志失败');
        }
        finally {
            setBusy(false);
        }
    };
    return _jsxs(_Fragment, { children: [_jsx("style", { children: LOGS_CARD_CSS }), _jsxs("section", { className: "ftshare-settings", "aria-label": "FT \u8FD0\u884C\u65E5\u5FD7", "aria-busy": busy, children: [_jsx("header", { children: _jsxs("div", { children: [_jsx("span", { className: "ftshare-eyebrow", children: "FTSHARE / LOGS" }), _jsx("h2", { children: "\u8FD0\u884C\u65E5\u5FD7" })] }) }), _jsxs("div", { className: "ftshare-card", children: [_jsx("h3", { children: "\u91C7\u96C6\u72B6\u6001" }), _jsxs("dl", { children: [_jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u65E5\u5FD7\u6587\u4EF6" }), _jsx("dd", { children: stats?.file ?? placeholder })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u8BB0\u5F55 / \u65F6\u95F4\u8303\u56F4" }), _jsxs("dd", { children: [stats === undefined ? placeholder : `${stats.records} 条`, stats?.firstAt !== undefined && `（${stats.firstAt} ~ ${stats.lastAt}）`] })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u6587\u4EF6\u5927\u5C0F / \u4E0A\u9650" }), _jsx("dd", { children: stats === undefined ? placeholder : `${displayBytes(stats.fileBytes)} / ${displayBytes(stats.maxBytes)}` })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u4E22\u5F03 / \u8F6E\u8F6C / \u5199\u5931\u8D25" }), _jsx("dd", { children: stats === undefined ? placeholder : `${stats.dropped} / ${stats.rotations} / ${stats.writeFailures}` })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u65E5\u5FD7\u7EA7\u522B" }), _jsxs("dd", { children: [stats?.level ?? placeholder, " "] })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u7EDF\u8BA1" }), _jsx("dd", { children: stats === undefined
                                                    ? placeholder
                                                    : Object.keys(stats.byName).length === 0
                                                        ? '暂无'
                                                        : Object.entries(stats.byName).map(([name, count]) => `${name}=${count}`).join('、') })] }), _jsxs("div", { className: "ftshare-result", children: [_jsx("dt", { children: "\u989D\u5916\u6765\u6E90" }), _jsx("dd", { children: stats === undefined
                                                    ? placeholder
                                                    : stats.sources.length === 0
                                                        ? '暂无'
                                                        : stats.sources.map(source => `${source.path}（${source.kind}${source.bytes === undefined ? '' : ` ${displayBytes(source.bytes)}`}）`).join('；') })] })] }), _jsxs("div", { className: "ftshare-actions", children: [_jsx("button", { className: "primary", type: "button", onClick: () => void doExport(), disabled: busy, children: "\u5BFC\u51FA\u65E5\u5FD7" }), _jsx("a", { className: "ftshare-download", href: LOGS_ARCHIVE_ROUTE, download: "", children: "\u5BFC\u51FA\u8BCA\u65AD\u5305" }), _jsx("button", { type: "button", onClick: () => void refresh(), disabled: busy, children: "\u5237\u65B0" }), _jsx("label", { htmlFor: "ftshare-log-lines", children: "\u9884\u89C8\u884C\u6570" }), _jsx("select", { id: "ftshare-log-lines", value: lines, onChange: e => setLines(Number(e.target.value)), disabled: busy, children: PREVIEW_CHOICES.map(choice => _jsx("option", { value: choice, children: choice }, choice)) })] }), busy && _jsx("p", { role: "status", children: "\u6B63\u5728\u5904\u7406\uFF0C\u8BF7\u7A0D\u5019\u2026" }), message && _jsx("p", { role: "status", children: message }), error && _jsx("p", { className: "ftshare-error", role: "alert", children: error })] }), _jsxs("div", { className: "ftshare-card", children: [_jsxs("h3", { children: ["\u6700\u8FD1\u65E5\u5FD7", preview?.truncated === true ? '（已截断）' : ''] }), preview === undefined
                                ? _jsx("p", { children: error === '' ? '正在读取…' : '日志预览读取失败，见上方提示。' })
                                : preview.lines.length === 0
                                    ? _jsx("p", { children: "\u65E0" })
                                    : _jsx("pre", { className: "ftshare-log-preview", children: preview.lines.join('\n') })] })] })] });
}
