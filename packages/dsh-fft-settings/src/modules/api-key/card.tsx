import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { FTSHARE_API_KEY_REF, FTSHARE_CREDENTIAL_EVENTS, type SubscribeChanges, type ApiKeyPublicApi } from '../../contract.js'
import { FtshareSettingsModel } from '../../settings-model.js'
import { createApiKeyClient } from './client-api.js'
import { createSettingsTransport } from '../../client-transport.js'
import { defineSettingsCard } from '../../card-registry.js'

export const apiKeyCard = defineSettingsCard({
  id: 'apiKey', order: 10, inject: ['remote'],
  createComponent(ctx) {
    const api = createApiKeyClient(createSettingsTransport())
    const subscribeChanges: SubscribeChanges = listener => {
      const disposers = FTSHARE_CREDENTIAL_EVENTS.map(event => ctx.remote.$on(event, ref => { if (ref === FTSHARE_API_KEY_REF) listener() }))
      disposers.push(ctx.on('connection/reset', listener))
      return () => { for (const dispose of disposers) dispose() }
    }
    return () => <FtshareSettingsSection api={api} subscribeChanges={subscribeChanges} />
  },
})

export function FtshareSettingsSection({ api, subscribeChanges }: { readonly api: ApiKeyPublicApi; readonly subscribeChanges?: SubscribeChanges }): ReactNode {
  const model = useMemo(() => new FtshareSettingsModel(api), [api])
  const { status, busy, message, statusError, save } = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const [draft, setDraft] = useState('')
  useEffect(() => model.connect(subscribeChanges), [model, subscribeChanges])
  const disabled = busy || !status?.writable
  const configure = async () => { if (await model.configureAndTest(draft)) setDraft('') }
  return <section className="ftshare-settings" aria-label="FTShare 设置" aria-busy={busy}>
    <header><div><span className="ftshare-eyebrow">FTSHARE / API KEY</span><h2>访问凭据</h2></div></header>
    {status && !status.writable && <p>当前来源为只读，可测试连接；修改密钥请到对应来源操作。</p>}
    <div className="ftshare-card"><label htmlFor="ftshare-api-key">FTShare API Key</label>
      <input id="ftshare-api-key" type="password" value={draft} placeholder={status?.configured ? status.maskedValue ?? '••••••••' : '请输入 API Key'} onChange={e => setDraft(e.target.value)} disabled={disabled} autoComplete="new-password" maxLength={512} />
      <div className="ftshare-actions">
        <button className="primary" type="button" onClick={() => void configure()} disabled={disabled || !draft.trim()}>配置并测试</button>
        <button type="button" onClick={() => void model.testConnection()} disabled={busy || !status}>测试当前连接</button>
        <button type="button" onClick={() => void model.clear()} disabled={disabled || !status?.configured}>清除已保存密钥</button>
        <button type="button" onClick={() => void model.refresh()} disabled={busy} title="重新读取已保存的配置和上次检测结果，不会发起联网检测">重新读取状态</button>
        <a href="https://ftai.chat/me/profile?tab=api-key" target="_blank" rel="noreferrer">获取 API Key ↗</a>
      </div>
      {draft && <small>“测试当前连接”使用已生效的密钥，不测试输入框内尚未保存的内容。</small>}
      {busy && <p role="status">正在处理，请稍候…</p>}
    </div>
    <div className="ftshare-card" aria-live="polite"><h3>验证结果</h3><dl>
      {save && <div className="ftshare-result"><dt>本次保存</dt><dd>{save.message}</dd></div>}
      <div className="ftshare-result"><dt>远端服务</dt><dd>{status?.validation.remote.message ?? '状态待确认'}</dd></div>
      <div className="ftshare-result"><dt>API Key</dt><dd>{status?.validation.apiKey.message ?? '状态待确认'}</dd></div>
      {status?.validation.testedAt && <div className="ftshare-result"><dt>测试时间</dt><dd>{new Date(status.validation.testedAt).toLocaleString()}</dd></div>}
    </dl><small>节假日或收盘后的空数据不影响验证。</small></div>
    {message && <p role="status">{message}</p>}{statusError && <p className="ftshare-error" role="alert">{statusError}</p>}
  </section>
}
