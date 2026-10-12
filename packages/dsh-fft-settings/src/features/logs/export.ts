/**
 * 导出物组装（Host 侧）：读主日志与配置的 sources，拼成单个 `.log` 文本。
 *
 * 体积上限按规格 §9：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`；
 * 超限按“保留最新”截断，并在 header 标注 `truncated=true`。
 */

import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  LOGS_EXPORT_MAX_BYTES,
  LOGS_FILE_SUFFIX,
  LOGS_MAX_SOURCE_FILES,
  LOGS_SECTION_RULE,
  LOGS_SOURCE_MAX_BYTES,
  type LogsSourceSummary,
  type LogsSourceState,
} from './contract.js'
import { byteLength, formatDownloadFileName, formatLogTimestamp } from './format.js'
import { resolveSourcePath } from './home.js'

const TIMESTAMP_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2})\s/

/**
 * 单文件导出选项：来源定义（与诊断包共用的 {@link LoadExportOptions}）加上 header 元信息。
 */
export interface ExportOptions extends LoadExportOptions {
  readonly homeDisplay: string
  readonly pluginVersion: string
  readonly now?: () => number
  readonly environment?: string
}

export interface ExportResult {
  readonly text: string
  readonly fileName: string
  readonly bytes: number
  readonly truncated: boolean
  readonly summaries: readonly LogsSourceSummary[]
}

/** 读来源只用到这两项；诊断包复用同一加载过程。 */
export interface LoadExportOptions {
  /** 主日志文件（`current.log`）的绝对路径。 */
  readonly filePath: string
  /** 配置里的额外来源（原样，可能带 `~`）。 */
  readonly sources: readonly string[]
}

/** 一次封装后的来源内容；`content` 已按上限截断。 */
export interface LoadedSource {
  readonly summary: LogsSourceSummary
  readonly content: string
}

/** 加载结果：来源清单加正文，以及整体是否被截断。 */
export interface LoadedExport {
  readonly loaded: readonly LoadedSource[]
  readonly truncated: boolean
}

/** 渲染导出文本所需的元信息（时间戳由调用方给定，保证同一份导出只有一个生成时间）。 */
export interface RenderExportOptions {
  readonly loaded: readonly LoadedSource[]
  readonly truncated: boolean
  readonly generatedAt: number
  readonly homeDisplay: string
  readonly pluginVersion: string
  readonly environment?: string
}

/** 尾读一个文件，最多 `maxBytes` 字节；超出时丢掉首个不完整行。 */
export async function readTail(path: string, maxBytes: number): Promise<{ text: string; truncated: boolean; size: number }> {
  const size = (await stat(path)).size
  if (size <= maxBytes) return { text: await readFile(path, 'utf8'), truncated: false, size }
  const handle = await open(path, 'r')
  try {
    const buffer = new Uint8Array(maxBytes)
    await handle.read(buffer, 0, maxBytes, size - maxBytes)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    const firstBreak = text.indexOf('\n')
    return { text: firstBreak === -1 ? text : text.slice(firstBreak + 1), truncated: true, size }
  } finally {
    await handle.close()
  }
}

/** 读文件尾部最近的 N 行；同时受字节上限约束。 */
export async function readTailLines(path: string, lines: number, maxBytes: number): Promise<{ lines: string[]; bytes: number; truncated: boolean; fileBytes: number }> {
  const { text, truncated, size } = await readTail(path, maxBytes)
  const all = text.split('\n').filter(line => line.length > 0)
  const kept = all.slice(Math.max(0, all.length - lines))
  return {
    lines: kept,
    bytes: kept.reduce((total, line) => total + byteLength(line) + 1, 0),
    truncated: truncated || kept.length < all.length,
    fileBytes: size,
  }
}

/** 统计正文的行数与时间范围（时间戳取行首北京时间）。 */
export function summarizeContent(text: string): { lines: number; firstAt?: string; lastAt?: string } {
  let lines = 0
  let firstAt: string | undefined
  let lastAt: string | undefined
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    lines += 1
    const match = TIMESTAMP_PREFIX.exec(line)
    if (match === null) continue
    firstAt ??= match[1]
    lastAt = match[1]
  }
  return { lines, firstAt, lastAt }
}

/** 目录展开成 `*.log` 文件（按修改时间倒序，最多 20 个）。 */
async function expandDirectory(directory: string): Promise<string[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith(LOGS_FILE_SUFFIX))
  const stamped = await Promise.all(names.map(async name => {
    const path = join(directory, name)
    try {
      return { path, mtime: (await stat(path)).mtimeMs }
    } catch {
      return { path, mtime: 0 }
    }
  }))
  stamped.sort((left, right) => right.mtime - left.mtime)
  return stamped.slice(0, LOGS_MAX_SOURCE_FILES).map(item => item.path)
}

/** 判断配置的来源当前形态；目录会被展开成文件清单（最多 20 个）。 */
export async function resolveSource(rawPath: string): Promise<{ state: LogsSourceState; files: readonly string[] }> {
  const path = resolveSourcePath(rawPath)
  try {
    const info = await stat(path)
    if (info.isDirectory()) {
      const files = await expandDirectory(path)
      return { state: { path, kind: 'directory', files: files.length }, files }
    }
    return { state: { path, kind: 'file', bytes: info.size }, files: [path] }
  } catch {
    return { state: { path, kind: 'missing' }, files: [] }
  }
}

/** 各来源的存在性快照，供设置页展示。 */
export async function describeSources(sources: readonly string[]): Promise<LogsSourceState[]> {
  return await Promise.all(sources.map(async source => (await resolveSource(source)).state))
}

/** 导出物 header 与 manifest 共用的四条覆盖盲区（规格 §5）。 */
export const LOG_BLIND_SPOTS = [
  '采集器挂载前的极短窗口（毫秒级，只有模块加载期日志）：只回填了 cordis 缓冲里残留的 error/info，warn/debug 不可恢复。',
  '没有桌面壳 log bridge 的环境（纯 dsh web）：MCP/Python 子进程的 stderr 只在启动它的终端里，不含在导出物中。',
  '渲染进程（浏览器）日志：DSH 未提供回传通道，不含。',
  '不走 logger 的失败：直接 console.*、只通过事件或只体现在返回值的失败，logger 通道看不到。',
]

/**
 * 按规格 §9 的封顶语义读取主日志与额外来源：单来源 2 MiB、合计 8 MiB、目录最多 20 个 `*.log`。
 *
 * 单文件导出与诊断包共用这一步，两者的 `truncated` 语义因此完全一致。
 * @param options - 主日志路径与配置的额外来源。
 * @returns 每个来源的统计与正文，以及整体是否截断。
 */
export async function loadLogExport(options: LoadExportOptions): Promise<LoadedExport> {
  const primaryLabel = 'FT 插件日志（本进程 cordis）'
  const loaded: LoadedSource[] = []
  let truncated = false
  let remaining = LOGS_EXPORT_MAX_BYTES

  const push = async (label: string, path: string, missing = false): Promise<void> => {
    if (missing) {
      loaded.push({
        summary: { label, path, lines: 0, bytes: 0, truncated: false, missing: true },
        content: '',
      })
      return
    }
    let tail: { text: string; truncated: boolean }
    try {
      tail = await readTail(path, Math.min(LOGS_SOURCE_MAX_BYTES, Math.max(0, remaining)))
    } catch {
      // 文件不存在（例如本次进程还没写过日志）不是错误：按空来源处理。
      loaded.push({ summary: { label, path, lines: 0, bytes: 0, truncated: false, missing: true }, content: '' })
      return
    }
    const { text, truncated: cut } = tail
    const size = byteLength(text)
    const { lines, firstAt, lastAt } = summarizeContent(text)
    if (cut) truncated = true
    remaining -= size
    loaded.push({
      summary: { label, path, lines, bytes: size, firstAt, lastAt, truncated: cut },
      content: text,
    })
  }

  await push(primaryLabel, options.filePath)
  for (const source of options.sources) {
    const { state, files } = await resolveSource(source)
    if (remaining <= 0) {
      truncated = true
      loaded.push({
        summary: { label: `额外来源（未纳入）`, path: state.path, lines: 0, bytes: 0, truncated: true },
        content: '',
      })
      continue
    }
    if (state.kind === 'missing') {
      await push('额外来源（文件不存在）', state.path, true)
      continue
    }
    if (state.kind === 'directory' && files.length === 0) {
      await push('额外来源（目录下没有 *.log）', state.path, true)
      continue
    }
    for (const file of files) await push(`额外来源${files.length > 1 ? `（目录 ${basename(state.path)}）` : ''}`, file)
  }
  return { loaded, truncated }
}

/** 拼装导出文本：header（来源清单、条数、时间范围、truncated、盲区）+ 来源段落。 */
export function renderLogExport(options: RenderExportOptions): { text: string; bytes: number } {
  const header = [
    '# ===== FT 运行日志 =====',
    `# 生成时间：${formatLogTimestamp(options.generatedAt)}`,
    `# 插件版本：@ft/dsh-fft-settings ${options.pluginVersion}`,
    `# 运行时：${options.environment ?? process.version}`,
    `# 日志目录：${options.homeDisplay}/logs/ft`,
    `# 导出上限：单来源 ${LOGS_SOURCE_MAX_BYTES / 1024 / 1024} MiB、合计 ${LOGS_EXPORT_MAX_BYTES / 1024 / 1024} MiB、目录最多 ${LOGS_MAX_SOURCE_FILES} 个 *${LOGS_FILE_SUFFIX}`,
    `# truncated=${options.truncated}`,
    '# 来源：',
    ...options.loaded.map((item, index) => {
      const s = item.summary
      if (s.missing === true) return `#   ${index + 1}. ${s.label} ${s.path}（缺失）`
      const range = s.firstAt === undefined ? '时间范围=空' : `时间范围=${s.firstAt} ~ ${s.lastAt}`
      return `#   ${index + 1}. ${s.label} ${s.path} 条数=${s.lines} 字节=${s.bytes} ${range}${s.truncated ? ' truncated=true' : ''}`
    }),
    '# 覆盖盲区：',
    LOG_BLIND_SPOTS.map(line => `#   - ${line}`).join('\n'),
    '',
  ].join('\n')

  const body = options.loaded
    .filter(item => item.summary.missing !== true)
    .map(item => `${LOGS_SECTION_RULE} ${item.summary.label}: ${item.summary.path} ${LOGS_SECTION_RULE}\n${item.content.replace(/\n?$/, '\n')}`)
    .join('\n')

  const text = `${header}${body}`
  return { text, bytes: byteLength(text) }
}

/** 单文件导出：加载 + 渲染，附文件名与各来源统计。 */
export async function buildLogExport(options: ExportOptions): Promise<ExportResult> {
  const generatedAt = (options.now ?? Date.now)()
  const { loaded, truncated } = await loadLogExport(options)
  const { text, bytes } = renderLogExport({
    loaded,
    truncated,
    generatedAt,
    homeDisplay: options.homeDisplay,
    pluginVersion: options.pluginVersion,
    environment: options.environment,
  })
  return {
    text,
    fileName: formatDownloadFileName(generatedAt),
    bytes,
    truncated,
    summaries: loaded.map(item => item.summary),
  }
}
