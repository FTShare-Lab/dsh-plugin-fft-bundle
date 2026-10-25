/**
 * Generic half of the settings contract: the seam's identity, its transport
 * constants, and the service shape. It carries no feature vocabulary — a
 * feature's own contract lives beside that feature and merges into
 * {@link FtshareSettingsNamespaces}.
 */
import type { FtshareSettingsModuleRegistry } from './module-registry.js';
export type { FtshareSettingsModuleRegistry, SettingsModule, SettingsRegistration } from './module-registry.js';
export type { SettingsRpcMethod, SettingsRpcMethods } from './rpc-core.js';
/** Protocol version of the settings route and envelope. */
export declare const FTSHARE_SETTINGS_API_VERSION: 1;
/**
 * Identity of the settings section that carries this plugin's cards.
 *
 * The id replaces the old `ftshare`. The label is a neutral product name, not
 * the internal brand: the page ships publicly, and the data source it
 * integrates is named inside the cards instead.
 */
export declare const FTSHARE_SETTINGS_SECTION: {
    readonly id: "dsh-fft";
    readonly order: 120;
    readonly label: "金融终端";
};
/**
 * Child slot of {@link FTSHARE_SETTINGS_SECTION} that carries its cards.
 *
 * The section declares the slot when it registers; every card — ours and a
 * third party's — contributes through it with `id`/`order`/`label`, and
 * `order` (ascending, default 100) decides the card's position.
 */
export declare const FTSHARE_SETTINGS_CARD_SLOT: "ftshare.settings.card";
/**
 * Browser-facing route for this plugin's settings calls.
 *
 * It sits below `/api` so the shared connection carrier applies the Host/Origin
 * fence and browser authentication before dispatch; this plugin only handles
 * the call itself.
 */
export declare const FTSHARE_SETTINGS_ROUTE: "/api/ftshare-settings";
/** Largest request body accepted on {@link FTSHARE_SETTINGS_ROUTE}. */
export declare const FTSHARE_SETTINGS_MAX_BODY_BYTES: number;
/**
 * Merge point for namespaces a package reads but does not produce. A producer
 * gets its type from `register` inference; a consumer that reads someone
 * else's namespace declares one line, e.g. `cockpit: CockpitSettings`. Each
 * built-in feature merges its own line from its own feature directory.
 */
export interface FtshareSettingsNamespaces {
}
/**
 * Host service published as `ctx.ftshareSettings`.
 *
 * `apiVersion` and `modules` are permanent; every other member appears only
 * while its namespace is registered, so consumers must read properties at call
 * time instead of caching them during their own apply.
 */
export type FtshareSettingsService = {
    readonly apiVersion: typeof FTSHARE_SETTINGS_API_VERSION;
    readonly modules: FtshareSettingsModuleRegistry;
} & {
    readonly [N in keyof FtshareSettingsNamespaces & string]: FtshareSettingsNamespaces[N];
};
