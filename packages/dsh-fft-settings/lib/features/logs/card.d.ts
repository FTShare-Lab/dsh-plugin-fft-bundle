import { type ReactNode } from 'react';
import { type LogsPublicApi } from './contract.js';
import type { FtshareSettingsShellContext } from '../../core/shell.js';
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
