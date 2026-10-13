import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  LOGS_ARCHIVE_ROUTE,
  LOGS_CARD_ID,
  LOGS_CARD_ORDER,
  LOGS_DEFAULT_PREVIEW_LINES,
  LOGS_MAX_PREVIEW_LINES,
  type LogsPreview,
  type LogsPublicApi,
  type LogsStats,
} from './contract.js'
import { createLogsClient } from './client-api.js'
import { createSettingsTransport } from '../../core/client-transport.js'
import { FTSHARE_SETTINGS_CARD_SLOT } from '../../core/contract.js'
import type { FtshareSettingsShellContext } from '../../core/shell.js'
import { LOGS_CARD_CSS } from './styles.js'

/** 预览行数候选：上限由 Host 侧校验兜底。 */
const PREVIEW_CHOICES = [50, LOGS_DEFAULT_PREVIEW_LINES, LOGS_MAX_PREVIEW_LINES]

/**
 * 快照缺失时的占位文案。
 *
 * 失败后不能继续写「读取中…」：那会把一次已经结束的失败说成正在进行的读取，掩盖真正的
 * 原因（例如宿主插件没有这个接口，重试永远不会成功）。
 * @param failed - 本次读取是否已经失败。
 * @returns 失败提示，或仍在读取的提示。
 */
export function statsPlaceholder(failed: boolean): string {
  return failed ? '读取失败' : '读取中…'
}

function displayBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

/** 把文本包成 Blob，用 a[download] 触发下载（Web 与桌面同一套）。 */
function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Contribute the built-in runtime-log card through the same slot a third-party
 * card uses. Nothing about it is privileged: same declaration, same options.
 * @param ctx - client context carrying the renderer's slots service.
 * @returns idempotent disposer for the card registration.
 */
export function registerLogsCard(ctx: FtshareSettingsShellContext): () => void {
  return ctx.slots.inject(FTSHARE_SETTINGS_CARD_SLOT, () => ctx.slots.register(
    { name: FTSHARE_SETTINGS_CARD_SLOT, id: LOGS_CARD_ID, order: LOGS_CARD_ORDER },
    createLogsCard(),
  ))
}

/** Bind the card's adapter; the component only reads through it. */
function createLogsCard(): () => ReactNode {
  const api = createLogsClient(createSettingsTransport())
  return () => <LogsSection api={api} />
}

export function LogsSection({ api }: { readonly api: LogsPublicApi }): ReactNode {
  const [stats, setStats] = useState<LogsStats>()
  const [preview, setPreview] = useState<LogsPreview>()
  const [lines, setLines] = useState(LOGS_DEFAULT_PREVIEW_LINES)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  /** 读取已失败且还没有任何快照时，每个字段都必须说出来，而不是假装还在读。 */
  const placeholder = statsPlaceholder(error !== '')

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setStats(await api.stats())
      setPreview(await api.preview(lines))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取日志状态失败')
    } finally {
      setBusy(false)
    }
  }, [api, lines])

  useEffect(() => { void refresh() }, [refresh])

  const doExport = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api.export()
      downloadText(result.fileName, result.text)
      setMessage(`已导出 ${result.fileName}（${displayBytes(result.bytes)}${result.truncated ? '，已达体积上限并截断' : ''}）`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出日志失败')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <style>{LOGS_CARD_CSS}</style>
    <section className="ftshare-settings" aria-label="FT 运行日志" aria-busy={busy}>
    <header><div><span className="ftshare-eyebrow">FTSHARE / LOGS</span><h2>运行日志</h2></div></header>
    <div className="ftshare-card">
      <h3>采集状态</h3>
      <dl>
        <div className="ftshare-result"><dt>日志文件</dt><dd>{stats?.file ?? placeholder}</dd></div>
        <div className="ftshare-result"><dt>记录 / 时间范围</dt><dd>
          {stats === undefined ? placeholder : `${stats.records} 条`}
          {stats?.firstAt !== undefined && `（${stats.firstAt} ~ ${stats.lastAt}）`}
        </dd></div>
        <div className="ftshare-result"><dt>文件大小 / 上限</dt><dd>
          {stats === undefined ? placeholder : `${displayBytes(stats.fileBytes)} / ${displayBytes(stats.maxBytes)}`}
        </dd></div>
        <div className="ftshare-result"><dt>丢弃 / 轮转 / 写失败</dt><dd>
          {stats === undefined ? placeholder : `${stats.dropped} / ${stats.rotations} / ${stats.writeFailures}`}
        </dd></div>
        <div className="ftshare-result"><dt>日志级别</dt><dd>{stats?.level ?? placeholder} </dd></div>
        <div className="ftshare-result"><dt>统计</dt><dd>
          {stats === undefined
            ? placeholder
            : Object.keys(stats.byName).length === 0
              ? '暂无'
              : Object.entries(stats.byName).map(([name, count]) => `${name}=${count}`).join('、')}
        </dd></div>
        <div className="ftshare-result"><dt>额外来源</dt><dd>
          {stats === undefined
            ? placeholder
            : stats.sources.length === 0
              ? '暂无'
              : stats.sources.map(source => `${source.path}（${source.kind}${source.bytes === undefined ? '' : ` ${displayBytes(source.bytes)}`}）`).join('；')}
        </dd></div>
      </dl>
      <div className="ftshare-actions">
        <button className="primary" type="button" onClick={() => void doExport()} disabled={busy}>导出日志</button>
        {/* 同源 GET，浏览器自带凭据：直接指向路由，不需要 fetch/Blob。 */}
        <a className="ftshare-download" href={LOGS_ARCHIVE_ROUTE} download="">导出诊断包</a>
        <button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button>
        <label htmlFor="ftshare-log-lines">预览行数</label>
        <select id="ftshare-log-lines" value={lines} onChange={e => setLines(Number(e.target.value))} disabled={busy}>
          {PREVIEW_CHOICES.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </div>
      {busy && <p role="status">正在处理，请稍候…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p className="ftshare-error" role="alert">{error}</p>}
    </div>
    <div className="ftshare-card">
      <h3>最近日志{preview?.truncated === true ? '（已截断）' : ''}</h3>
      {preview === undefined
        ? <p>{error === '' ? '正在读取…' : '日志预览读取失败，见上方提示。'}</p>
        : preview.lines.length === 0
          ? <p>无</p>
          : <pre className="ftshare-log-preview">{preview.lines.join('\n')}</pre>}
    </div>
    </section>
  </>
}
