import type { ReactNode } from 'react';
export interface FtshareSettingsClientContext {
    remote: {
        $on(event: string, listener: (ref: string) => void): () => void;
    };
    on(event: 'connection/reset', listener: () => void): () => void;
    slots: {
        inject(name: string, callback: () => void | (() => void)): void;
        register(config: {
            name: string;
            id: string;
            order?: number;
            label?: string;
        }, component: () => ReactNode): () => void;
    };
}
export interface SettingsCard {
    readonly id: string;
    readonly order: number;
    readonly inject: readonly string[];
    /** Bind adapters here; acquire subscriptions in the component's effect. */
    createComponent(ctx: FtshareSettingsClientContext): () => ReactNode;
}
export declare function defineSettingsCard(card: SettingsCard): SettingsCard;
export declare function assembleSettingsCards(ctx: FtshareSettingsClientContext, cards: readonly SettingsCard[]): {
    id: string;
    Component: () => ReactNode;
}[];
