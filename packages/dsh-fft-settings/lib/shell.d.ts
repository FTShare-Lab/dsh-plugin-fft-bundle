/**
 * Reader for the desktop shell bridge injected by the Electron preload script.
 *
 * Contract: `docs/specs/desktop-auto-update/spec.md` §2.9 in the parent workspace.
 * This module is browser-safe by requirement (FR-15): no Node built-ins, no host
 * imports, and no assumption that `window` exists, so every consumer — settings
 * cards and other plugins alike — shares one reading of the shell protocol.
 */
/** Global injected by the desktop shell; deliberately unrelated to DSH core bridge names. */
export declare const SHELL_BRIDGE_GLOBAL: "dshFft";
/** Bridge shape this reader understands; the shell increments it when the shape changes. */
export declare const SHELL_BRIDGE_PROTOCOL_VERSION: 1;
/** Phase set is fixed by the spec: "unsupported" is a capability, never a phase. */
export type ShellUpdatePhase = 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
export interface ShellAppInfo {
    readonly productName: string;
    readonly version: string;
    readonly platform: string;
    readonly packaged: boolean;
}
export interface ShellUpdateState {
    readonly phase: ShellUpdatePhase;
    readonly currentVersion: string;
    readonly availableVersion?: string;
    /** 0–100, meaningful while `phase === 'downloading'`. */
    readonly percent?: number;
    readonly message?: string;
    readonly manual: boolean;
}
export interface ShellUpdateCapability {
    readonly supported: boolean;
    /** Why updates are unavailable; present exactly when `supported` is false. */
    readonly reason?: string;
    /** What the platform wants said before an install it does support. */
    readonly advisory?: string;
}
export type ShellUpdateListener = (state: ShellUpdateState) => void;
export interface ShellBridge {
    readonly protocolVersion: number;
    readonly app: {
        getInfo(): Promise<ShellAppInfo>;
    };
    readonly updates: {
        getCapability(): Promise<ShellUpdateCapability>;
        getState(): Promise<ShellUpdateState>;
        /** Calls the listener once with the current state, then again on every change. */
        subscribe(listener: ShellUpdateListener): () => void;
        check(): Promise<void>;
        download(): Promise<void>;
        install(): Promise<void>;
        skip(): Promise<void>;
    };
}
declare global {
    interface Window {
        /** Desktop shell bridge; absent when the settings page runs in a plain browser. */
        readonly dshFft?: ShellBridge;
    }
}
/** Without a desktop runtime the version is unknowable and updates cannot run (spec 2.10). */
export declare const NO_SHELL_CAPABILITY: ShellUpdateCapability;
/** The four whitelisted actions; accepted, never answered. */
export type ShellUpdateAction = 'check' | 'download' | 'install' | 'skip';
export interface ShellReader {
    /** True only when a shape-valid bridge of a compatible protocol version was found. */
    readonly available: boolean;
    appInfo(): Promise<ShellAppInfo | undefined>;
    capability(): Promise<ShellUpdateCapability>;
    state(): Promise<ShellUpdateState | undefined>;
    /** Push subscription; a no-op unsubscribe when the shell is absent. */
    subscribe(listener: ShellUpdateListener): () => void;
    /** The outcome arrives through {@link subscribe}, so this deliberately returns nothing. */
    act(action: ShellUpdateAction): void;
}
/** Structural check: a partial or malformed global must degrade, not throw. */
export declare function isShellBridge(value: unknown): value is ShellBridge;
export declare function isShellUpdateState(value: unknown): value is ShellUpdateState;
/** Reads the injected global; undefined in a plain browser or any non-browser context. */
export declare function readShellBridge(): ShellBridge | undefined;
/**
 * Wrap shell access so callers never have to probe, and never have to handle a
 * missing desktop runtime. `resolve` is injectable so tests (and embedders that
 * own the global) can supply a bridge without touching `window`.
 */
export declare function createShellReader(resolve?: () => ShellBridge | undefined): ShellReader;
