import { useEffect, useState, type ReactNode } from 'react'
import { createShellReader, type ShellAppInfo, type ShellReader, type ShellUpdateCapability, type ShellUpdateState } from '../../shell.js'
import { defineSettingsCard } from '../../card-registry.js'
import { describeUpdateView, productVersionLine, type UpdateControl } from './view.js'

/**
 * Version and check-for-updates entry, above the credentials card.
 *
 * The desktop shell is the only source: version and update state deliberately do
 * not travel over the plugin RPC surface, so this card declares no injection.
 */
export const appVersionCard = defineSettingsCard({
  id: 'appVersion', order: 0, inject: [],
  createComponent() {
    const shell = createShellReader()
    return () => <AppVersionCard shell={shell} />
  },
})

export function AppVersionCard({ shell }: { readonly shell: ShellReader }): ReactNode {
  const [appInfo, setAppInfo] = useState<ShellAppInfo>()
  const [loaded, setLoaded] = useState(false)
  const [capability, setCapability] = useState<ShellUpdateCapability>()
  const [state, setState] = useState<ShellUpdateState>()
  useEffect(() => {
    let live = true
    // The shell replays the current state on subscribe, so the card holds no
    // second copy that could drift from the tray (FR-9).
    const unsubscribe = shell.subscribe(next => { if (live) setState(next) })
    void shell.appInfo().then(info => { if (!live) return; setAppInfo(info); setLoaded(true) })
    void shell.capability().then(next => { if (live) setCapability(next) })
    return () => { live = false; unsubscribe() }
  }, [shell])
  const view = describeUpdateView(state, capability)
  const run = (control: UpdateControl) => { if (control.action) shell.act(control.action) }
  return <section className="ftshare-settings" aria-label="非凸金融终端 版本与更新">
    <header><div><span className="ftshare-eyebrow">FFT DESKTOP / UPDATE</span><h2>应用版本</h2></div></header>
    <div className="ftshare-card">
      <p className="ftshare-version">{productVersionLine(appInfo, loaded)}</p>
      <div className="ftshare-actions">
        <button className="primary" type="button" disabled={!view.primary.enabled} onClick={() => run(view.primary)}>{view.primary.label}</button>
        {view.extra.map(control => <button key={control.id} type="button" disabled={!control.enabled} onClick={() => run(control)}>{control.label}</button>)}
      </div>
    </div>
    <p className={view.tone === 'error' ? 'ftshare-error' : undefined} role={view.tone === 'error' ? 'alert' : 'status'}>{view.status}</p>
    {view.advisory ? <p className="ftshare-advisory" role="note">{view.advisory}</p> : undefined}
  </section>
}
