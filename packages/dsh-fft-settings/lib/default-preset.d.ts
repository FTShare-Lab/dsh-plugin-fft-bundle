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
 * @module @dsh-ft/dsh-fft-settings/default-preset
 */
import type { Context } from '@deepseek-ai/cordis';
/** The preset this bundle wants as the default. */
export declare const DEFAULT_PRESET_ID = "ft-finance";
/** Id of the profile entry that owns the preset registry's config. */
export declare const REGISTRY_ENTRY_ID = "agent-preset-registry";
/** Data directory this plugin owns under the DSH home. */
export declare const DATA_DIR_NAME = ".dsh-fft-settings";
/** File whose presence means the claim already happened on this machine. */
export declare const CLAIM_FILE_NAME = "default-preset.json";
/** Snapshot of the profile patch, taken before this module's single write. */
export declare const BACKUP_FILE_NAME = "cordis.patch.yml.bak";
/**
 * Record that this installation claimed the default, once.
 * @param home - the DSH home the plugin writes its own data into.
 * @returns the claim file path.
 */
export declare function claimFilePath(home?: string): string;
/**
 * Snapshot path for the profile patch.
 * @param home - the DSH home the plugin writes its own data into.
 * @returns the snapshot file path.
 */
export declare function backupFilePath(home?: string): string;
/**
 * Make `ft-finance` the default unless this machine already made a claim.
 *
 * Every step that cannot complete skips silently and retries on the next start:
 * a missing registry or settings service, a preset that is not registered yet,
 * and a failed write all leave no claim file behind. Nothing here may fail the
 * plugin's activation.
 * @param ctx - the plugin's host context.
 */
export declare function installDefaultPresetOnce(ctx: Context): void;
