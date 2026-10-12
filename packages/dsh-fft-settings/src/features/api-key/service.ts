import { type ApiKeySettings, type CredentialStatus, type ConfigureResult, type ValidationResult, normalizeApiKey, untested, FTSHARE_API_KEY_REF } from './contract.js'
import { probeApiKey } from './probe.js'

export interface CredentialStore {
  resolve(): Promise<string | undefined>
  describe(): Promise<CredentialStatus>
  set(value: string): Promise<void>
  clear(): Promise<void>
}
export type Validator = (key: string | undefined, signal: AbortSignal) => Promise<ValidationResult>

/** One Host instance owns validation state; the DSH provider owns all secrets. */
export function createApiKeySettings(store: CredentialStore, validator: Validator = probeApiKey) {
  let revision = 0
  let fingerprint: string | undefined
  let validation = untested()
  let active: { revision: number; controller: AbortController; promise: Promise<ValidationResult> } | undefined
  let writes: Promise<unknown> = Promise.resolve()
  let reads: Promise<unknown> = Promise.resolve()
  let disposed = false
  const listeners = new Set<() => void>()
  function invalidate() {
    revision++
    fingerprint = undefined
    validation = untested()
    active?.controller.abort()
    active = undefined
    for (const listener of listeners) {
      try { listener() } catch { /* Observers cannot turn a committed write into a failure. */ }
    }
  }
  function current(): Promise<string | undefined> {
    const read = reads.then(async () => {
      while (true) {
        if (disposed) throw new Error('FTShare settings service is disposed')
        const started = revision
        const key = await store.resolve()
        const hash = key === undefined ? 'absent' : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), b => b.toString(16).padStart(2, '0')).join('')
        if (started !== revision) continue
        if (fingerprint !== undefined && fingerprint !== hash) invalidate()
        fingerprint = hash
        return key
      }
    })
    reads = read.catch(() => {})
    return read
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const promise = writes.then(() => {
      if (disposed) throw new Error('FTShare settings service is disposed')
      return operation()
    })
    writes = promise.catch(() => {})
    return promise
  }
  async function write(value?: string) {
    if (!(await store.describe()).writable) throw new Error('当前配置来源为只读')
    const started = revision
    if (value === undefined) await store.clear()
    else await store.set(value)
    // Also covers providers without update events.
    if (started === revision) invalidate()
  }
  function testSnapshot(key: string | undefined, expectedRevision: number): Promise<ValidationResult> {
    if (disposed || revision !== expectedRevision) return Promise.resolve(untested('superseded', '凭据已变化，请重新测试'))
    if (active?.revision === revision) return active.promise.then(value => structuredClone(value))
    const controller = new AbortController()
    const run = { revision, controller, promise: Promise.resolve(untested()) }
    run.promise = (async () => {
      let result: ValidationResult
      try { result = await validator(key, controller.signal) } catch {
        result = { ...untested('not_run', '验证服务异常，请重试'), status: 'failed' }
      }
      try { if (!disposed) await current() } catch {
        return { ...untested('not_run', '无法确认当前凭据，请重新测试'), status: 'failed' as const }
      }
      if (disposed || controller.signal.aborted || revision !== run.revision) return untested('superseded', '凭据已变化，旧测试结果已丢弃')
      validation = structuredClone(result)
      return structuredClone(result)
    })().finally(() => { if (active === run) active = undefined })
    active = run
    return run.promise.then(value => structuredClone(value))
  }
  const api: ApiKeySettings = {
    credentialRef: FTSHARE_API_KEY_REF,
    async describe() {
      while (true) {
        const key = await current()
        const started = revision
        const { configured, writable, source } = await store.describe()
        if (started !== revision) continue
        const characters = Array.from(key ?? '')
        // Short/invalid keys must not be exposed in full by the suffix preview.
        const maskedValue = configured ? '••••••••' + (characters.length > 4 ? characters.slice(-4).join('') : '') : undefined
        return { configured, writable, ...(source === undefined ? {} : { source }), ...(maskedValue === undefined ? {} : { maskedValue }), revision, validation: structuredClone(validation) }
      }
    },
    resolve: current,
    async set(input) { const value = normalizeApiKey(input); await enqueue(() => write(value)) },
    async clear() { await enqueue(() => write()) },
    async createEnvironment(base = {}) {
      const env = { ...base }
      delete env[FTSHARE_API_KEY_REF]
      const key = await current()
      if (key !== undefined) env[FTSHARE_API_KEY_REF] = key
      return env
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async getValidationStatus() { await current(); return structuredClone(validation) },
    async testConnection() {
      await writes
      const key = await current()
      return testSnapshot(key, revision)
    },
    async configureAndTest(input): Promise<ConfigureResult> {
      let value: string
      try { value = normalizeApiKey(input) } catch {
        return { save: { status: 'failed', code: 'invalid_input', message: 'API Key 格式不正确' }, validation: untested('not_run', '保存失败，未执行测试') }
      }
      const saved = await enqueue(async () => {
        try {
          if (!(await store.describe()).writable) return { code: 'read_only' as const }
          await write(value)
        } catch { return { code: 'save_failed' as const } }
        // Reading/testing can fail after a committed save. Preserve that fact.
        try {
          const key = await current()
          return { revision: key === value ? revision : -1, key }
        } catch { return { unavailable: true } }
      })
      if ('code' in saved) return {
        save: { status: 'failed', code: saved.code, message: saved.code === 'read_only' ? '当前配置来源为只读' : '保存失败，请重试' },
        validation: untested('not_run', '保存失败，未执行测试'),
      }
      if ('unavailable' in saved) return { save: { status: 'saved', message: '已保存到 DSH 凭据存储' }, validation: untested('not_run', '已保存，但无法读取生效凭据，请重试') }
      return { save: { status: 'saved', message: '已保存到 DSH 凭据存储' }, validation: await testSnapshot(saved.key, saved.revision) }
    },
  }
  return {
    api, invalidate,
    dispose() { disposed = true; active?.controller.abort(); active = undefined; listeners.clear() },
  }
}
