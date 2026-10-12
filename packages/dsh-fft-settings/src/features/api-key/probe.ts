import { type ProbeResult, type ValidationResult } from './contract.js'

const ORIGIN = 'https://market.ft.tech/gateway/'
const MAX_RESPONSE_BYTES = 128 * 1024
const DAY = 86_400_000
export const PROBE_TIMEOUT_MS = 8_000
export const PROBE_CONTRACTS = {
  daily: 'api/v1/market/data/stock-candlesticks',
  historicalMinute: 'api/v2/market/data/stock_minutes',
} as const
const result = (status: ProbeResult['status'], message: string): ProbeResult => ({ status, message })
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Error text is classified internally and never returned verbatim. */
export function classifyFailure(code: number, text: string): ProbeResult {
  if (code === 400 || code === 422) return result('invalid_response', `检测请求参数被 FTShare 拒绝（错误码 ${code}），请更新插件；这不代表 Key 无效`)
  if (code === 429) return result('rate_limited', '请求受限，请稍后重试')
  if (code >= 500) return result('upstream_error', 'FTShare 服务暂时不可用')
  if (code === 401 || code === 403) {
    if (/quota|额度|配额/i.test(text)) return result('quota_exceeded', '接口额度不足，无法完成 Key 验证')
    if (/permission|权限|订阅|套餐|upgrade|plan/i.test(text)) return result('permission_denied', '接口权限不足，无法完成 Key 验证')
    if (/missing|required|未携带|缺少/i.test(text)) return result('auth_required', 'FTShare 未收到所需凭据')
    if (code === 403 && !/invalid|expired|malformed|无效|过期/i.test(text)) return result('permission_denied', '请求被拒绝，请检查 Key 或接口权限')
    return result('auth_failed', 'API Key 未通过认证')
  }
  return result('invalid_response', `检测接口返回未识别的错误（错误码 ${code}），未能完成检测`)
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('empty_body')
  const reader = response.body.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('oversized_body') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function probe(path: string, params: Record<string, string>, key: string | undefined, parent: AbortSignal, fetcher: typeof fetch): Promise<ProbeResult> {
  const url = new URL(path, ORIGIN)
  url.search = new URLSearchParams(params).toString()
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const signal = AbortSignal.any([parent, timeout])
  try {
    // Never forward a credential across a redirect.
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (key !== undefined) headers.FTSHARE_API_KEY = key
    const failure = (code: number, text: string) => key === undefined && (code === 401 || code === 403)
      ? result('upstream_error', '远端服务拒绝了连通性检查') : classifyFailure(code, text)
    const response = await fetcher(url, { headers, redirect: 'error', signal })
    let payload: unknown
    try { payload = await readBoundedJson(response) } catch (error) {
      if (signal.aborted) throw error
      if (!response.ok) return failure(response.status, '')
      return result('invalid_response', '接口未返回有效 JSON 数据')
    }
    const text = isRecord(payload) ? String(payload.message ?? payload.msg ?? '') : ''
    if (!response.ok) return failure(response.status, text)
    if (!isRecord(payload) || typeof payload.code !== 'number') return result('invalid_response', '接口响应格式异常')
    if (payload.code !== 200) return failure(payload.code, text)
    if (!Array.isArray(payload.data)) return result('invalid_response', '接口未返回 K 线数组')
    // This checks service/authentication success, not market-data availability.
    // Empty holiday or post-close windows are successful responses too.
    return result('available', key === undefined ? '远端服务正常' : 'API Key 验证通过')
  } catch {
    if (parent.aborted) return result('not_run', '测试已取消或凭据已变化')
    if (timeout.aborted) return result('timeout', '连接超时，请稍后重试')
    return result('network_error', '连接失败，请检查网络后重试')
  }
}

/** Two fixed, bounded requests. No SDK, arbitrary URL, retries or stored rows. */
export async function probeApiKey(key: string | undefined, signal: AbortSignal, fetcher: typeof fetch = fetch, now = Date.now()): Promise<ValidationResult> {
  const remote = await probe(PROBE_CONTRACTS.daily, {
    symbol: '600519.SH', interval_unit: 'day', adjust_kind: 'none',
    since_ts_millis: String(now - 30 * DAY), until_ts_millis: String(now), limit: '2',
  }, undefined, signal, fetcher)
  let apiKey: ProbeResult
  if (!key) {
    apiKey = result('auth_required', '未配置 API Key')
  } else if (signal.aborted || remote.status !== 'available') {
    apiKey = result('not_run', '远端服务检查未通过，未验证 Key')
  } else {
    // The server counts inclusive Beijing calendar dates, not elapsed days.
    // A 24-hour window covers at most two dates; empty data still verifies auth.
    apiKey = await probe(PROBE_CONTRACTS.historicalMinute, {
      symbol: '600519.SH', interval_value: '1', adjust_kind: 'none',
      since_ts_millis: String(now - DAY), until_ts_millis: String(now), limit: '1',
    }, key, signal, fetcher)
  }
  const passed = [remote, apiKey].filter(item => item.status === 'available').length
  return { status: passed === 2 ? 'passed' : passed === 1 ? 'partial' : 'failed', remote, apiKey, testedAt: new Date(now).toISOString() }
}
