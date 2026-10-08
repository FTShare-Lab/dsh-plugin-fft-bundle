/**
 * Update state → card copy and availability.
 *
 * Kept pure and React-free so every phase's mapping can be asserted directly
 * (spec 1.9 table, spec 2.10 degradation matrix) without a DOM.
 */
import type { ShellAppInfo, ShellUpdateCapability, ShellUpdateState } from '../../shell.js';
export type UpdateActionId = 'check' | 'download' | 'install' | 'skip';
export interface UpdateControl {
    /** Stable identity for list keys and tests. */
    readonly id: string;
    readonly label: string;
    readonly enabled: boolean;
    /** Absent when the control only reports state. */
    readonly action?: UpdateActionId;
}
export interface UpdateView {
    readonly primary: UpdateControl;
    readonly extra: readonly UpdateControl[];
    /** Result or reason line under the controls; never empty and never `undefined`. */
    readonly status: string;
    readonly tone: 'normal' | 'error';
    /** What the platform wants said before an install it supports; absent when silent. */
    readonly advisory?: string;
}
/** `非凸金融终端 vX.Y.Z`, or an explicit unknown while/if the shell cannot answer. */
export declare function productVersionLine(appInfo: ShellAppInfo | undefined, loaded: boolean): string;
/**
 * The phase mapping, plus the platform's standing notice.
 *
 * The notice hangs off the capability rather than off a phase, because it is
 * true in every phase and is exactly what the user needs before asking for a
 * download — the shell's own dialog never reaches this page (FR-13).
 */
export declare function describeUpdateView(state: ShellUpdateState | undefined, capability: ShellUpdateCapability | undefined): UpdateView;
