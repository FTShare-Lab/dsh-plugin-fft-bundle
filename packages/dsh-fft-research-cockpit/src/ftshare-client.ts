import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Logger } from '@deepseek-ai/cordis'

import type { JsonRecord } from './types.js'
import type { PermissionNotice } from './types.js'

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface ParsedMcpError {
  code?: string
  message: string
  requiredPlan?: string
}

/** FTShare subscription tiers, ordered from lowest to highest access. */
export type FtSharePlan = 'Free' | 'Basic' | 'Advanced' | 'Pro'

export interface FtShareCallCandidate {
  tool: string
  arguments_: JsonRecord
  /** Optional explicit tier; otherwise inferred from the FTShare tool name. */
  plan?: FtSharePlan
}

export interface FtShareCallResult {
  value: JsonRecord
  tool: string
  plan: FtSharePlan
  attemptedTools: string[]
  permissions: PermissionNotice[]
  downgraded: boolean
}

function readableMcpError(value: string, tool?: string, logger?: Logger): ParsedMcpError {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const error = (parsed as { error?: unknown }).error
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const message = (error as { message?: unknown }).message
        const code = (error as { code?: unknown }).code
        const requiredPlan = (error as { required_plan?: unknown; requiredPlan?: unknown }).required_plan
          ?? (error as { requiredPlan?: unknown }).requiredPlan
        if (typeof message === 'string' && message.trim()) {
          return {
            code: typeof code === 'string' && code.trim() ? code.trim() : undefined,
            message: message.trim(),
            requiredPlan: typeof requiredPlan === 'string' && requiredPlan.trim() ? requiredPlan.trim() : undefined,
          }
        }
      }
    }
  } catch {
    // Keep the upstream text when it is not JSON.
    logger?.warn('ftshare.invalid_response', { tool, errorType: 'invalid_response' })
  }
  return { message: value }
}

export class FtShareError extends Error {
  constructor(message: string, options?: ErrorOptions & { code?: string; tool?: string }) {
    super(message, options)
    this.name = 'FtShareError'
    this.code = options?.code
    this.tool = options?.tool
  }

  readonly code?: string
  readonly tool?: string
}

export class FtSharePermissionError extends FtShareError {
  constructor(
    message: string,
    readonly permission: PermissionNotice,
    options?: ErrorOptions & { code?: string; tool?: string },
    permissions: PermissionNotice[] = [permission],
  ) {
    super(message, options)
    this.name = 'FtSharePermissionError'
    this.permissions = permissions
  }

  readonly permissions: PermissionNotice[]
}

export function isFtSharePermissionError(error: unknown): error is FtSharePermissionError {
  return error instanceof FtSharePermissionError
}

export const FTSHARE_UPGRADE_URL = 'https://ftai.chat/me/profile?tab=subscription'

export const FTSHARE_PLAN_LABELS: Record<FtSharePlan, string> = {
  Free: '免费版',
  Basic: '基础版',
  Advanced: '进阶版',
  Pro: '专业版（Pro）',
}

const PLAN_RANK: Record<FtSharePlan, number> = { Free: 0, Basic: 1, Advanced: 2, Pro: 3 }

/**
 * API version alone does not identify a subscription tier. These overrides
 * cover the documented v2/v3 exceptions; v4 is Pro and v1 is Free by
 * default. Keep this registry close to the permission parser so newly added
 * report calls get a useful upgrade message without duplicating plan logic.
 */
const TOOL_PLANS: Record<string, FtSharePlan> = {
  ft_v2_etf_description_all: 'Basic',
  ft_v2_limit_event_timeline_3s: 'Basic',
  ft_v2_eastmoney_dapan_flow: 'Free',
  ft_v1_eastmoney_sector_flow: 'Free',
  ft_v1_ths_board_list: 'Free',
  ft_v2_ths_hot_list: 'Free',
  ft_v1_ths_industry_daily_flow: 'Free',
  ft_v3_announcements_stock_announcements: 'Basic',
  ft_v3_report_stock_reports: 'Basic',
  ft_v3_limit_up_reports_briefs: 'Advanced',
  ft_v3_limit_up_reports_public_report: 'Advanced',
  ft_v3_supply_chain_company_supply_chain_companies: 'Advanced',
  ft_v3_supply_chain_subindustry_subsubindustries: 'Advanced',
  ft_v3_supply_chain_subindustry_supply_chain: 'Advanced',
  ft_v3_supply_chain_subsubindustry_companies: 'Advanced',
  ft_v3_supply_chain_subsubindustry_parent_subindustries: 'Advanced',
  ft_v3_ashare_interactions: 'Basic',
  ft_v3_ashare_news_sentiment_factors: 'Advanced',
  ft_v3_ashare_rating_factor_snapshot: 'Advanced',
  ft_v3_kline_pattern_annotations: 'Advanced',
  ft_v3_stock_signal_latest_snapshot: 'Advanced',
  ft_v3_etf_minutes: 'Basic',
  ft_v3_etf_minutes_batch: 'Basic',
  ft_v3_futures_minutes: 'Basic',
  ft_v3_futures_minutes_batch: 'Basic',
  ft_v3_hk_hk_candlesticks: 'Basic',
  ft_v3_holder_stock_ggmx_buy_ranking: 'Basic',
  ft_v3_holder_stock_ggmx_sell_ranking: 'Basic',
  ft_v3_index_minutes: 'Basic',
  ft_v3_index_minutes_batch: 'Basic',
  ft_v3_institution_institution_share_holdings: 'Basic',
  ft_v3_share_stock_institution_holdings: 'Basic',
  ft_v3_share_stock_institution_holdings_detail: 'Basic',
  ft_v3_stock_minutes: 'Basic',
  ft_v3_stock_minutes_batch: 'Basic',
}

export function planForTool(tool: string): FtSharePlan {
  const exact = TOOL_PLANS[tool]
  if (exact) return exact
  if (/^ft_v4_/.test(tool)) return 'Pro'
  if (/^ft_v3_/.test(tool)) return 'Advanced'
  if (/^ft_v2_/.test(tool)) return 'Basic'
  return 'Free'
}

export function permissionNotices(error: unknown): PermissionNotice[] {
  if (!isFtSharePermissionError(error)) return []
  return error.permissions.length > 0 ? error.permissions : [error.permission]
}

/**
 * Some FTShare gateways return a successful MCP envelope whose metadata says
 * the field is subscription-gated, instead of returning an MCP error. Keep
 * that access decision lossless so an empty gated result can still produce a
 * field-level veil. We deliberately require an explicit permission/access
 * marker; an ordinary empty array or an informational warning is not enough.
 */
export function permissionNoticesFromPayload(tool: string, value: JsonRecord): PermissionNotice[] {
  const records: JsonRecord[] = [value]
  const metadata = value.metadata
  if (isRecord(metadata)) {
    if (Array.isArray(metadata.permissions)) records.push(...metadata.permissions.filter(isRecord))
    if (isRecord(metadata.permission)) records.push(metadata.permission)
    records.push(metadata)
  }
  if (isRecord(value.permission)) records.push(value.permission)
  if (Array.isArray(value.permissions)) records.push(...value.permissions.filter(isRecord))
  const output: PermissionNotice[] = []
  for (const record of records) {
    const recordTool = typeof record.tool === 'string' && record.tool.trim() ? record.tool.trim() : tool
    const message = [record.message, record.reason, record.detail, record.error]
      .find(item => typeof item === 'string' && item.trim()) as string | undefined
    const marker = [
      record.access_denied,
      record.accessDenied,
      record.permission_denied,
      record.permissionDenied,
      record.subscription_required,
      record.subscriptionRequired,
      record.upgrade_required,
      record.upgradeRequired,
    ].some(value => value === true)
    const access = [record.access, record.access_status, record.accessStatus, record.entitlement, record.subscription]
      .find(item => typeof item === 'string' && item.trim()) as string | undefined
    const status = typeof record.status === 'string' ? record.status : undefined
    const explicitlyRestricted = marker
      || isPermissionFailure(typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : undefined, message || '')
      || (typeof access === 'string' && /denied|restricted|locked|upgrade|required|无权|受限|未开通|需升级/i.test(access))
      || (typeof status === 'string' && /denied|restricted|locked|upgrade|required|permission|unauthori[sz]ed|无权|受限|未开通|需升级/i.test(status))
      || (typeof message === 'string' && /权限|订阅|升级|未授权|未开通|额度|permission|subscription|unauthori[sz]ed/i.test(message))
      || isRecord(metadata) && Array.isArray(metadata.permissions) && metadata.permissions.includes(record)
    if (!explicitlyRestricted) continue
    const requiredPlan = typeof record.required_plan === 'string'
      ? record.required_plan
      : typeof record.requiredPlan === 'string'
        ? record.requiredPlan
        : typeof record.plan === 'string'
          ? record.plan
          : undefined
    const notice = permissionNotice(recordTool, {
      code: typeof record.code === 'string' ? record.code : undefined,
      message: message || 'FTShare 返回订阅权限限制',
      requiredPlan,
    })
    if (!output.some(item => `${item.tool}:${item.requiredPlan}` === `${notice.tool}:${notice.requiredPlan}`)) output.push(notice)
  }
  return output
}

function recommendedPlan(tool: string): string {
  return planForTool(tool)
}

function isPermissionFailure(code: string | undefined, message: string): boolean {
  return /^(401|403|UNAUTHORIZED|FORBIDDEN|PERMISSION_DENIED|INSUFFICIENT_PERMISSIONS?)$/i.test(code || '')
    || /API\s*Key|权限|订阅|升级|未授权|未开通|额度|permission|subscription|unauthori[sz]ed|forbidden/i.test(message)
}

/**
 * FTShare gateways are deployed independently and do not all expose the same
 * compatibility aliases.  Treat an explicitly unsupported tool as a
 * candidate miss so a report can continue with the next documented alias.
 * Other upstream failures still fail fast: silently swallowing timeouts or
 * malformed requests would make a report look complete when it is not.
 */
function isUnsupportedToolFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:unknown|unsupported|not\s+found|does\s+not\s+exist|不存在|未找到|不支持).*(?:tool|method|接口|工具)|(?:tool|method|接口|工具).*(?:unknown|unsupported|not\s+found|does\s+not\s+exist|不存在|未找到|不支持)/i.test(message)
}

/** Return false for a successful MCP envelope that contains no fact rows. */
function hasFactPayload(value: JsonRecord): boolean {
  const payloadKeys = ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response', 'content']
  const ignored = new Set(['metadata', 'permission', 'permissions', 'status', 'message', 'error', 'code', 'success', 'request_id'])
  const walk = (candidate: unknown, depth = 0): boolean => {
    if (depth > 8 || candidate == null) return false
    if (Array.isArray(candidate)) return candidate.some(item => walk(item, depth + 1))
    if (!isRecord(candidate)) return false
    const nested = payloadKeys.filter(key => key in candidate)
    if (nested.length) return nested.some(key => walk(candidate[key], depth + 1))
    return Object.entries(candidate).some(([key, item]) => !ignored.has(key)
      && item !== undefined && item !== null && (typeof item !== 'object' || walk(item, depth + 1)))
  }
  return walk(value)
}

function permissionNotice(tool: string, parsed: ParsedMcpError): PermissionNotice {
  const rawPlan = parsed.requiredPlan?.trim().toLowerCase()
  const requiredPlan: FtSharePlan = rawPlan === 'free' || rawPlan === '免费版'
    ? 'Free'
    : rawPlan === 'basic' || rawPlan === '基础版'
      ? 'Basic'
      : rawPlan === 'advanced' || rawPlan === '进阶版'
        ? 'Advanced'
        : rawPlan === 'pro' || rawPlan === 'professional' || rawPlan === '专业版'
          ? 'Pro'
          : recommendedPlan(tool) as FtSharePlan
  const planLabel = FTSHARE_PLAN_LABELS[requiredPlan]
  const message = requiredPlan === 'Free' && /未携带\s*API\s*Key|API\s*Key/i.test(parsed.message)
    ? `FTShare API Key 未配置或无效：${tool} 属于 FTShare 免费版接口，请配置有效的 FTSHARE_API_KEY 后重试。`
    : `FTShare 数据权限不足：${tool} 需要 FTShare ${planLabel} 或更高订阅权限。请升级 FTShare ${planLabel} 并重试。`
  return {
    tool,
    code: parsed.code,
    requiredPlan,
    message,
    upgradeUrl: FTSHARE_UPGRADE_URL,
  }
}

export interface FtShareSession {
  call(tool: string, arguments_: JsonRecord, signal: AbortSignal): Promise<JsonRecord>
}

/**
 * Prefer the most capable endpoint and fall back only for explicit upstream
 * permission failures. Failed higher-tier notices are retained even when a
 * lower-tier endpoint succeeds, so reports can explain the downgrade and link
 * to the subscription page.
 */
export async function callWithSubscriptionFallback(
  session: FtShareSession,
  candidates: FtShareCallCandidate[],
  signal: AbortSignal,
  logger?: Logger,
): Promise<FtShareCallResult> {
  if (candidates.length === 0) throw new FtShareError('FTShare 没有可用的数据接口候选')
  const startedAt = Date.now()
  const attemptedTools: string[] = []
  const permissions: PermissionNotice[] = []
  const orderedCandidates = candidates
    .map((candidate, index) => ({ candidate, index, plan: candidate.plan ?? planForTool(candidate.tool) }))
    .sort((left, right) => PLAN_RANK[right.plan] - PLAN_RANK[left.plan] || left.index - right.index)
  for (const [position, entry] of orderedCandidates.entries()) {
    const candidate = entry.candidate
    const plan = entry.plan
    attemptedTools.push(candidate.tool)
    try {
      const value = await session.call(candidate.tool, candidate.arguments_, signal)
      permissions.push(...permissionNoticesFromPayload(candidate.tool, value))
      // A successful empty envelope is not usable data. If a documented
      // compatibility candidate remains, continue to it so a higher-tier
      // endpoint returning no rows cannot suppress a real lower-tier result.
      if (!hasFactPayload(value) && position < orderedCandidates.length - 1) continue
      const uniquePermissions = [...new Map(permissions.map(item => [`${item.tool}:${item.requiredPlan}`, item])).values()]
      return {
        value,
        tool: candidate.tool,
        plan,
        attemptedTools,
        permissions: uniquePermissions.map(notice => ({ ...notice, partial: hasFactPayload(value) })),
        downgraded: attemptedTools.length > 1,
      }
    } catch (error) {
      if (isFtSharePermissionError(error)) {
        permissions.push(...permissionNotices(error))
        continue
      }
      // `orderedCandidates` may differ from the caller's input order after
      // subscription-tier sorting.  Use the sorted position here; checking
      // the original candidate index would incorrectly stop an alias
      // fallback when a Free endpoint was listed before a Pro endpoint.
      if (isUnsupportedToolFailure(error) && position < orderedCandidates.length - 1) continue
      if (permissions.length > 0) {
        const last = permissions[permissions.length - 1]
        logger?.warn('ftshare.permission_denied', {
          tools: attemptedTools,
          tool: last.tool,
          code: last.code,
          requiredPlan: last.requiredPlan,
          durationMs: Date.now() - startedAt,
          errorType: 'permission_denied',
        })
        throw new FtSharePermissionError(
          `${last.message}; 兼容接口失败：${error instanceof Error ? error.message : String(error)}`,
          last, { tool: last.tool, code: last.code }, permissions,
        )
      }
      throw error
    }
  }

  const uniquePermissions = [...new Map(permissions.map(item => [`${item.tool}:${item.requiredPlan}`, item])).values()]
  const last = uniquePermissions.at(-1)
  if (last) {
    logger?.warn('ftshare.permission_denied', {
      tools: attemptedTools,
      tool: last.tool,
      code: last.code,
      requiredPlan: last.requiredPlan,
      durationMs: Date.now() - startedAt,
      errorType: 'permission_denied',
    })
    throw new FtSharePermissionError(
      last.message,
      last,
      { code: last.code, tool: last.tool },
      uniquePermissions,
    )
  }
  logger?.error('ftshare.candidates_failed', {
    tools: attemptedTools,
    attempts: attemptedTools.length,
    durationMs: Date.now() - startedAt,
    errorType: 'candidates_exhausted',
  })
  throw new FtShareError(`FTShare 所有候选接口调用失败：${attemptedTools.join('、')}`)
}

export class FtShareClient {
  constructor(
    private readonly endpoint: string,
    configuredApiKey?: string,
    private readonly logger?: Logger,
  ) {
    const headers: Record<string, string> = {}
    // Prefer the Harness credential seam value (which may come from the
    // persistent ~/.dsh/.credentials.yaml store), while retaining the
    // environment fallback for standalone development/tests.
    const apiKey = configuredApiKey?.trim() || process.env.FTSHARE_API_KEY?.trim()
    if (apiKey && !headers.FTSHARE_API_KEY) headers.FTSHARE_API_KEY = apiKey
    this.headers = headers
  }

  private readonly headers: Record<string, string>

  async withSession<T>(signal: AbortSignal, fn: (session: FtShareSession) => Promise<T>): Promise<T> {
    if (signal.aborted) throw new FtShareError('FTShare request aborted before connection')

    const client = new Client({
      name: 'ft-research-cockpit',
      version: '0.1.0',
    })
    const transport = new StreamableHTTPClientTransport(
      new URL(this.endpoint),
      { requestInit: { headers: this.headers } },
    ) as unknown as Transport

    await client.connect(transport)
    try {
      const session: FtShareSession = {
        call: async (tool, arguments_, callSignal) => {
          if (callSignal.aborted) throw new FtShareError(`${tool} aborted before call`)
          const result = await client.callTool(
            { name: tool, arguments: arguments_ },
            undefined,
            { signal: callSignal },
          )
          if (result.isError) {
            const message = Array.isArray(result.content)
              ? result.content
                .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
                .map(block => block.text)
                .join('\n')
              : `${tool} returned an MCP error`
            const parsed = readableMcpError(message || `${tool} returned an MCP error`, tool, this.logger)
            if (isPermissionFailure(parsed.code, parsed.message)) {
              const permission = permissionNotice(tool, parsed)
              throw new FtSharePermissionError(permission.message, permission, { code: parsed.code, tool })
            }
            throw new FtShareError(parsed.message, { code: parsed.code, tool })
          }
          const structured = result.structuredContent
          if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
            throw new FtShareError(`${tool} did not return structuredContent`)
          }
          return structured as JsonRecord
        },
      }
      return await fn(session)
    } finally {
      await client.close().catch(() => undefined)
    }
  }
}
