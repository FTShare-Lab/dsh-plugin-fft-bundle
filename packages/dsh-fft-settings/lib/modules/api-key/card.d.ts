import { type ReactNode } from 'react';
import { type SubscribeChanges, type ApiKeyPublicApi } from '../../contract.js';
import type { FtshareSettingsClientContext } from '../../shell.js';
/**
 * Contribute the built-in API Key card through the same slot a third-party
 * card uses. Nothing about it is privileged: same declaration, same options.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the card registration.
 */
export declare function registerApiKeyCard(ctx: FtshareSettingsClientContext): () => void;
export declare function ApiKeyCard({ api, subscribeChanges }: {
    readonly api: ApiKeyPublicApi;
    readonly subscribeChanges?: SubscribeChanges;
}): ReactNode;
