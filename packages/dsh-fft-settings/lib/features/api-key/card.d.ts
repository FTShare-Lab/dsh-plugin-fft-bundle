import { type ReactNode } from 'react';
import { type SubscribeChanges, type ApiKeyPublicApi } from './contract.js';
import type { FtshareSettingsShellContext } from '../../core/shell.js';
/**
 * Browser context this card requires: the shell's slots service plus the
 * invalidations that make a cached credential status stale.
 */
export interface ApiKeyCardContext extends FtshareSettingsShellContext {
    remote: {
        $on(event: string, listener: (ref: string) => void): () => void;
    };
    on(event: 'connection/reset', listener: () => void): () => void;
}
/**
 * Contribute the built-in API Key card through the same slot a third-party
 * card uses. Nothing about it is privileged: same declaration, same options.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the card registration.
 */
export declare function registerApiKeyCard(ctx: ApiKeyCardContext): () => void;
export declare function ApiKeyCard({ api, subscribeChanges }: {
    readonly api: ApiKeyPublicApi;
    readonly subscribeChanges?: SubscribeChanges;
}): ReactNode;
