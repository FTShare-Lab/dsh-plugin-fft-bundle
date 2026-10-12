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
        <div className="ftshare-result"><dt>日志文件</dt><dd>{stats?.file ?? '读取中…'}</dd></div>
        <div className="ftshare-result"><dt>记录 / 时间范围</dt><dd>
          {stats === undefined ? '读取中…' : `${stats.records} 条`}
          {stats?.firstAt !== undefined && `（${stats.firstAt} ~ ${stats.lastAt}）`}
        </dd></div>
        <div className="ftshare-result"><dt>文件大小 / 上限</dt><dd>
          {stats === undefined ? '读取中…' : `${displayBytes(stats.fileBytes)} / ${displayBytes(stats.maxBytes)}（保留 ${stats.keep} 份轮转）`}
        </dd></div>
        <div className="ftshare-result"><dt>丢弃 / 轮转 / 写失败</dt><dd>
          {stats === undefined ? '读取中…' : `${stats.dropped} / ${stats.rotations} / ${stats.writeFailures}`}
        </dd></div>
        <div className="ftshare-result"><dt>当前级别</dt><dd>{stats?.level ?? '读取中…'}（warn 收 error+info+warn，debug 收全部）</dd></div>
        <div className="ftshare-result"><dt>可选级别</dt><dd>warn / debug —— 级别是<strong>接收上限</strong>，info 会把 warn 一起丢掉，与「失败日志不低于 warn」冲突，故不提供 info 档</dd></div>
        <div className="ftshare-result"><dt>各来源条数</dt><dd>
          {stats === undefined || Object.keys(stats.byName).length === 0
            ? '本次进程尚无记录'
            : Object.entries(stats.byName).map(([name, count]) => `${name}=${count}`).join('、')}
        </dd></div>
        <div className="ftshare-result"><dt>额外来源</dt><dd>
          {stats === undefined || stats.sources.length === 0
            ? '未配置（logs.sources）'
            : stats.sources.map(source => `${source.path}（${source.kind}${source.bytes === undefined ? '' : ` ${displayBytes(source.bytes)}`}）`).join('；')}
        </dd></div>
      </dl>
      <div className="ftshare-actions">
        <button className="primary" type="button" onClick={() => void doExport()} disabled={busy}>导出日志</button>
        {/* 同源 GET，浏览器自带凭据：直接指向路由，不需要 fetch/Blob。 */}
        <a className="ftshare-download" href={LOGS_ARCHIVE_ROUTE} download="">导出诊断包（.zip）</a>
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
      {preview === undefined || preview.lines.length === 0
        ? <p>还没有日志。采集器随插件启动，出现警告后这里就会有内容。</p>
        : <pre className="ftshare-log-preview">{preview.lines.join('\n')}</pre>}
      <small>桌面端点「导出日志」由 Electron 直接下载，<strong>不弹保存对话框</strong>，文件落在系统下载目录；浏览器端是否询问取决于浏览器设置。</small>
      <small>「导出诊断包（.zip）」= 同一份 ft-runtime.log + manifest.json（生成时间、版本、上限、各来源统计、盲区）+ 额外来源原文；桌面端同样不弹保存对话框、落在系统下载目录。若浏览器没有开始下载，改用「导出日志」。</small>
      <small>日志可能含本地路径、插件名与标识，发送给他人前请自行检查内容。</small>
      <small>覆盖盲区：采集器挂载前的 warn/debug 不可恢复；纯 Web 环境下 MCP/Python 子进程 stderr 不在其中；浏览器渲染进程日志没有回传通道；直接 console.* 或只体现在返回值的失败看不到。</small>
    </div>
    </section>
  </>
}
