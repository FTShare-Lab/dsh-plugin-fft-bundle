/**
 * 上游失败的归一：把 FTShare 网关千奇百怪的报错折成 {@link FtshareNotice}
 * 加一个四态结局。
 *
 * 这是 P8 的解药所在。网关对「套餐没开通这个接口」返回的是 HTTP 403 +
 * `route_not_allowed`，`dsh-kline` 把它归类成 `capability_limited` 之后，摘要里
 * 只留下一个 `0`；调用方于是无法区分「今天真的没有涨停事件」和「这个套餐根本
 * 调不了这个接口」。本模块只做一件事：把权限失败与真实失败分开，并各自带上
 * 用户能看懂的中文说明。
 * @module @dsh-ft/dsh-fft-ftshare/errors
 */

import { FTSHARE_UPGRADE_URL, type FtshareNotice } from './contract.js'

/** 上游返回的错误信封，字段全部按「可能不存在」处理。 */
interface UpstreamErrorEnvelope {
  code?: string
  /** 上游 HTTP 状态码（信封里的 `upstream_code`）：429 这类码比归一码更能说明失败性质。 */
  upstreamCode?: string
  message: string
  requiredPlan?: string
}

/**
 * 权限类错误码：上游 HTTP 层的 403 语义，以及本包与 `dsh-kline` 的归一码。
 * 只列确定表达「无权」的码，不把 404/参数错误也算进来。**配额类不算权限**：匿名
 * 通道有 500 次/日的额度，用尽与「套餐没开通」是两种事，见 {@link QUOTA_CODES}。
 */
const PERMISSION_CODES = new Set([
  '403',
  'forbidden',
  'route_not_allowed',
  'capability_limited',
  'permission_denied',
  'insufficient_permissions',
  'unauthorized',
  '401',
  'invalid_key',
  'invalid_api_key',
  'auth_required',
  'subscription_required',
])

/**
 * 配额类错误码。实测匿名通道额度用尽时上游返回 `UPSTREAM_UNAVAILABLE`——与「上游
 * 真的挂了」同码，因此文案不冒充结论，把两条出路都写出来。`429` 是它的 HTTP 形态。
 */
const QUOTA_CODES = new Set(['upstream_unavailable', 'insufficient_quota', 'quota_exceeded', 'quota_exhausted', '429'])

/** 配额用尽时附在失败提示后的文案。 */
export const FTSHARE_QUOTA_NOTICE = '免费配额用尽，配置 FTShare API Key 或稍后重试'

/**
 * 额度用尽的文案信号。
 *
 * 额度耗尽时上游只说人话不给专属码（「最近 1 天最多访问 500 次」），而匿名通道的
 * 额度用尽与真实停机共用 `UPSTREAM_UNAVAILABLE`。这里只认「用尽 / 耗尽 / 最多访问」
 * 这类表述，**不认「额度」二字本身**：套餐提示里同样会出现「额度」，先按文案判权限
 * 就会把额度问题说成「套餐没开通」。
 */
const QUOTA_TEXT = /(?:配额|额度)[^。；;]{0,10}(?:用尽|用满|耗尽|用完)|最多访问|(?:超出|超过)[^。；;]{0,6}(?:额度|配额|上限)|quota[\s_-]*(?:exceeded|exhausted)/i

/**
 * 一个码或一句话是否表达「额度用尽」。
 * @param code - 归一后的上游错误码。
 * @param upstreamCode - 信封里的上游 HTTP 状态码，可能没有。
 * @param message - 上游说明。
 * @returns 是否属于额度用尽。
 */
export function isQuotaSignal(code: string | undefined, upstreamCode: string | undefined, message: string): boolean {
  if (code !== undefined && QUOTA_CODES.has(code.toLowerCase())) return true
  if (upstreamCode !== undefined && QUOTA_CODES.has(upstreamCode.toLowerCase())) return true
  return QUOTA_TEXT.test(message)
}

/** 中文/英文文案里的权限信号。用于上游只给一句话、不给码的情况。 */
const PERMISSION_TEXT = /套餐|权限|订阅|升级|未开通|未授权|无权限|额度|permission|subscription|unauthori[sz]ed|forbidden|not\s+allowed/i

/** 凭据本身有问题（未携带、校验失败、含非法字符）。与套餐无关，但同样不是「没有数据」。 */
const API_KEY_TEXT = /(?:未收到|未通过|未配置|缺失|无效|不受支持|不完整)[^。；;]{0,12}API\s*Key|API\s*Key[^。；;]{0,12}(?:未收到|未通过|未配置|缺失|无效|校验失败|不受支持|不完整)/i

/** 值得原样重试的失败：限流、超时、网络抖动、上游 5xx。 */
const RETRYABLE_CODES = new Set(['429', 'rate_limited', 'timeout', 'etimedout', 'econnreset', 'econnrefused', 'enotfound', 'fetch_failed', '502', '503', '504', 'upstream_error'])

/** 凭据类拒绝：API Key 缺失或无效，与套餐档位无关，措辞要分开。 */
const CREDENTIAL_CODES = new Set(['401', 'unauthorized', 'invalid_key', 'invalid_api_key', 'auth_required'])

/** 判断一个值是不是可当对象读的记录。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一个非空字符串；其余一律 undefined。 */
export function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** 读一个非空字符串或数字码（上游的 `upstream_code` 是数字）；其余一律 undefined。 */
function asCode(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : asText(value)
}


/**
 * 一个码或一句话是否表达「无权访问」。
 * @param code - 上游错误码，可能没有。
 * @param message - 上游错误文案，可能为空串。
 * @returns 是否属于权限失败。
 */
export function isPermissionSignal(code: string | undefined, message: string): boolean {
  if (code !== undefined && PERMISSION_CODES.has(code.toLowerCase())) return true
  return PERMISSION_TEXT.test(message) || API_KEY_TEXT.test(message)
}

/** 一个码是否值得原样重试。 */
export function isRetryableSignal(code: string | undefined, message: string): boolean {
  if (code !== undefined && RETRYABLE_CODES.has(code.toLowerCase())) return true
  return /超时|限流|重试|timeout|rate[_\s-]*limit|temporar|throttl/i.test(message)
}

/**
 * 从 MCP 客户端抛出的错误（其 message 常是被字符串化的一段上游 JSON）里抽出码与说明。
 *
 * 上游两种形态都出现过：结构化 `{"error":{"code":…,"message":…}}`，以及
 * 一行纯文本。两者都要能读，读不出来就保留原文。
 * @param value - 抛出物或上游返回的文本。
 * @returns 归一后的码与说明。
 */
export function parseUpstreamError(value: unknown): UpstreamErrorEnvelope {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value)
  const candidates: Record<string, unknown>[] = []
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) {
      candidates.push(parsed)
      if (isRecord(parsed.error)) candidates.push(parsed.error)
    }
  } catch {
    // 不是 JSON：按纯文本处理。
  }
  for (const candidate of candidates) {
    const message = asText(candidate.message) ?? asText(candidate.error) ?? asText(candidate.detail)
    if (message === undefined) continue
    const code = asCode(candidate.code) ?? asCode(candidate.error_code)
    const upstreamCode = asCode(candidate.upstream_code) ?? asCode(candidate.upstreamCode)
    const requiredPlan = asText(candidate.required_plan) ?? asText(candidate.requiredPlan) ?? asText(candidate.plan)
    return {
      ...code !== undefined ? { code } : {},
      ...upstreamCode !== undefined ? { upstreamCode } : {},
      message,
      ...requiredPlan !== undefined ? { requiredPlan } : {},
    }
  }
  // 纯文本里可能自带 `403 route_not_allowed` 这类码。
  const matched = /\b(401|403|429|5\d\d)\b\s*([a-z_]+)?/iu.exec(text)
  // 也可能只是 `code: 说明` 的前缀形式（MCP 客户端会把错误正文直接塞进 message）。
  const prefixed = /^([a-z][a-z0-9_]{2,})\s*[:：]/iu.exec(text.trim())
  const code = asText(matched?.[2]) ?? asText(matched?.[1]) ?? asText(prefixed?.[1])
  const upstreamCode = asText(matched?.[1])
  return {
    ...code !== undefined ? { code } : {},
    ...upstreamCode !== undefined && upstreamCode !== code ? { upstreamCode } : {},
    message: text.trim() || 'FTShare 未返回错误说明',
  }
}

/**
 * 造一条「无权访问」提示。措辞刻意把「不是没有数据」写进去：P8 的病根就是这句
 * 缺失，让「套餐没开通」看起来像「今天什么都没有」。
 *
 * 档位只在上游自己给了 `required_plan` 时才写进提示：接口名里的版本号与订阅档位
 * 没有可复核的对应关系，按它猜一个档位会把用户引向错误的套餐。
 * @param tool - 上游工具名。
 * @param code - 上游错误码，缺省按 `route_not_allowed` 记。
 * @param message - 上游说明。
 * @param requiredPlan - 上游信封里给出的所需档位；没给就不猜。
 * @returns 可直接展示的提示。
 */
export function deniedNotice(tool: string, code: string | undefined, message: string, requiredPlan?: string): FtshareNotice {
  const credential = code !== undefined && CREDENTIAL_CODES.has(code.toLowerCase())
  const cause = credential
    ? `凭据未配置或无效（${code}）`
    : `当前套餐未开通该数据能力（上游 ${code ?? '403 route_not_allowed'}）`
  const remedy = credential ? '有效的 API Key' : `订阅${requiredPlan ?? '更高的档位'}`
  return {
    code: code ?? 'route_not_allowed',
    message: `FTShare 无权访问 ${tool}：${cause}，需要${remedy}。这不代表「没有数据」。上游说明：${message}`,
    ...requiredPlan !== undefined ? { requiredPlan } : {},
    upgradeUrl: FTSHARE_UPGRADE_URL,
    retryable: false,
  }
}

/**
 * 把一次失败折成结局与提示。
 * @param error - 抛出物。
 * @param tool - 上游工具名，出现在提示正文里。
 * @returns 结局（`denied` 或 `failed`）与可直接展示的提示。
 */
export function classifyFailure(error: unknown, tool: string): { state: 'denied' | 'failed'; notice: FtshareNotice } {
  const parsed = parseUpstreamError(error)
  // 顺序即优先级：显式权限码 > 额度用尽 > 权限文案 > 普通失败。
  // 额度必须排在权限**文案**之前——额度提示里就带「额度」二字，先按文案判权限会把
  // 「额度用尽」说成「套餐没开通」，并吞掉后面的配额后缀。
  const explicitDenial = parsed.code !== undefined && PERMISSION_CODES.has(parsed.code.toLowerCase())
  const quota = !explicitDenial && isQuotaSignal(parsed.code, parsed.upstreamCode, parsed.message)
  if (quota) {
    const code = parsed.code ?? 'upstream_unavailable'
    return {
      state: 'failed',
      notice: {
        code,
        message: `FTShare ${tool} 调用失败（${code}）：${parsed.message}。${FTSHARE_QUOTA_NOTICE}`,
        retryable: true,
      },
    }
  }
  if (isPermissionSignal(parsed.code, parsed.message)) {
    return { state: 'denied', notice: deniedNotice(tool, parsed.code, parsed.message, parsed.requiredPlan) }
  }
  const code = parsed.code ?? 'upstream_error'
  const retryable = isRetryableSignal(parsed.code, parsed.message)
  const tail = retryable ? '。可稍后重试。' : ''
  return {
    state: 'failed',
    notice: {
      code,
      message: `FTShare ${tool} 调用失败（${code}）：${parsed.message}${tail}`,
      retryable,
    },
  }
}

/**
 * 从「调用成功但信封说自己无权」的载荷里读出权限提示。
 *
 * 部分网关把订阅门禁放在成功信封的 `metadata.permissions` 里，而不是返回错误；
 * 只看空数组就会把这种情况读成「没有数据」。这里的标记判定与投研舱既有实现保持
 * 同一口径：必须出现显式的权限标记或权限文案，普通空数组不算。
 * @param tool - 上游工具名。
 * @param value - 上游返回的结构化载荷。
 * @returns 权限提示；没有标记时 undefined。
 */
export function permissionNoticeFromPayload(tool: string, value: unknown): FtshareNotice | undefined {
  if (!isRecord(value)) return undefined
  const records: Record<string, unknown>[] = [value]
  const metadata = value.metadata
  if (isRecord(metadata)) {
    records.push(metadata)
    if (Array.isArray(metadata.permissions)) records.push(...metadata.permissions.filter(isRecord))
    if (isRecord(metadata.permission)) records.push(metadata.permission)
  }
  if (isRecord(value.permission)) records.push(value.permission)
  if (Array.isArray(value.permissions)) records.push(...value.permissions.filter(isRecord))
  for (const record of records) {
    const code = asText(record.code) ?? asText(record.error_code)
    const message = asText(record.message) ?? asText(record.reason) ?? asText(record.detail) ?? ''
    const marker = [record.access_denied, record.accessDenied, record.permission_denied, record.permissionDenied,
      record.subscription_required, record.subscriptionRequired, record.upgrade_required, record.upgradeRequired]
      .some(flag => flag === true)
    if (!marker && !isPermissionSignal(code, message)) continue
    const requiredPlan = asText(record.required_plan) ?? asText(record.requiredPlan) ?? asText(record.plan)
    return deniedNotice(tool, code, message || '上游返回了订阅权限限制', requiredPlan)
  }
  return undefined
}
