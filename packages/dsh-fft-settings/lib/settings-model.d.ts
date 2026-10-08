import { type ApiKeyPublicApi, type ApiKeyStatus, type ConfigureResult, type SubscribeChanges } from './contract.js';
export interface SettingsState {
    status?: ApiKeyStatus;
    busy: boolean;
    message: string;
    statusError?: string;
    save?: ConfigureResult['save'];
}
export declare class FtshareSettingsModel {
    private api;
    private state;
    private listeners;
    private request;
    private lifetime;
    constructor(api: ApiKeyPublicApi);
    getSnapshot: () => SettingsState;
    subscribe: (listener: () => void) => (() => void);
    private update;
    connect(subscribe?: SubscribeChanges): () => void;
    refresh(): Promise<void>;
    configureAndTest(input: string): Promise<boolean>;
    testConnection(): Promise<void>;
    clear(): Promise<void>;
}
