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
import { manifest as declaredManifest } from './manifest.js';
/** Package whose manifest declares the composition this status describes. */
export const BUNDLE_NAME = '@dsh-ft/finance-all-in-one';
/** Preset the composition registers as the finance working mode. */
export const FINANCE_PRESET_ID = 'ft-finance';
/** Exact Fetch route the browser half reads. */
export const WORKBENCH_ROUTE = '/api/ft-workbench';
/**
 * Rows the composition mounts on the global plane. The preset's own rows live
 * in its detached subtree and are audited by the registry instead, so they are
 * not listed here.
 */
export const GLOBAL_ROW_TARGETS = [
    { id: 'dsh-fft-settings', name: '@dsh-ft/dsh-fft-settings' },
    { id: 'dsh-fft-ftshare', name: '@dsh-ft/dsh-fft-ftshare' },
    { id: 'dsh-kline-sidebar', name: '@ftshare-lab/dsh-kline' },
    { id: 'ft-paper-trading', name: '@dsh-ft/dsh-fft-paper-trading' },
    { id: 'preset-ft-finance', name: '@deepseek-ai/dsh-agent-preset' },
    { id: 'finance-all-in-one', name: BUNDLE_NAME },
];
/** Longest the registry may take before this read reports it unavailable. */
const PRESET_TIMEOUT_MS = 3000;
/** Repository edges: their specifier is not a registry range. */
const REPOSITORY_SPEC = /^(?:git\+|git@|github:|gitlab:|bitbucket:|gist:|https?:|file:|link:|workspace:|path:)/iu;
/** Parse a plain `x.y.z` (prerelease ignored); undefined for ranges and specifiers. */
function parseVersion(text) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(text.trim());
    if (match === null)
        return undefined;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
/** Compare two parsed versions. */
function compareVersions(left, right) {
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
/** Whether a registry range admits `version`; undefined when this module cannot tell. */
export function specAllows(spec, version) {
    if (REPOSITORY_SPEC.test(spec.trim()))
        return undefined;
    const parsed = parseVersion(version);
    if (parsed === undefined)
        return undefined;
    const text = spec.trim();
    const exact = parseVersion(text);
    if (exact !== undefined)
        return compareVersions(parsed, exact) === 0;
    const caret = /^\^(\d+\.\d+\.\d+)/u.exec(text);
    if (caret !== null) {
        const base = parseVersion(caret[1]);
        if (compareVersions(parsed, base) < 0)
            return false;
        // `^0.y.z` is constrained to the same minor; every other major keeps itself.
        return base[0] === 0 ? parsed[1] === base[1] : parsed[0] === base[0];
    }
    const tilde = /^~(\d+\.\d+\.\d+)/u.exec(text);
    if (tilde !== null) {
        const base = parseVersion(tilde[1]);
        return compareVersions(parsed, base) >= 0 && parsed[0] === base[0] && parsed[1] === base[1];
    }
    const atLeast = /^>=(\d+\.\d+\.\d+)/u.exec(text);
    if (atLeast !== null) {
        return compareVersions(parsed, parseVersion(atLeast[1])) >= 0;
    }
    return undefined;
}
/** Message of an unknown thrown value. */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** One package lookup that never throws: a broken resolution is a missing package. */
function packageOf(host, name, baseUrl) {
    try {
        return host.get?.('pluginPackages')?.packageOf(name, baseUrl);
    }
    catch {
        return undefined;
    }
}
/** Normalize a host title (a localized map or a bare string) to non-empty language entries. */
function normalizeTitle(value) {
    if (typeof value === 'string')
        return value.trim() === '' ? undefined : { en: value.trim() };
    if (typeof value !== 'object' || value === null)
        return undefined;
    const entries = Object.entries(value).flatMap(([language, text]) => typeof text === 'string' && text.trim() !== '' ? [[language, text.trim()]] : []);
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
/**
 * A resolution base inside the profile.
 *
 * Presenting a dependency's own locale resources must resolve through the
 * profile's map: a linked checkout's dependencies that this repository does not
 * develop against (plot lives in another repo) have no `node_modules` edge above
 * this module, so the host's resolver answers nothing for them from here.
 * @returns the profile's Package.json URL, or undefined outside a profile.
 */
function profileBaseUrl(host) {
    try {
        const profile = host.get?.('profileContext');
        if (typeof profile?.dir !== 'string' || profile.dir === '')
            return undefined;
        const encoded = profile.dir.split('/').map(segment => encodeURIComponent(segment)).join('/');
        return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}/package.json`;
    }
    catch {
        return undefined;
    }
}
/** The package's own display title, through the host's metadata reader. */
function titleOf(host, name, baseUrl) {
    try {
        const meta = host.get?.('pluginPackages')?.metaOf?.(name, baseUrl);
        return normalizeTitle(meta?.title);
    }
    catch {
        return undefined;
    }
}
/** Read the composition's dependency statuses. */
function packageStatuses(host, baseUrl) {
    // Titles resolve against the profile, where every declared dependency lives.
    const metaBase = profileBaseUrl(host) ?? baseUrl;
    const dependencies = declaredManifest.dependencies;
    const statuses = [];
    for (const [name, declared] of Object.entries(dependencies)) {
        if (typeof declared !== 'string')
            continue;
        const installed = packageOf(host, name, baseUrl)?.version;
        // Repository edges ship from this very tree; their specifier has no version.
        if (REPOSITORY_SPEC.test(declared.trim())) {
            const title = titleOf(host, name, metaBase);
            statuses.push({ name, declared, ...(installed === undefined ? {} : { installed }), ...(title === undefined ? {} : { title }), state: 'unchecked' });
            continue;
        }
        if (installed === undefined) {
            const title = titleOf(host, name, metaBase);
            statuses.push({ name, declared, ...(title === undefined ? {} : { title }), state: 'missing' });
            continue;
        }
        const allowed = specAllows(declared, installed);
        const state = allowed === true ? 'aligned' : allowed === false ? 'mismatch' : 'unchecked';
        const title = titleOf(host, name, metaBase);
        statuses.push({ name, declared, installed, ...(title === undefined ? {} : { title }), state });
    }
    return statuses;
}
/** Read the global rows' mount state. */
function rowStatuses(host) {
    const entries = [...(host.get?.('loader')?.entries?.() ?? [])];
    return GLOBAL_ROW_TARGETS.map(target => {
        const matches = entries.filter(entry => entry.options?.name === target.name);
        const entryIds = matches.flatMap(entry => {
            const id = entry.options?.id;
            return typeof id === 'string' ? [id] : [];
        });
        const disabled = matches.length > 0 && matches.every(entry => entry.disabled === true);
        const state = matches.length === 0 ? 'missing' : disabled ? 'disabled' : 'mounted';
        return { id: target.id, name: target.name, entryIds, state };
    });
}
/** Race a promise against the registry timeout. */
async function withTimeout(task, ms, message) {
    let timer;
    try {
        return await Promise.race([
            task,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(message)), ms);
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
/** Read the finance preset through the registry's own audit. */
export async function presetStatus(host) {
    const registry = host.get?.('agentPresets');
    if (registry === undefined || typeof registry.list !== 'function') {
        return { id: FINANCE_PRESET_ID, state: 'unavailable', isDefault: false };
    }
    let rows;
    try {
        rows = await withTimeout(registry.list(), PRESET_TIMEOUT_MS, 'preset registry did not answer in time');
    }
    catch (error) {
        return { id: FINANCE_PRESET_ID, state: 'unavailable', isDefault: false, detail: errorMessage(error) };
    }
    const row = rows.find(entry => entry.id === FINANCE_PRESET_ID);
    if (row === undefined)
        return { id: FINANCE_PRESET_ID, state: 'missing', isDefault: false };
    const detail = typeof row.broken === 'string' && row.broken.trim() !== '' ? row.broken.trim() : undefined;
    return {
        id: FINANCE_PRESET_ID,
        state: detail === undefined ? 'ready' : 'broken',
        isDefault: registry.defaultId === FINANCE_PRESET_ID,
        ...(detail === undefined ? {} : { detail }),
    };
}
/**
 * Collect one read of the workbench status.
 * @param host - the plugin context, narrowed to the services this module reads.
 * @param baseUrl - module URL the dependency lookup resolves against.
 * @returns the status; a failed probe never rejects — it lands in the field.
 */
export async function collectWorkbenchStatus(host, baseUrl) {
    return {
        checkedAt: new Date().toISOString(),
        bundle: { name: BUNDLE_NAME, version: declaredManifest.version },
        packages: packageStatuses(host, baseUrl),
        rows: rowStatuses(host),
        preset: await presetStatus(host),
    };
}
