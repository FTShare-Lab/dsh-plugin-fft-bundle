/**
 * Workbench readiness: what the installed composition actually carries.
 *
 * The card this feeds answers one question a user cannot answer from the panels
 * it sits beside — "this install looks complete, why is a piece missing?" So
 * everything here is observation, never control: no network, no credential
 * read, no settings write. Each fact has one cheap, local source:
 *
 * - rows: the root Loader entries. A row missing there never mounted; the
 *   preset's rows are mounted in a detached subtree and are reported by the
 *   preset's own diagnostic instead.
 * - installed versions: the profile's package resolution (`ctx.pluginPackages`),
 *   the same table the Loader uses to import the row. The declared specifiers and
 *   the bundle's own version come from the build-generated `manifest.js`: a
 *   `link:` checkout has no `node_modules` above it and the profile's resolution
 *   answers every dependency but never the requester.
 * - preset: the `agentPresets` registry's own list, which already audits a
 *   broken definition and returns the failing rows as text.
 *
 * Deliberately absent: the FTShare key status (the API Key card owns it), the
 * paper ledger (the panel owns it), and any request count (nothing in this
 * process counts them).
 * @module @dsh-ft/finance-all-in-one/status
 */
/** Package whose manifest declares the composition this status describes. */
export declare const BUNDLE_NAME = "@dsh-ft/finance-all-in-one";
/** Preset the composition registers as the finance working mode. */
export declare const FINANCE_PRESET_ID = "ft-finance";
/** Exact Fetch route the browser half reads. */
export declare const WORKBENCH_ROUTE = "/api/ft-workbench";
/** One dependency of the composition, as declared and as installed. */
export interface PackageStatus {
    /** Package name. */
    name: string;
    /** Display title per interface language, from the package's own locale resources. */
    title?: Record<string, string>;
    /** Specifier the bundle manifest declares. */
    declared: string;
    /** Installed version, when the profile resolves the package. */
    installed?: string;
    /**
     * `aligned`: the installed version satisfies the declared specifier.
     * `mismatch`: it does not.
     * `missing`: the profile cannot resolve the package at all.
     * `unchecked`: a repository edge (`git+…`, `link:`, `file:`), where registry
     * version semantics do not apply — the source tree or tarball decides it.
     */
    state: 'aligned' | 'mismatch' | 'missing' | 'unchecked';
}
/** One row the composition is supposed to mount globally. */
export interface RowStatus {
    /** Row id in the patch layer. */
    id: string;
    /** Package (or subpath) the row names. */
    name: string;
    /** Loader ids of the entries currently carrying that name. */
    entryIds: string[];
    /** `mounted` covers the disabled parent case through `LoaderEntry.disabled`. */
    state: 'mounted' | 'disabled' | 'missing';
}
/** The finance preset as the registry sees it. */
export interface PresetStatus {
    id: string;
    /**
     * `ready`: registered and usable.
     * `broken`: registered, but its composition reports unusable rows (detail).
     * `missing`: the registry is live and does not list it.
     * `unavailable`: this profile has no preset registry.
     */
    state: 'ready' | 'broken' | 'missing' | 'unavailable';
    /** Whether new sessions select it by default. */
    isDefault: boolean;
    /** Registry diagnostic for a broken definition; never guessed here. */
    detail?: string;
}
/** Everything one card read returns. */
export interface WorkbenchStatus {
    /** ISO timestamp of this read. */
    checkedAt: string;
    bundle: {
        name: string;
        version?: string;
    };
    packages: PackageStatus[];
    rows: RowStatus[];
    preset: PresetStatus;
}
/** One Loader entry, structurally — the fields this module reads. */
export interface LoaderEntryLike {
    options?: {
        id?: string;
        name?: string;
        disabled?: boolean | null;
    };
    disabled?: boolean;
    fiber?: unknown;
}
/** Slice of `ctx.pluginPackages` this module reads. */
export interface PackageLookupLike {
    packageOf(specifier: string, parentUrl: string): {
        version?: string;
        manifest?: Record<string, unknown>;
    } | undefined;
    metaOf?(specifier: string, parentUrl: string): {
        title?: string;
    } | undefined;
}
/** Slice of `ctx.agentPresets` this module reads. */
export interface PresetRegistryLike {
    list?(): Promise<readonly {
        id?: string;
        broken?: string;
    }[]>;
    defaultId?: string;
}
/**
 * Host context slice.
 *
 * Only `get` is read: cordis refuses a direct service property access from a
 * row that did not declare that service in its inject list, and this row must
 * mount with no inject at all (a composition layer may not become the reason
 * the plugins it installs stop loading).
 */
export interface WorkbenchHostLike {
    get?(name: string): unknown;
}
/**
 * Rows the composition mounts on the global plane. The preset's own rows live
 * in its detached subtree and are audited by the registry instead, so they are
 * not listed here.
 */
export declare const GLOBAL_ROW_TARGETS: readonly {
    id: string;
    name: string;
}[];
/** Whether a registry range admits `version`; undefined when this module cannot tell. */
export declare function specAllows(spec: string, version: string): boolean | undefined;
/** Read the finance preset through the registry's own audit. */
export declare function presetStatus(host: WorkbenchHostLike): Promise<PresetStatus>;
/**
 * Collect one read of the workbench status.
 * @param host - the plugin context, narrowed to the services this module reads.
 * @param baseUrl - module URL the dependency lookup resolves against.
 * @returns the status; a failed probe never rejects — it lands in the field.
 */
export declare function collectWorkbenchStatus(host: WorkbenchHostLike, baseUrl: string): Promise<WorkbenchStatus>;
//# sourceMappingURL=status.d.ts.map