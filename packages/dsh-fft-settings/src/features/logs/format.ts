/**
 * 日志行格式化与脱敏（纯函数，无 Node 依赖，浏览器半边也可导入）。
 *
 * 行格式（规格 §8）：
 * `<ISO8601+08:00> <LEVEL> <plugin-name> <message> <k=v …>`，单行上限 8 KiB。
 */

import {
  LOGS_EXPORT_FILE_PREFIX,
  LOGS_LINE_MAX_BYTES,
  LOGS_MAX_FIELD_DEPTH,
  LOGS_MAX_FIELD_LENGTH,
  LOGS_ROTATED_PREFIX,
  LOGS_TRUNCATED_MARK,
  type LogLevelName,
} from './contract.js'

const SHANGHAI = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

/** 规格固定写 +08:00，不跟随宿主机时区。 */
function shanghaiParts(ts: number): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const { type, value } of SHANGHAI.formatToParts(new Date(ts))) parts[type] = value
  return parts
}

function millis(ts: number): string {
  return String(new Date(ts).getMilliseconds()).padStart(3, '0')
}

/** 行首时间戳：`2026-10-12T15:04:05.123+08:00`。 */
export function formatLogTimestamp(ts: number): string {
  const p = shanghaiParts(ts)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${millis(ts)}+08:00`
}

/** 下载文件名时间戳：`yyyyMMdd-HHmmss`。 */
export function formatCompactStamp(ts: number): string {
  const p = shanghaiParts(ts)
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`
}

/** 轮转文件名时间戳：`2026-10-12T15-04-05-123+0800`（去掉文件系统不友好的 `:`/`.`）。 */
export function formatRotationStamp(ts: number): string {
  const p = shanghaiParts(ts)
  return `${p.year}-${p.month}-${p.day}T${p.hour}-${p.minute}-${p.second}-${millis(ts)}+0800`
}

/** 导出物文件名：`ft-runtime-<yyyyMMdd-HHmmss>.log`。 */
export function formatDownloadFileName(ts: number): string {
  return `${LOGS_EXPORT_FILE_PREFIX}${formatCompactStamp(ts)}.log`
}

/** 轮转文件名：`ft-<ISO时间戳>.log`（与当前文件名 `current.log` 不冲突）。 */
export function formatRotationFileName(ts: number): string {
  return `${LOGS_ROTATED_PREFIX}${formatRotationStamp(ts)}.log`
}

/** 文本 UTF-8 字节数（不依赖 Buffer，浏览器可用）。 */
export function byteLength(text: string): number {
  return encoder.encode(text).length
}

/** 按 UTF-8 字节截断单行，并在上限内补 `...[已截断]`。 */
export function truncateLine(line: string, maxBytes = LOGS_LINE_MAX_BYTES): string {
  if (byteLength(line) <= maxBytes) return line
  const budget = Math.max(0, maxBytes - byteLength(LOGS_TRUNCATED_MARK))
  let text = decoder.decode(encoder.encode(line).subarray(0, budget))
  // 截断点可能落在多字节字符中间，去掉 UTF-8 替换字符。
  while (text.endsWith('\uFFFD')) text = text.slice(0, -1)
  return text + LOGS_TRUNCATED_MARK
}

/** 把可能的多行文本压成单行（换行转义），保持「一条记录一行」。 */
export function singleLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\\n')
}

function clip(value: string): string {
  return value.length > LOGS_MAX_FIELD_LENGTH ? `${value.slice(0, LOGS_MAX_FIELD_LENGTH)}…` : value
}

/** 把任意值渲染成短、稳定、可读的文本；键按字典序排列以便节流合并可比。 */
export function renderValue(value: unknown, depth = 0): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  switch (typeof value) {
    case 'string': return clip(value)
    case 'number':
    case 'boolean':
    case 'bigint': return String(value)
    case 'symbol': return clip(value.toString())
    case 'function': return `[Function ${value.name || 'anonymous'}]`
    default: break
  }
  // 到这里只剩对象；Error 取 message，避免整段堆栈（堆栈由 Logger 侧的字符串参数提供）。
  if (value instanceof Error) return clip(value.message || value.name)
  if (depth >= LOGS_MAX_FIELD_DEPTH) return '[…]'
  if (Array.isArray(value)) return clip(value.map(item => renderValue(item, depth + 1)).join(','))
  const entries: string[] = []
  for (const key of Object.keys(value as object).sort()) {
    entries.push(`${key}=${renderValue((value as Record<string, unknown>)[key], depth + 1)}`)
  }
  return clip(entries.join(' '))
}

const PLACEHOLDER = /%([a-zA-Z%])/g

/**
 * 渲染一条记录的正文，语义对齐 cordis `Logger.format`：
 * 首参是 Error 时取 message，首参非字符串时当作字段对象；`%s/%d/%i/%f/%o/%O/%c/%%` 生效，
 * 对象参数统一渲染为 `k=v`（而不是 JSON），且结果恒为单行。
 */
export function formatLogMessage(args: readonly unknown[]): string {
  const rest = [...args]
  if (rest[0] instanceof Error) {
    rest[0] = rest[0].message || rest[0].name
    rest.unshift('%s')
  } else if (typeof rest[0] !== 'string') {
    rest.unshift('%o')
  }
  let format = String(rest.shift())
  format = format.replace(PLACEHOLDER, (match, char: string) => {
    if (match === '%%') return '%'
    if (!'sdifoOcC'.includes(char)) return match
    const value = rest.shift()
    switch (char) {
      case 's': case 'c': return String(value ?? '')
      case 'C': return String(value ?? '')
      case 'd': case 'i': return String(Math.trunc(Number(value)))
      case 'f': return String(Number(value))
      default: return renderValue(value)
    }
  })
  for (const arg of rest) {
    format += typeof arg === 'object' && arg !== null ? ` ${renderValue(arg)}` : ` ${String(arg)}`
  }
  return singleLine(format)
}

interface RedactionRule { readonly pattern: RegExp; readonly replacement: string }

/**
 * 脱敏规则：`Bearer`、`Authorization:`、`Cookie:`、`sk-` 形态、长 hex、`*_KEY=*` 形态。
 * 命中即整段打码，宁可多打不可漏。
 */
const REDACTION_RULES: readonly RedactionRule[] = [
  { pattern: /(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, replacement: '$1***' },
  // 只吃掉「可选 scheme + 凭据」这一段，后面的结构化字段仍保留可读性。
  { pattern: /((?:proxy-)?authorization\s*[:=]\s*)(?:\S+\s+)?\S+/gi, replacement: '$1***' },
  { pattern: /((?:set-)?cookie\s*[:=]\s*)[^\n]*/gi, replacement: '$1***' },
  { pattern: /sk-[A-Za-z0-9_-]{6,}/g, replacement: 'sk-***' },
  { pattern: /\b[0-9a-fA-F]{32,}\b/g, replacement: '***' },
  { pattern: /([A-Za-z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_-]*\s*[:=]\s*)[^\s,;'"]+/gi, replacement: '$1***' },
]

/** 当前 FTShare Key 等已知密钥的精确值替换（长度过短的值不参与，避免误伤普通文本）。 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let output = text
  for (const secret of secrets) {
    if (secret.length < 6) continue
    output = output.split(secret).join('***')
  }
  for (const rule of REDACTION_RULES) output = output.replace(rule.pattern, rule.replacement)
  return output
}

/** 组装一行：`<时间> <LEVEL> <name> <正文>`（`WARN` 之类按 5 字符对齐）。 */
export function formatLogLine(record: { ts: number; type: LogLevelName; name: string; args: readonly unknown[] }): string {
  return `${formatLogTimestamp(record.ts)} ${record.type.toUpperCase().padEnd(5)} ${record.name} ${formatLogMessage(record.args)}`
}
