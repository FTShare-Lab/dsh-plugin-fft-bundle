/**
 * 失败现场与目录漂移的进程内聚合（`ftshare_status` 的数据源）。
 *
 * 为什么在内存里：日志是给导出用的长文本，模型问「为什么取不到」时没有便宜的读法；
 * 一个按指纹聚合的环形账本能把「同一个 429 打了几千次、首次/末次是什么、原文是什么」
 * 一次答完。它只记事实，不做归因，也不主动联网。
 * @module @dsh-ft/dsh-fft-ftshare/status
 */

import { loadCatalog } from './catalog-host.js'
import type { FtshareToolInfo } from './contract.js'
import { hashText } from './errors.js'

/** 最多保留的失败指纹数；超出按最后出现时间淘汰。 */
const MAX_FAILURES = 50

/** 存进账本的原文上限；完整原文在日志与当次工具结果里。 */
const MESSAGE_MAX = 500

/** 一个失败指纹的聚合记录。 */
export interface FailureRecord {
  fingerprint: string
  /** 最近一次失败的接口名。 */
  tool: string
  state: 'denied' | 'failed'
  code?: string
  status?: number
  /** 最近一次的上游原文/事实说明。 */
  message: string
  /** 命中次数。 */
  count: number
  /** 首次出现时间（ISO）。 */
  firstAt: string
  /** 最近一次出现时间（ISO）。 */
  lastAt: string
  /** 最近一次耗时。 */
  lastDurationMs: number
}

/** 记一条失败所需的输入。 */
export interface FailureInput {
  fingerprint: string
  tool: string
  state: 'denied' | 'failed'
  code?: string
  status?: number
  message: string
  durationMs: number
  /** 事件时间；默认当前时间。 */
  at?: Date
}

/** 目录漂移的观测结果：随包快照 vs 上游实时清单。 */
export interface CatalogObservation {
  /** 随包目录条目数。 */
  shippedCount: number
  /** 随包目录的规范化哈希。 */
  shippedHash: string
  /** 上游实时清单条目数；还没拉过时为 undefined。 */
  liveCount?: number
  /** 上游实时清单的规范化哈希。 */
  liveHash?: string
  /** 是否与随包快照不一致。 */
  changed?: boolean
  /** 最近一次检查时间（ISO）。 */
  checkedAt?: string
}

/** `ftshare_status` 的快照。 */
export interface StatusSnapshot {
  /** 失败指纹，按次数从多到少。 */
  failures: FailureRecord[]
  /** 目录漂移观测。 */
  catalog: CatalogObservation
  /** 进程启动以来记录到的失败总次数。 */
  totalFailures: number
  /** 账本创建时间（ISO）。 */
  since: string
}

/** 失败账本：服务写、状态工具读；测试可以 new 一个隔离实例。 */
export interface FailureStore {
  /**
   * 记一次失败。
   * @param input - 失败事实。
   * @returns 聚合后的记录与「是否首次出现」。
   */
  recordFailure(input: FailureInput): { record: FailureRecord; isNew: boolean }
  /**
   * 记一次目录检查。
   * @param live - 上游实时清单。
   */
  recordCatalog(live: readonly FtshareToolInfo[]): void
  /** 读快照（拷贝，调用方改不到账本）。 */
  snapshot(): StatusSnapshot
  /** 清空账本（测试用）。 */
  clear(): void
}

/** 按字段名排序的稳定序列化，用于目录哈希。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** 一条目录/清单条目的规范化文本；两侧用同一个形状才能直接比哈希。 */
function canonicalLine(entry: { name: string; title: string; description?: string; inputSchema?: unknown }): string {
  return stableStringify({
    name: entry.name,
    title: entry.title,
    description: entry.description ?? '',
    inputSchema: entry.inputSchema ?? null,
  })
}

/** 随包目录的条目数与哈希（懒算一次）。 */
let shippedCatalog: { count: number; hash: string } | undefined

/**
 * 随包目录的规范化摘要。
 * @returns 条目数与哈希。
 */
export function shippedCatalogSummary(): { count: number; hash: string } {
  if (shippedCatalog !== undefined) return shippedCatalog
  const entries = loadCatalog().entries
  const hash = hashText(entries.map(entry => canonicalLine(entry)).sort().join('\n'))
  shippedCatalog = { count: entries.length, hash }
  return shippedCatalog
}

/** 随包目录的初始观测（还没拉上游清单）。 */
function shippedObservation(): CatalogObservation {
  const shipped = shippedCatalogSummary()
  return { shippedCount: shipped.count, shippedHash: shipped.hash }
}

/**
 * 造一个失败账本。
 * @returns 空账本。
 */
export function createFailureStore(): FailureStore {
  const failures = new Map<string, FailureRecord>()
  const since = new Date().toISOString()
  let total = 0
  let catalog: CatalogObservation = shippedObservation()

  const evict = (): void => {
    if (failures.size <= MAX_FAILURES) return
    const oldest = [...failures.values()].sort((left, right) => left.lastAt.localeCompare(right.lastAt))[0]
    if (oldest !== undefined) failures.delete(oldest.fingerprint)
  }

  return {
    recordFailure(input) {
      const at = (input.at ?? new Date()).toISOString()
      const existing = failures.get(input.fingerprint)
      total += 1
      if (existing === undefined) {
        const record: FailureRecord = {
          fingerprint: input.fingerprint,
          tool: input.tool,
          state: input.state,
          ...input.code !== undefined ? { code: input.code } : {},
          ...input.status !== undefined ? { status: input.status } : {},
          message: input.message.slice(0, MESSAGE_MAX),
          count: 1,
          firstAt: at,
          lastAt: at,
          lastDurationMs: input.durationMs,
        }
        failures.set(input.fingerprint, record)
        evict()
        return { record: { ...record }, isNew: true }
      }
      existing.tool = input.tool
      existing.state = input.state
      existing.code = input.code
      existing.status = input.status
      existing.message = input.message.slice(0, MESSAGE_MAX)
      existing.count += 1
      existing.lastAt = at
      existing.lastDurationMs = input.durationMs
      return { record: { ...existing }, isNew: false }
    },

    recordCatalog(live) {
      const hash = hashText(live.map(tool => canonicalLine({
        name: tool.tool,
        title: tool.title,
        ...tool.description !== undefined ? { description: tool.description } : {},
        ...tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {},
      })).sort().join('\n'))
      catalog = {
        ...shippedObservation(),
        liveCount: live.length,
        liveHash: hash,
        changed: hash !== catalog.shippedHash,
        checkedAt: new Date().toISOString(),
      }
    },

    snapshot() {
      return {
        failures: [...failures.values()].sort((left, right) => right.count - left.count).map(record => ({ ...record })),
        catalog: { ...catalog },
        totalFailures: total,
        since,
      }
    },

    clear() {
      failures.clear()
      total = 0
      catalog = shippedObservation()
    },
  }
}

/** 进程级账本：服务写、`ftshare_status` 读。 */
export const statusStore: FailureStore = createFailureStore()
