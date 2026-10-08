import { type ReactNode } from 'react';
import { type SubscribeChanges, type ApiKeyPublicApi } from '../../contract.js';
export declare const apiKeyCard: import("../../card-registry.js").SettingsCard;
export declare function FtshareSettingsSection({ api, subscribeChanges }: {
    readonly api: ApiKeyPublicApi;
    readonly subscribeChanges?: SubscribeChanges;
}): ReactNode;
