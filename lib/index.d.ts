/**
 * Host entry for the FT workbench composition bundle.
 *
 * The bundle's substance stays its `cordis.patch.yml`: it is what installs the
 * plugin set. This module adds the one thing a composition layer can own that
 * no member plugin can — a read-only answer to "is this installation complete,
 * and which part is not". It serves that answer on an exact Fetch route the
 * browser half reads from a card in the existing FT settings page.
 *
 * Everything is lazy and optional: the route appears with `connection`, and a
 * missing service inside a read lands in that field of the payload instead of
 * taking the row down. A composition layer must never be the reason the plugins
 * it installs fail to load.
 * @module @dsh-ft/finance-all-in-one
 */
import { type PackageLookupLike, type WorkbenchHostLike, type WorkbenchStatus } from './status.js';
export * from './status.js';
/** Package name the Loader and the plugin manager show. */
export declare const name = "@dsh-ft/finance-all-in-one";
/** Scope of one exact Fetch route: the fields the host registry reads. */
interface FetchRouteLike {
    readonly path: string;
    readonly methods: readonly string[];
    readonly requestBody: 'buffered';
    readonly fetch: (request: Request) => Promise<Response>;
}
/** One inject scope, as cordis hands it to the callback. */
interface InjectScopeLike {
    get(name: string): unknown;
    effect(setup: () => () => unknown, label?: string): unknown;
}
/** Plugin context slice this bundle reads; every optional member is feature-detected. */
export interface WorkbenchContext extends WorkbenchHostLike {
    get(name: string): unknown;
    pluginPackages?: PackageLookupLike;
    inject(names: readonly string[], callback: (scope: InjectScopeLike) => void): unknown;
}
/**
 * Build the exact route the card reads.
 * @param collect - produces one status read; it never rejects.
 * @returns the route the host connection registry accepts.
 */
export declare function createWorkbenchRoute(collect: () => Promise<WorkbenchStatus>): FetchRouteLike;
/**
 * Attach the workbench status route.
 *
 * The route is the bundle's only runtime contribution: it registers with the
 * connection service, so a profile without that service simply has no route.
 * @param ctx - the plugin context.
 */
export declare function apply(ctx: WorkbenchContext): void;
//# sourceMappingURL=index.d.ts.map