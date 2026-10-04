import { normalizeApiKey, type ApiKeyPublicApi, type ApiKeyStatus, type ConfigureResult, type SubscribeChanges } from './contract.js'
export interface SettingsState { status?: ApiKeyStatus; busy: boolean; message: string; statusError?: string; save?: ConfigureResult['save'] }
export class FtshareSettingsModel {
  private state: SettingsState = { busy: false, message: '' }
  private listeners = new Set<() => void>()
  private request = 0
  private lifetime = 0
  constructor(private api: ApiKeyPublicApi) {}
  getSnapshot = (): SettingsState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<SettingsState>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  connect(subscribe?: SubscribeChanges): () => void {
    const dispose = subscribe?.(() => { void this.refresh() })
    void this.refresh()
    return () => { this.request++; this.lifetime++; dispose?.() }
  }
  async refresh(): Promise<void> {
    const request = ++this.request
    try {
      const status = await this.api.describe()
      if (!status || typeof status.configured !== 'boolean') throw new Error('missing_status')
      if (request === this.request) this.update({ status, statusError: undefined })
    } catch { if (request === this.request) this.update({ status: undefined, statusError: '无法读取设置状态，请刷新重试' }) }
  }
  async configureAndTest(input: string): Promise<boolean> {
    if (this.state.busy || !this.state.status?.writable) return false
    let value: string
    try { value = normalizeApiKey(input) } catch (error) { this.update({ message: (error as Error).message }); return false }
    const lifetime = this.lifetime
    this.update({ busy: true, save: undefined, message: '正在保存并检查远端服务和 API Key…' })
    let saved = false
    try {
      const result = await this.api.configureAndTest(value)
      saved = result.save.status === 'saved'
      if (lifetime === this.lifetime) this.update({ save: result.save, message: saved ? validationMessage(result.validation.status) : result.save.message })
    } catch { if (lifetime === this.lifetime) this.update({ message: '请求未完成，保存状态待确认；请刷新后测试当前连接' }) }
    if (lifetime === this.lifetime) { await this.refresh(); this.update({ busy: false }) }
    return saved
  }
  async testConnection(): Promise<void> {
    if (this.state.busy || !this.state.status) return
    const lifetime = this.lifetime
    this.update({ busy: true, message: '正在检查远端服务和当前 API Key…' })
    try {
      const result = await this.api.testConnection()
      if (lifetime === this.lifetime) this.update({ message: validationMessage(result.status) })
    } catch { if (lifetime === this.lifetime) this.update({ message: '测试请求失败，请重试' }) }
    if (lifetime === this.lifetime) { await this.refresh(); this.update({ busy: false }) }
  }
  async clear(): Promise<void> {
    if (this.state.busy || !this.state.status?.writable) return
    const lifetime = this.lifetime
    this.update({ busy: true, save: undefined, message: '' })
    try {
      await this.api.clear()
      if (lifetime === this.lifetime) this.update({ message: '已清除 DSH 保存的密钥；若有 .env 配置，下方显示其有效状态' })
    } catch { if (lifetime === this.lifetime) this.update({ message: '清除失败，请刷新状态后重试' }) }
    if (lifetime === this.lifetime) { await this.refresh(); this.update({ busy: false }) }
  }
}
function validationMessage(status: string): string {
  return ({ passed: '远端服务正常，API Key 验证通过', partial: '远端服务正常，请查看 API Key 检查结果', failed: '测试未通过，请查看分项结果', not_run: '未执行测试，请先确认凭据配置', superseded: '凭据已变化，请重新测试', not_tested: '尚未测试' } as Record<string, string>)[status] ?? '请查看分项结果'
}
