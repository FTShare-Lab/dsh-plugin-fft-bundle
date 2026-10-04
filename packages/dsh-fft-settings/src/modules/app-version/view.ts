/**
 * Update state → card copy and availability.
 *
 * Kept pure and React-free so every phase's mapping can be asserted directly
 * (spec 1.9 table, spec 2.10 degradation matrix) without a DOM.
 */

import { FTSHARE_SETTINGS_SECTION } from '../../contract.js'
import type { ShellAppInfo, ShellUpdateCapability, ShellUpdateState } from '../../shell.js'

export type UpdateActionId = 'check' | 'download' | 'install' | 'skip'

export interface UpdateControl {
  /** Stable identity for list keys and tests. */
  readonly id: string
  readonly label: string
  readonly enabled: boolean
  /** Absent when the control only reports state. */
  readonly action?: UpdateActionId
}

export interface UpdateView {
  readonly primary: UpdateControl
  readonly extra: readonly UpdateControl[]
  /** Result or reason line under the controls; never empty and never `undefined`. */
  readonly status: string
  readonly tone: 'normal' | 'error'
  /** What the platform wants said before an install it supports; absent when silent. */
  readonly advisory?: string
}

const PENDING_REASON = '正在读取版本与更新能力…'
const UNSUPPORTED_FALLBACK = '当前环境不支持应用内更新'

/** `非凸金融终端 vX.Y.Z`, or an explicit unknown while/if the shell cannot answer. */
export function productVersionLine(appInfo: ShellAppInfo | undefined, loaded: boolean): string {
  const version = typeof appInfo?.version === 'string' ? appInfo.version.trim() : ''
  if (version) return `${FTSHARE_SETTINGS_SECTION.label} v${version}`
  return `${FTSHARE_SETTINGS_SECTION.label}（${loaded ? '版本未知' : '正在读取版本信息…'}）`
}

/**
 * The phase mapping, plus the platform's standing notice.
 *
 * The notice hangs off the capability rather than off a phase, because it is
 * true in every phase and is exactly what the user needs before asking for a
 * download — the shell's own dialog never reaches this page (FR-13).
 */
export function describeUpdateView(state: ShellUpdateState | undefined, capability: ShellUpdateCapability | undefined): UpdateView {
  const view = describePhase(state, capability)
  // Only a capability that supports installing has anything to advise about; an
  // unsupported one already says why through its reason.
  const advisory = capability?.supported === true ? trimmed(capability.advisory) : ''
  return advisory ? { ...view, advisory } : view
}

function describePhase(state: ShellUpdateState | undefined, capability: ShellUpdateCapability | undefined): UpdateView {
  if (capability === undefined) return unavailable(PENDING_REASON)
  if (!capability.supported) return unavailable(trimmed(capability.reason) || UNSUPPORTED_FALLBACK)
  const version = trimmed(state?.availableVersion)
  const target = version ? ` v${version}` : ''
  switch (state?.phase) {
    case 'checking':
      return view(control('primary', '正在检查更新…', false), [], '正在向更新源查询新版本…')
    case 'not-available':
      return view(control('primary', '已是最新版本', false), [], '当前版本已是更新源上的最新版本。')
    case 'available':
      return view(
        control('primary', '下载', true, 'download'),
        [control('skip', '跳过此版本', true, 'skip')],
        version ? `发现新版本 v${version}` : '发现新版本',
      )
    case 'downloading':
      return view(
        control('primary', `正在下载${target}…${percentSuffix(state?.percent)}`, false),
        [],
        '下载在后台进行，可继续使用应用。',
      )
    case 'downloaded':
      return view(control('primary', `重启以安装${target}`.trim(), true, 'install'), [], '下载已完成，重启后由安装器完成安装。')
    case 'installing':
      return view(control('primary', '正在退出并安装…', false), [], '应用即将退出，安装完成后会自动重启。')
    case 'error':
      return view(control('primary', '重试', true, 'check'), [], `更新失败：${trimmed(state?.message) || '原因未知'}`, 'error')
    default:
      return view(control('primary', '检查更新', true, 'check'), [], '更新只会在你确认后下载与安装。')
  }
}

/** Updates unavailable: the version stays visible, the entry is disabled and the reason is stated. */
function unavailable(reason: string): UpdateView {
  return view(control('primary', '检查更新', false), [], reason)
}

/** Every value reaching the card is validated here, so a malformed push cannot throw mid-render. */
function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function control(id: string, label: string, enabled: boolean, action?: UpdateActionId): UpdateControl {
  return action === undefined ? { id, label, enabled } : { id, label, enabled, action }
}

function view(primary: UpdateControl, extra: readonly UpdateControl[], status: string, tone: UpdateView['tone'] = 'normal'): UpdateView {
  return { primary, extra, status, tone }
}

function percentSuffix(percent: number | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return ''
  return ` ${Math.min(100, Math.max(0, Math.round(percent)))}%`
}
