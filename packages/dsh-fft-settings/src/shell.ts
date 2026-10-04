/**
 * Reader for the desktop shell bridge injected by the Electron preload script.
 *
 * Contract: `docs/specs/desktop-auto-update/spec.md` §2.9 in the parent workspace.
 * This module is browser-safe by requirement (FR-15): no Node built-ins, no host
 * imports, and no assumption that `window` exists, so every consumer — settings
 * cards and other plugins alike — shares one reading of the shell protocol.
 */

/** Global injected by the desktop shell; deliberately unrelated to DSH core bridge names. */
export const SHELL_BRIDGE_GLOBAL = 'dshFft' as const

/** Bridge shape this reader understands; the shell increments it when the shape changes. */
export const SHELL_BRIDGE_PROTOCOL_VERSION = 1 as const

/** Phase set is fixed by the spec: "unsupported" is a capability, never a phase. */
export type ShellUpdatePhase = 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'

export interface ShellAppInfo {
  readonly productName: string
  readonly version: string
  readonly platform: string
  readonly packaged: boolean
}

export interface ShellUpdateState {
  readonly phase: ShellUpdatePhase
  readonly currentVersion: string
  readonly availableVersion?: string
  /** 0–100, meaningful while `phase === 'downloading'`. */
  readonly percent?: number
  readonly message?: string
  readonly manual: boolean
}

export interface ShellUpdateCapability {
  readonly supported: boolean
  /** Why updates are unavailable; present exactly when `supported` is false. */
  readonly reason?: string
  /** What the platform wants said before an install it does support. */
  readonly advisory?: string
}

export type ShellUpdateListener = (state: ShellUpdateState) => void

export interface ShellBridge {
  readonly protocolVersion: number
  readonly app: { getInfo(): Promise<ShellAppInfo> }
  readonly updates: {
    getCapability(): Promise<ShellUpdateCapability>
    getState(): Promise<ShellUpdateState>
    /** Calls the listener once with the current state, then again on every change. */
    subscribe(listener: ShellUpdateListener): () => void
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
    skip(): Promise<void>
  }
}

declare global {
  interface Window {
    /** Desktop shell bridge; absent when the settings page runs in a plain browser. */
    readonly dshFft?: ShellBridge
  }
}

/** Without a desktop runtime the version is unknowable and updates cannot run (spec 2.10). */
export const NO_SHELL_CAPABILITY: ShellUpdateCapability = Object.freeze({ supported: false, reason: '当前环境不提供版本信息' })

/** The four whitelisted actions; accepted, never answered. */
export type ShellUpdateAction = 'check' | 'download' | 'install' | 'skip'

export interface ShellReader {
  /** True only when a shape-valid bridge of a compatible protocol version was found. */
  readonly available: boolean
  appInfo(): Promise<ShellAppInfo | undefined>
  capability(): Promise<ShellUpdateCapability>
  state(): Promise<ShellUpdateState | undefined>
  /** Push subscription; a no-op unsubscribe when the shell is absent. */
  subscribe(listener: ShellUpdateListener): () => void
  /** The outcome arrives through {@link subscribe}, so this deliberately returns nothing. */
  act(action: ShellUpdateAction): void
}

const UPDATE_PHASES: readonly string[] = ['idle', 'checking', 'not-available', 'available', 'downloading', 'downloaded', 'installing', 'error']
const UPDATE_METHODS: readonly string[] = ['getCapability', 'getState', 'subscribe', 'check', 'download', 'install', 'skip']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasFunctions(value: Record<string, unknown>, names: readonly string[]): boolean {
  return names.every(name => typeof value[name] === 'function')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Structural check: a partial or malformed global must degrade, not throw. */
export function isShellBridge(value: unknown): value is ShellBridge {
  if (!isRecord(value) || typeof value.protocolVersion !== 'number' || !Number.isFinite(value.protocolVersion)) return false
  if (!isRecord(value.app) || !hasFunctions(value.app, ['getInfo'])) return false
  return isRecord(value.updates) && hasFunctions(value.updates, UPDATE_METHODS)
}

export function isShellUpdateState(value: unknown): value is ShellUpdateState {
  if (!isRecord(value)) return false
  return typeof value.currentVersion === 'string' && typeof value.manual === 'boolean' && UPDATE_PHASES.includes(value.phase as string)
}

/** Reads the injected global; undefined in a plain browser or any non-browser context. */
export function readShellBridge(): ShellBridge | undefined {
  const scope: unknown = typeof window === 'undefined' ? undefined : window
  if (!isRecord(scope)) return undefined
  const candidate = scope[SHELL_BRIDGE_GLOBAL]
  return isShellBridge(candidate) ? candidate : undefined
}

/**
 * Wrap shell access so callers never have to probe, and never have to handle a
 * missing desktop runtime. `resolve` is injectable so tests (and embedders that
 * own the global) can supply a bridge without touching `window`.
 */
export function createShellReader(resolve: () => ShellBridge | undefined = readShellBridge): ShellReader {
  const current = (): ShellBridge | undefined => { try { return resolve() } catch { return undefined } }

  const protocolProblem = (bridge: ShellBridge): ShellUpdateCapability | undefined => bridge.protocolVersion === SHELL_BRIDGE_PROTOCOL_VERSION
    ? undefined
    : { supported: false, reason: `桌面壳桥协议不兼容（本插件支持 ${SHELL_BRIDGE_PROTOCOL_VERSION}，桌面壳为 ${bridge.protocolVersion}）` }

  return {
    get available() {
      const bridge = current()
      return bridge !== undefined && protocolProblem(bridge) === undefined
    },
    async appInfo() {
      const bridge = current()
      if (!bridge) return undefined
      try {
        const info = await bridge.app.getInfo()
        if (!isRecord(info) || typeof info.version !== 'string') return undefined
        return { productName: text(info.productName), version: info.version, platform: text(info.platform), packaged: info.packaged === true }
      } catch { return undefined }
    },
    async capability() {
      const bridge = current()
      if (!bridge) return NO_SHELL_CAPABILITY
      const problem = protocolProblem(bridge)
      if (problem) return problem
      try {
        const value = await bridge.updates.getCapability()
        if (!isRecord(value) || typeof value.supported !== 'boolean') return { supported: false, reason: '桌面壳未返回更新能力信息' }
        // An advisory has to survive the trip: it is the only thing that tells
        // this page an install it does support may still be refused.
        const advisory = text(value.advisory).trim()
        return {
          supported: value.supported,
          ...(value.reason === undefined ? {} : { reason: String(value.reason) }),
          ...(advisory ? { advisory } : {}),
        }
      } catch { return { supported: false, reason: '读取更新能力失败' } }
    },
    async state() {
      const bridge = current()
      if (!bridge) return undefined
      try {
        const value = await bridge.updates.getState()
        return isShellUpdateState(value) ? value : undefined
      } catch { return undefined }
    },
    subscribe(listener) {
      const bridge = current()
      if (!bridge) return () => {}
      try {
        const unsubscribe = bridge.updates.subscribe(next => {
          // A listener fault must not break the shell's push loop.
          try { if (isShellUpdateState(next)) listener(next) } catch { /* ignored */ }
        })
        if (typeof unsubscribe !== 'function') return () => {}
        return () => { try { unsubscribe() } catch { /* ignored */ } }
      } catch { return () => {} }
    },
    act(action) {
      const bridge = current()
      if (!bridge) return
      const method = bridge.updates[action]
      if (typeof method !== 'function') return
      try {
        // Actions are accepted, not answered: a rejection here carries no result.
        void Promise.resolve(method.call(bridge.updates)).catch(() => {})
      } catch { /* ignored */ }
    },
  }
}
