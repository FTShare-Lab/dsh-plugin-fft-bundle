/**
 * FT 运行日志采集器（Host 侧，不依赖 cordis，便于单测）。
 *
 * 职责：接收 cordis exporter 的记录 → 节流合并 → 脱敏 → 追加 `$DSH_HOME/logs/ft/current.log`，
 * 超限轮转、保留 `keep` 份；写失败 / 轮转 / 丢弃一律自报 stderr，绝不抛回业务插件。
 */

import { appendFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LOGS_CURRENT_FILE,
  LOGS_FILE_SUFFIX,
  LOGS_LINE_MAX_BYTES,
  LOGS_MAX_PENDING_KEYS,
  LOGS_REPEAT_FIELD,
  LOGS_ROTATED_PREFIX,
  LOGS_SECRET_TTL_MS,
  LOGS_THROTTLE_WINDOW_MS,
  LOG_LEVEL_THRESHOLD,
  type LogLevelName,
} from './contract.js'
import { byteLength, formatLogLine, formatLogMessage, formatRotationFileName, redactSecrets, truncateLine } from './format.js'

/** 采集器接受的最小记录形状；cordis 的 `Message` 结构上满足它。 */
export interface CollectorRecord {
  readonly ts: number
  readonly type: LogLevelName
  readonly name: string
  readonly args: readonly unknown[]
}

export interface CollectorOptions {
  /** 落盘目录，通常是 `$DSH_HOME/logs/ft`。 */
  readonly directory: string
  readonly level: LogLevelName
  readonly maxBytes: number
  readonly keep: number
  /** 已知密钥（如当前 FTShare Key）的延时提供者；取不到时按空处理。 */
  readonly secrets?: () => Promise<readonly string[]>
  readonly fileName?: string
  /** 注入时钟，便于测试。 */
  readonly now?: () => number
  /** 注入定时器；返回取消函数。默认 `setTimeout().unref()`，不阻止进程退出。 */
  readonly schedule?: (run: () => void, delayMs: number) => () => void
  /** 自报通道；默认写 stderr。日志系统不能静默失败。 */
  readonly selfReport?: (message: string) => void
}

export interface CollectorSnapshot {
  readonly filePath: string
  readonly fileBytes: number
  readonly records: number
  readonly dropped: number
  readonly rotations: number
  readonly writeFailures: number
  readonly firstTs?: number
  readonly lastTs?: number
  readonly byName: Readonly<Record<string, number>>
}

interface PendingEntry {
  /** 已格式化（未脱敏、未加重复次数）的单行。 */
  readonly body: string
  readonly name: string
  readonly ts: number
  count: number
  firstTs: number
}

const defaultSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return () => clearTimeout(timer)
}

const defaultSelfReport = (message: string): void => {
  try {
    process.stderr.write(`[ft-logs] ${message}\n`)
  } catch {
    // 连 stderr 都写不进去时只能放弃自报，绝不能因此影响业务插件。
  }
}

/** 常驻采集器；生命周期由调用方（cordis `ctx.effect`）负责关闭。 */
export class FtLogCollector {
  readonly filePath: string
  readonly threshold: number
  private readonly directory: string
  private readonly options: CollectorOptions
  private readonly now: () => number
  private readonly schedule: (run: () => void, delayMs: number) => () => void
  private readonly report: (message: string) => void
  private readonly pending = new Map<string, PendingEntry>()
  private readonly byName = new Map<string, number>()
  private chain: Promise<void> = Promise.resolve()
  private ready: Promise<void> | undefined
  private cancelTimer: (() => void) | undefined
  private timerDeadline = 0
  private bytes = 0
  private records = 0
  private dropped = 0
  private rotations = 0
  private writeFailures = 0
  private firstTs: number | undefined
  private lastTs: number | undefined
  private cachedSecrets: readonly string[] = []
  private secretsAt = 0
  private closed = false

  constructor(options: CollectorOptions) {
    this.options = options
    this.directory = options.directory
    this.filePath = join(options.directory, options.fileName ?? LOGS_CURRENT_FILE)
    this.threshold = LOG_LEVEL_THRESHOLD[options.level]
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? defaultSchedule
    this.report = options.selfReport ?? defaultSelfReport
  }

  /** 接收一条 cordis 记录：同 key 在 10 秒窗口内合并为一行并累计重复次数。 */
  append(record: CollectorRecord): void {
    if (this.closed) return
    // 级别门槛在 cordis 侧已经过滤过一次，这里再兜一层：即使 exporter 的 levels 配错也不会写进文件。
    if (LOG_LEVEL_THRESHOLD[record.type] > this.threshold) return
    // 采集器绝不能把异常抛回业务插件的 logger 调用。
    try {
      const at = this.now()
      // key 不含时间戳：同一消息在不同毫秒打出也必须合并。
      const text = formatLogMessage(record.args)
      const key = `${record.type}\u0000${record.name}\u0000${text}`
      const existing = this.pending.get(key)
      if (existing !== undefined && at - existing.firstTs < LOGS_THROTTLE_WINDOW_MS) {
        existing.count += 1
        return
      }
      this.sweep(at)
      if (this.pending.size >= LOGS_MAX_PENDING_KEYS) this.dropOldest()
      this.pending.set(key, { body: formatLogLine(record), name: record.name, ts: record.ts, count: 1, firstTs: at })
      this.armTimer(at)
    } catch (error) {
      this.writeFailures += 1
      this.report(`格式化日志失败：${error instanceof Error ? error.message : String(error)}；累计失败 ${this.writeFailures} 次`)
    }
  }

  /** 注册时回填 cordis 内置缓冲里剩余的 `error`/`info`（`warn`/`debug` 已丢，不可恢复）。 */
  async backfill(records: readonly CollectorRecord[]): Promise<void> {
    for (const record of records) this.append(record)
    await this.flush()
  }

  /** 把队列全部落盘（导出前调用），等待写入链结束。 */
  async flush(): Promise<void> {
    this.cancel()
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) this.enqueue(entry)
    await this.ready
    await this.chain
  }

  /** 关闭句柄与队列；之后 `append` 变为空操作。 */
  async dispose(): Promise<void> {
    await this.flush()
    this.closed = true
    this.cancel()
  }

  stats(): CollectorSnapshot {
    return {
      filePath: this.filePath,
      fileBytes: this.bytes,
      records: this.records,
      dropped: this.dropped,
      rotations: this.rotations,
      writeFailures: this.writeFailures,
      firstTs: this.firstTs,
      lastTs: this.lastTs,
      byName: Object.fromEntries(this.byName),
    }
  }

  /** 当前已知密钥（带 TTL 缓存，避免每次写盘都解析凭据）。 */
  private async currentSecrets(): Promise<readonly string[]> {
    if (this.options.secrets === undefined) return []
    const at = this.now()
    if (this.secretsAt !== 0 && at - this.secretsAt < LOGS_SECRET_TTL_MS) return this.cachedSecrets
    try {
      this.cachedSecrets = (await this.options.secrets()).filter(secret => secret.length >= 6)
    } catch {
      // 取不到密钥时退化为纯模式脱敏，绝不能因此阻断写入。
      this.cachedSecrets = []
    }
    this.secretsAt = at
    return this.cachedSecrets
  }

  private armTimer(at: number): void {
    const earliest = Math.min(...[...this.pending.values()].map(entry => entry.firstTs))
    const deadline = earliest + LOGS_THROTTLE_WINDOW_MS
    if (this.cancelTimer !== undefined && this.timerDeadline <= deadline) return
    this.cancel()
    this.timerDeadline = deadline
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = undefined
      this.sweep(this.now())
    }, Math.max(0, deadline - at))
  }

  private cancel(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.timerDeadline = 0
  }

  /** 把窗口已过期的待写条目交给写入链（保持插入顺序）。 */
  private sweep(at: number): void {
    for (const [key, entry] of [...this.pending]) {
      if (at - entry.firstTs < LOGS_THROTTLE_WINDOW_MS) continue
      this.pending.delete(key)
      this.enqueue(entry)
    }
  }

  private dropOldest(): void {
    const oldest = this.pending.keys().next()
    if (oldest.done === true) return
    const entry = this.pending.get(oldest.value)
    this.pending.delete(oldest.value)
    this.dropped += entry?.count ?? 1
    this.report(`待写队列超过 ${LOGS_MAX_PENDING_KEYS} 条，丢弃最旧记录；累计丢弃 ${this.dropped} 条`)
  }

  private enqueue(entry: PendingEntry): void {
    this.chain = this.chain.then(async () => {
      if (this.closed) return
      try {
        const secrets = await this.currentSecrets()
        const repeat = entry.count > 1 ? ` ${LOGS_REPEAT_FIELD}=${entry.count}` : ''
        const line = truncateLine(redactSecrets(entry.body, secrets) + repeat, LOGS_LINE_MAX_BYTES)
        await this.write(line, entry)
      } catch (error) {
        this.writeFailures += 1
        this.report(`写入 ${this.filePath} 失败：${error instanceof Error ? error.message : String(error)}；累计失败 ${this.writeFailures} 次`)
      }
    })
  }

  private async write(line: string, entry: PendingEntry): Promise<void> {
    this.ready ??= mkdir(this.directory, { recursive: true }).then(async () => {
      try {
        this.bytes = (await stat(this.filePath)).size
      } catch {
        this.bytes = 0
      }
    })
    await this.ready
    const payload = `${line}\n`
    const size = byteLength(payload)
    if (this.bytes > 0 && this.bytes + size > this.options.maxBytes) await this.rotate()
    await appendFile(this.filePath, payload, 'utf8')
    this.bytes += size
    this.records += 1
    this.firstTs = this.firstTs === undefined ? entry.ts : Math.min(this.firstTs, entry.ts)
    this.lastTs = this.lastTs === undefined ? entry.ts : Math.max(this.lastTs, entry.ts)
    this.byName.set(entry.name, (this.byName.get(entry.name) ?? 0) + 1)
  }

  private async rotate(): Promise<void> {
    const target = await this.uniqueRotationPath()
    try {
      await rename(this.filePath, target)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== 'ENOENT') throw error
    }
    this.bytes = 0
    this.rotations += 1
    this.report(`日志轮转：${target}（保留最近 ${this.options.keep} 份）`)
    await this.prune()
  }

  /** 同一毫秒内可能连续轮转两次（小 maxBytes + 突发），文件名必须唯一，否则会互相覆盖。 */
  private async uniqueRotationPath(): Promise<string> {
    const base = formatRotationFileName(this.now())
    for (let suffix = 1; suffix < 1_000; suffix += 1) {
      const candidate = join(this.directory, suffix === 1 ? base : base.replace(/\.log$/, `-${suffix}.log`))
      try {
        await stat(candidate)
      } catch {
        return candidate
      }
    }
    return join(this.directory, base)
  }

  /** 保留策略按修改时间（而不是文件名）排序：同一毫秒连转时的 `-N` 后缀不影响新旧判断。 */
  private async prune(): Promise<void> {
    const names = (await readdir(this.directory))
      .filter(name => name.startsWith(LOGS_ROTATED_PREFIX) && name.endsWith(LOGS_FILE_SUFFIX))
    const stamped = await Promise.all(names.map(async name => {
      const path = join(this.directory, name)
      try {
        return { path, mtime: (await stat(path)).mtimeMs }
      } catch {
        return { path, mtime: 0 }
      }
    }))
    stamped.sort((left, right) => left.mtime - right.mtime)
    const excess = stamped.slice(0, Math.max(0, stamped.length - this.options.keep))
    for (const item of excess) await unlink(item.path).catch(() => undefined)
  }
}
