/**
 * Reader for the desktop shell bridge injected by the Electron preload script.
 *
 * Contract: `docs/specs/desktop-auto-update/spec.md` §2.9 in the parent workspace.
 * This module is browser-safe by requirement (FR-15): no Node built-ins, no host
 * imports, and no assumption that `window` exists, so every consumer — settings
 * cards and other plugins alike — shares one reading of the shell protocol.
 */
/** Global injected by the desktop shell; deliberately unrelated to DSH core bridge names. */
export const SHELL_BRIDGE_GLOBAL = 'dshFft';
/** Bridge shape this reader understands; the shell increments it when the shape changes. */
export const SHELL_BRIDGE_PROTOCOL_VERSION = 1;
/** Without a desktop runtime the version is unknowable and updates cannot run (spec 2.10). */
export const NO_SHELL_CAPABILITY = Object.freeze({ supported: false, reason: '当前环境不提供版本信息' });
const UPDATE_PHASES = ['idle', 'checking', 'not-available', 'available', 'downloading', 'downloaded', 'installing', 'error'];
const UPDATE_METHODS = ['getCapability', 'getState', 'subscribe', 'check', 'download', 'install', 'skip'];
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function hasFunctions(value, names) {
    return names.every(name => typeof value[name] === 'function');
}
function text(value) {
    return typeof value === 'string' ? value : '';
}
/** Structural check: a partial or malformed global must degrade, not throw. */
export function isShellBridge(value) {
    if (!isRecord(value) || typeof value.protocolVersion !== 'number' || !Number.isFinite(value.protocolVersion))
        return false;
    if (!isRecord(value.app) || !hasFunctions(value.app, ['getInfo']))
        return false;
    return isRecord(value.updates) && hasFunctions(value.updates, UPDATE_METHODS);
}
export function isShellUpdateState(value) {
    if (!isRecord(value))
        return false;
    return typeof value.currentVersion === 'string' && typeof value.manual === 'boolean' && UPDATE_PHASES.includes(value.phase);
}
/** Reads the injected global; undefined in a plain browser or any non-browser context. */
export function readShellBridge() {
    const scope = typeof window === 'undefined' ? undefined : window;
    if (!isRecord(scope))
        return undefined;
    const candidate = scope[SHELL_BRIDGE_GLOBAL];
    return isShellBridge(candidate) ? candidate : undefined;
}
/**
 * Wrap shell access so callers never have to probe, and never have to handle a
 * missing desktop runtime. `resolve` is injectable so tests (and embedders that
 * own the global) can supply a bridge without touching `window`.
 */
export function createShellReader(resolve = readShellBridge) {
    const current = () => { try {
        return resolve();
    }
    catch {
        return undefined;
    } };
    const protocolProblem = (bridge) => bridge.protocolVersion === SHELL_BRIDGE_PROTOCOL_VERSION
        ? undefined
        : { supported: false, reason: `桌面壳桥协议不兼容（本插件支持 ${SHELL_BRIDGE_PROTOCOL_VERSION}，桌面壳为 ${bridge.protocolVersion}）` };
    return {
        get available() {
            const bridge = current();
            return bridge !== undefined && protocolProblem(bridge) === undefined;
        },
        async appInfo() {
            const bridge = current();
            if (!bridge)
                return undefined;
            try {
                const info = await bridge.app.getInfo();
                if (!isRecord(info) || typeof info.version !== 'string')
                    return undefined;
                return { productName: text(info.productName), version: info.version, platform: text(info.platform), packaged: info.packaged === true };
            }
            catch {
                return undefined;
            }
        },
        async capability() {
            const bridge = current();
            if (!bridge)
                return NO_SHELL_CAPABILITY;
            const problem = protocolProblem(bridge);
            if (problem)
                return problem;
            try {
                const value = await bridge.updates.getCapability();
                if (!isRecord(value) || typeof value.supported !== 'boolean')
                    return { supported: false, reason: '桌面壳未返回更新能力信息' };
                // An advisory has to survive the trip: it is the only thing that tells
                // this page an install it does support may still be refused.
                const advisory = text(value.advisory).trim();
                return {
                    supported: value.supported,
                    ...(value.reason === undefined ? {} : { reason: String(value.reason) }),
                    ...(advisory ? { advisory } : {}),
                };
            }
            catch {
                return { supported: false, reason: '读取更新能力失败' };
            }
        },
        async state() {
            const bridge = current();
            if (!bridge)
                return undefined;
            try {
                const value = await bridge.updates.getState();
                return isShellUpdateState(value) ? value : undefined;
            }
            catch {
                return undefined;
            }
        },
        subscribe(listener) {
            const bridge = current();
            if (!bridge)
                return () => { };
            try {
                const unsubscribe = bridge.updates.subscribe(next => {
                    // A listener fault must not break the shell's push loop.
                    try {
                        if (isShellUpdateState(next))
                            listener(next);
                    }
                    catch { /* ignored */ }
                });
                if (typeof unsubscribe !== 'function')
                    return () => { };
                return () => { try {
                    unsubscribe();
                }
                catch { /* ignored */ } };
            }
            catch {
                return () => { };
            }
        },
        act(action) {
            const bridge = current();
            if (!bridge)
                return;
            const method = bridge.updates[action];
            if (typeof method !== 'function')
                return;
            try {
                // Actions are accepted, not answered: a rejection here carries no result.
                void Promise.resolve(method.call(bridge.updates)).catch(() => { });
            }
            catch { /* ignored */ }
        },
    };
}
