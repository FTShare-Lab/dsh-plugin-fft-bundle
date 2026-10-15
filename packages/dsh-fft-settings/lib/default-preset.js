/**
 * Claim the finance preset as the default once per installation.
 *
 * The bundle patch already carries `default: ft-finance` on the preset
 * registry row, which decides every session on a machine that never chose a
 * default. A machine whose user *did* choose one keeps that choice, because
 * `selectedDefault` outranks `default` — this module overrides it exactly once,
 * then records the claim so a later user choice is never touched again.
 *
 * The write goes through the settings service, the same path the settings page
 * uses: only volatile fields are writable there, so the patch this module hands
 * over carries `selectedDefault` and nothing else. The row it lands in is wider
 * than that patch — the service writes the effective config's non-volatile keys
 * alongside the volatile change, so `default: ft-finance` is copied into the
 * profile row too. Because it is still the one change this plugin ever makes to
 * the user's own profile patch, the file is copied into this plugin's data
 * directory first, and a claim without that copy never happens.
 * @module @ft/dsh-fft-settings/default-preset
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveDshHome } from './features/logs/home.js';
/** The preset this bundle wants as the default. */
export const DEFAULT_PRESET_ID = 'ft-finance';
/** Id of the profile entry that owns the preset registry's config. */
export const REGISTRY_ENTRY_ID = 'agent-preset-registry';
/** Data directory this plugin owns under the DSH home. */
export const DATA_DIR_NAME = '.dsh-fft-settings';
/** File whose presence means the claim already happened on this machine. */
export const CLAIM_FILE_NAME = 'default-preset.json';
/** Snapshot of the profile patch, taken before this module's single write. */
export const BACKUP_FILE_NAME = 'cordis.patch.yml.bak';
/**
 * Record that this installation claimed the default, once.
 * @param home - the DSH home the plugin writes its own data into.
 * @returns the claim file path.
 */
export function claimFilePath(home = resolveDshHome()) {
    return join(home, DATA_DIR_NAME, CLAIM_FILE_NAME);
}
/**
 * Snapshot path for the profile patch.
 * @param home - the DSH home the plugin writes its own data into.
 * @returns the snapshot file path.
 */
export function backupFilePath(home = resolveDshHome()) {
    return join(home, DATA_DIR_NAME, BACKUP_FILE_NAME);
}
/**
 * Make `ft-finance` the default unless this machine already made a claim.
 *
 * Every step that cannot complete skips silently and retries on the next start:
 * a missing registry or settings service, a preset that is not registered yet,
 * and a failed write all leave no claim file behind. Nothing here may fail the
 * plugin's activation.
 * @param ctx - the plugin's host context.
 */
export function installDefaultPresetOnce(ctx) {
    ctx.inject(['settings', 'agentPresets'], (scope) => {
        const registry = scope.get('agentPresets');
        const settings = scope.get('settings');
        if (registry === undefined || settings === undefined)
            return;
        const profile = scope.get('profileContext');
        void claimDefaultPreset(registry, settings, profile, ctx)
            .catch((error) => {
            ctx.logger.warn('dsh-fft-settings: could not claim the default preset', error);
        });
    });
}
/**
 * Perform the one-time claim, snapshotting the file it is about to change.
 * @param registry - the live preset registry.
 * @param settings - the settings writer.
 * @param profile - the profile context, absent in a context that has no patch file.
 * @param ctx - the plugin context, used for the claim log line.
 */
async function claimDefaultPreset(registry, settings, profile, ctx) {
    const file = claimFilePath();
    if (existsSync(file))
        return;
    // An unregistered preset would pin an id that resolves to nothing, so the
    // claim waits for the composition that defines it.
    const presets = await registry.list();
    if (!presets.some(preset => preset.id === DEFAULT_PRESET_ID))
        return;
    let backup;
    if (registry.defaultId !== DEFAULT_PRESET_ID) {
        // Insurance first: the editor writes atomically and rolls back a failed
        // reconcile, but this write still lands in the user's own profile patch, so
        // a claim is only recorded once the snapshot exists.
        if (profile !== undefined)
            backup = await snapshotProfilePatch(profile.patchPath);
        await settings.update(REGISTRY_ENTRY_ID, { selectedDefault: DEFAULT_PRESET_ID });
        ctx.logger.info(`dsh-fft-settings: ${DEFAULT_PRESET_ID} is now the default preset`);
    }
    await mkdir(dirname(file), { recursive: true });
    const claim = { preset: DEFAULT_PRESET_ID, at: new Date().toISOString(), ...(backup === undefined ? {} : { backup }) };
    await writeFile(file, `${JSON.stringify(claim, null, 2)}\n`);
}
/**
 * Copy the profile patch into this plugin's data directory, once.
 *
 * A failed copy throws, and the caller aborts the claim: the write must not
 * happen without its snapshot. The first copy wins, so a retry after a failed
 * write still holds the state from before the very first attempt. A missing
 * patch file — a profile that never wrote anything — needs no copy.
 * @param patchPath - the profile's own `cordis.patch.yml`.
 * @returns the snapshot path, or `undefined` when there was nothing to copy.
 */
async function snapshotProfilePatch(patchPath) {
    if (!existsSync(patchPath))
        return undefined;
    const snapshot = backupFilePath();
    if (existsSync(snapshot))
        return snapshot;
    await mkdir(dirname(snapshot), { recursive: true });
    await copyFile(patchPath, snapshot);
    return snapshot;
}
