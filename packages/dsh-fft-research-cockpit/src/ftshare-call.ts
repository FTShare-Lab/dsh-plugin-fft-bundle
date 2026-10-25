/**
 * 叶子取数函数与 FTShare 数据底座之间唯一的接缝。
 *
 * 投研舱不再自己连网关：所有取数都经 `ctx.ftshareData.call(interface, args, { signal })`
 * （见 `docs/specs/ftshare-base/design.html` §8.1）。叶子函数（`ftshare-data` /
 * `report-data` / `portfolio-recommendation` 里的取数函数）保持纯函数，只吃一个
 * {@link FtshareCaller}，**绝不接触 cordis ctx**，因此测试可以用假实现完整替换网关。
 *
 * 结局只看 {@link FtshareCallResult.state}：`empty` 才是「上游确实没有数据」，
 * `denied` 带升级入口，`failed` 是取数失败。`rows` 不是权限判据——旧实现把这三者都
 * 读成「空数组」，正是底座要治的病。
 * @module
 */

import type { Logger } from '@deepseek-ai/cordis'
import {
  FTSHARE_UPGRADE_URL,
  type FtshareCallOptions,
  type FtshareCallResult,
  type FtshareCallState,
  type FtshareDataService,
  type FtshareNotice,
} from '@dsh-ft/dsh-fft-ftshare/contract'

import type { JsonRecord, PermissionNotice } from './types.js'

/** 叶子函数依赖的最小服务面，由 `ctx.ftshareData` 提供（测试可传假实现）。 */
export type FtshareCaller = Pick<FtshareDataService, 'call'>

/** 同一份主体可以被切断的最大尝试次数：首次 + 2 次重试。 */
const MAX_ATTEMPTS = 3

/**
 * 一次取数在叶子层的读法。
 *
 * `value` 是给既有扁平化工具（`rows()` / `flattenRows()`）读的行信封：只有
 * `available` 才带数据。`gap` / `warning` 分别是写进 `dataGaps` / `warnings` 的原文，
 * 由底座的四态与 `notice` 直接派生，不在调用点上再编一遍文案。
 */
export interface FtshareOutcome {
  /** 四态结局，原样来自底座。 */
  state: FtshareCallState
  /** 可取用的行信封 `{ data: rows, metadata }`；`denied` / `failed` / `empty` 为 null。 */
  value: JsonRecord | null
  /** `available` 时的明细行。 */
  rows: JsonRecord[]
  /** `denied` 时的权限提示，已归一成报告遮罩用的 {@link PermissionNotice}。 */
  permission?: PermissionNotice
  /** 写进 `dataGaps` 的一句话。 */
  gap?: string
  /** 写进 `warnings` 的一句话。 */
  warning?: string
  /** 是否值得原样重试（限流、超时、网络抖动）。 */
  retryable: boolean
}

/** 报告侧的四本账；本包各处 `state` 参数都满足这个形状。 */
export interface FtshareLedger {
  permissions: PermissionNotice[]
  /** 权限遮罩用的账本；只需要披露权限、不需要遮罩的调用方可以不提供。 */
  blockedPermissions?: PermissionNotice[]
  dataGaps: string[]
  warnings: string[]
}

/** 订阅档位的中文名；档位只来自上游信封，本包不按接口版本号猜。 */
export const FTSHARE_PLAN_LABELS: Record<string, string> = {
  Free: '免费版',
  Basic: '基础版',
  Advanced: '进阶版',
  Pro: '专业版（Pro）',
}

/** 权限提示的去重键；`requiredPlan` 可能缺省（上游没说档位）。 */
export function permissionKey(notice: PermissionNotice): string {
  return `${notice.tool}:${notice.requiredPlan ?? ''}`
}

/** 把底座的 notice 归一成报告遮罩认得的权限提示。 */
export function permissionFromNotice(tool: string, notice: FtshareNotice): PermissionNotice {
  return {
    tool,
    code: notice.code,
    requiredPlan: notice.requiredPlan,
    message: notice.message,
    upgradeUrl: notice.upgradeUrl ?? FTSHARE_UPGRADE_URL,
  }
}

/**
 * 把底座的四态结果折成叶子层的读法。
 * @param tool - 上游接口名。
 * @param result - 底座的归一结果。
 * @returns 叶子层结局；`gap` / `warning` 文案在这一处生成。
 */
export function outcomeOf(tool: string, result: FtshareCallResult): FtshareOutcome {
  const rows = result.rows as JsonRecord[]
  const metadata: JsonRecord = { source: 'ftshare', tool, fetchedAt: result.source.fetchedAt }
  if (result.state === 'available' && rows.length > 0) {
    return { state: 'available', value: { data: rows, metadata }, rows, retryable: false }
  }
  if (result.state === 'denied') {
    const notice = result.notice
    const message = notice?.message ?? `FTShare 无权访问 ${tool}`
    return {
      state: 'denied',
      value: null,
      rows: [],
      permission: notice ? permissionFromNotice(tool, notice) : undefined,
      gap: message,
      warning: message,
      retryable: false,
    }
  }
  if (result.state === 'failed') {
    const notice = result.notice
    return {
      state: 'failed',
      value: null,
      rows: [],
      gap: `FTShare 工具调用失败：${tool}`,
      warning: notice?.message ?? `FTShare ${tool} 调用失败`,
      retryable: notice?.retryable === true,
    }
  }
  // empty：调用走通了，上游确实没有数据。这不是权限问题，也不该被说成「取数失败」。
  const message = `FTShare 数据为空：${tool}`
  return { state: 'empty', value: null, rows: [], gap: message, warning: message, retryable: false }
}

/** 重试前的退避等待。 */
async function backoff(millis: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, millis))
}

/**
 * 调一次底座接口，并把「值得重试的失败」重试到 {@link MAX_ATTEMPTS} 次。
 *
 * 底座的 `call()` 契约上不抛异常，但这里仍兜一层：一个坏掉的客户端实现不该让整份
 * 报告崩掉，它只会变成一条 `failed`。
 * @param caller - 底座服务（或测试假实现）。
 * @param tool - 上游接口名。
 * @param args - 上游入参，原样透传。
 * @param signal - 取消信号，转给底座。
 * @param logger - 具名 logger；权限与失败各记一条，便于线上定位。
 * @returns 叶子层结局。
 */
export async function callInterface(
  caller: FtshareCaller,
  tool: string,
  args: JsonRecord = {},
  signal?: AbortSignal,
  logger?: Logger,
): Promise<FtshareOutcome> {
  let outcome: FtshareOutcome | undefined
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      outcome = { state: 'failed', value: null, rows: [], gap: `FTShare 工具调用失败：${tool}`, warning: `${tool} 已取消`, retryable: false }
      break
    }
    try {
      const options: FtshareCallOptions | undefined = signal ? { signal } : undefined
      outcome = outcomeOf(tool, await caller.call(tool, args, options))
    } catch (error) {
      outcome = {
        state: 'failed',
        value: null,
        rows: [],
        gap: `FTShare 工具调用失败：${tool}`,
        warning: error instanceof Error ? error.message : String(error),
        retryable: false,
      }
    }
    if (!outcome.retryable || attempt + 1 >= MAX_ATTEMPTS) break
    await backoff(250 * (attempt + 1))
  }
  const settled = outcome as FtshareOutcome
  if (settled.state === 'denied') {
    logger?.warn('ftshare.permission_denied', {
      tool,
      code: settled.permission?.code,
      requiredPlan: settled.permission?.requiredPlan,
      errorType: 'permission_denied',
    })
  } else if (settled.state === 'failed') {
    logger?.warn('ftshare.call_failed', { tool, message: settled.warning, errorType: 'call_failed' })
  }
  return settled
}

/**
 * 把一次取数结局记进四本账。
 * @param ledger - 权限/遮罩/缺口/警告四本账。
 * @param outcome - {@link callInterface} 的结局。
 * @returns `available` 时的行信封，其余为 null。
 */
export function recordOutcome(ledger: FtshareLedger, outcome: FtshareOutcome): JsonRecord | null {
  if (outcome.permission) {
    ledger.permissions.push(outcome.permission)
    ledger.blockedPermissions?.push(outcome.permission)
  }
  if (outcome.gap) ledger.dataGaps.push(outcome.gap)
  if (outcome.warning) ledger.warnings.push(outcome.warning)
  return outcome.state === 'available' ? outcome.value : null
}
