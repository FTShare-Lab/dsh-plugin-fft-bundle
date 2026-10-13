import { type ReactNode } from 'react';
import { type LogsPublicApi } from './contract.js';
import type { FtshareSettingsShellContext } from '../../core/shell.js';
/**
 * 快照缺失时的占位文案。
 *
 * 失败后不能继续写「读取中…」：那会把一次已经结束的失败说成正在进行的读取，掩盖真正的
 * 原因（例如宿主插件没有这个接口，重试永远不会成功）。
 * @param failed - 本次读取是否已经失败。
 * @returns 失败提示，或仍在读取的提示。
 */
export declare function statsPlaceholder(failed: boolean): string;
/**
 * Contribute the built-in runtime-log card through the same slot a third-party
 * card uses. Nothing about it is privileged: same declaration, same options.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the card registration.
 */
export declare function registerLogsCard(ctx: FtshareSettingsShellContext): () => void;
export declare function LogsSection({ api }: {
    readonly api: LogsPublicApi;
}): ReactNode;
