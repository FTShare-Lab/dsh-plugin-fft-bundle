import { callInterface, permissionKey, type FtshareCaller, type FtshareOutcome } from './ftshare-call.js'
import type { Logger } from '@deepseek-ai/cordis'
import type { JsonRecord, OhlcvPoint, PermissionNotice, Provenance, Snapshot } from './types.js'

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const ENVELOPE_KEYS = new Set(['data', 'rows', 'items', 'records', 'list', 'metadata', 'status', 'message', 'error', 'code', 'success', 'request_id'])

function isFactRecord(value: JsonRecord): boolean {
  return Object.keys(value).some(key => !ENVELOPE_KEYS.has(key))
}

function normalizeStockSymbol(value: string): string {
  const symbol = value.trim()
  if (/\.[A-Za-z]+$/.test(symbol)) return symbol.toUpperCase()
  if (/^(5|6)\d{5}$/.test(symbol)) return `${symbol}.SH`
  if (/^(4|8|9)\d{5}$/.test(symbol)) return `${symbol}.BJ`
  return `${symbol}.SZ`
}

function bareStockSymbol(value: string): string {
  return value.split('.', 1)[0]
}

export function rows(value: JsonRecord, depth = 0): JsonRecord[] {
  if (depth > 3) return []
  // Different FTShare gateway versions wrap the same payload in `result`,
  // `payload` or `response`. Walk only known envelope keys and never treat an
  // empty envelope as a data row.
  for (const key of ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response', 'content']) {
    const data = value[key]
    if (Array.isArray(data)) return data.filter(isRecord).filter(isFactRecord)
    if (isRecord(data)) {
      const nested = rows(data, depth + 1)
      if (nested.length > 0) return nested
      if (isFactRecord(data)) return [data]
    }
  }
  return []
}

/** Flatten v4 batch-K-line groups while retaining the parent symbol. */
function klineRows(value: JsonRecord): JsonRecord[] {
  const top = rows(value)
  const nested = top.flatMap(group => {
    const items = group.items
    if (!Array.isArray(items)) return []
    return items.filter(isRecord).map(item => ({
      ...item,
      symbol: item.symbol ?? group.symbol,
    }))
  })
  return nested.length > 0 ? nested : top
}

function text(row: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function number(row: JsonRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function dateText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 19_000_101 && value <= 29_991_231) return dateText(String(Math.trunc(value)))
    const millis = value > 10_000_000_000 ? value : value * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  if (/^\d{13}$/.test(trimmed)) return dateText(Number(trimmed))
  if (/^\d{10}$/.test(trimmed)) return dateText(Number(trimmed))
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  return trimmed.slice(0, 10)
}

function timestampForDate(value: string, endOfDay = false): number {
  const normalized = /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value
  const suffix = endOfDay ? 'T23:59:59.999+08:00' : 'T00:00:00.000+08:00'
  const timestamp = Date.parse(`${normalized}${suffix}`)
  if (!Number.isFinite(timestamp)) throw new Error(`无效日期：${value}`)
  return timestamp
}

function provenance(tool: string, source: JsonRecord): Provenance {
  return {
    provider: 'ftshare',
    tool,
    retrievedAt: new Date().toISOString(),
    metadata: isRecord(source.metadata) ? source.metadata : undefined,
  }
}

function compactDate(value: string): string {
  return value.replaceAll('-', '').slice(0, 8)
}

function dateRange(asOf: string, days: number): { since: string; until: string } {
  const end = new Date(`${asOf}T23:59:59.999+08:00`)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.max(days * 2, 180))
  return {
    since: start.toISOString().slice(0, 10).replaceAll('-', ''),
    until: compactDate(asOf),
  }
}

function parseOhlcv(source: JsonRecord): OhlcvPoint[] {
  return rows(source)
    .map(row => ({
      date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.datetime ?? row.ts_millis ?? row.tsMillis ?? row.close_ts_ms ?? row.closeTsMs) ?? '',
      open: number(row, 'open', 'open_price', 'openPrice'),
      high: number(row, 'high', 'high_price', 'highPrice'),
      low: number(row, 'low', 'low_price', 'lowPrice'),
      close: number(row, 'close', 'close_price', 'closePrice', 'last', 'last_price', 'lastPrice'),
      volume: number(row, 'volume', 'vol', '成交量', 'total_volume', 'totalVolume', 'amount'),
    }))
    .filter(point => point.date && point.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date))
}

function sourceWarning(source: JsonRecord, tool: string): string | null {
  if (!isRecord(source.metadata)) return null
  if (source.metadata.truncated === true) return `${tool} 返回结果被截断`
  if (source.metadata.fallback === true) return `${tool} 使用了上游降级结果`
  if (Array.isArray(source.metadata.warnings) && source.metadata.warnings.length > 0) {
    return `${tool}：${source.metadata.warnings.map(String).join('；')}`
  }
  return null
}

function normalizeQuote(row: JsonRecord): JsonRecord {
  const close = number(row, 'close', 'close_price', 'closePrice', 'price', 'last', 'last_price', 'lastPrice')
  const pctChange = number(row, 'pct_change', 'pctChange', 'change_percent', 'changePercent', '涨跌幅')
    ?? (() => {
      const rate = number(row, 'change_rate')
      return rate === null ? null : Math.abs(rate) <= 1 ? rate * 100 : rate
    })()
  return {
    ...row,
    close,
    price: close,
    open: number(row, 'open', 'open_price', 'openPrice'),
    high: number(row, 'high', 'high_price', 'highPrice'),
    low: number(row, 'low', 'low_price', 'lowPrice'),
    prev_close: number(row, 'prev_close', 'pre_close', 'previous_close', 'prevClose', 'preClose'),
    volume: number(row, 'volume', 'total_volume', 'vol', '成交量', 'totalVolume'),
    turnover: number(row, 'turnover', 'amount', 'total_amount', '成交额', 'totalAmount'),
    pct_change: pctChange,
    trade_date: dateText(row.trade_date ?? row.date ?? row.ts_millis) ?? text(row, 'trade_date', 'date'),
  }
}

function normalizeValuation(row: JsonRecord): JsonRecord {
  return {
    ...row,
    trade_date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.ts_millis ?? row.tsMillis) ?? text(row, 'trade_date', 'tradeDate', 'date'),
    close: number(row, 'close_price', 'closePrice', 'close'),
    pe_ttm: number(row, 'pe_ttm', 'peTtm', 'pe'),
    pb_mrq: number(row, 'pb_mrq', 'pbMrq', 'pb'),
    ps_ttm: number(row, 'ps_ttm', 'psTtm', 'ps'),
    pcf_ocf_ttm: number(row, 'pcf_ocf_ttm', 'pcfOcfTtm', 'pcf'),
    peg: number(row, 'peg_car', 'pegCar', 'peg'),
    total_market_cap: number(row, 'total_market_cap', 'totalMarketCap', 'market_cap', 'marketCap'),
  }
}

/**
 * 最近的股票公告。
 *
 * 旧实现按「Basic 的 stock_code 模式优先、Free 的按日模式兜底」成对候选逐日请求。
 * 候选链已按规格 §附录 B 删除，这里只调保留的那一个接口：上游 `empty` 就是「确实
 * 没有公告」，`denied` 就是「当前套餐无权访问」，两者都不再触发降级。
 */
async function loadRecentAnnouncements(
  data: FtshareCaller,
  symbol: string,
  asOf: string,
  lookbackDays: number,
  signal: AbortSignal,
  logger?: Logger,
): Promise<FtshareOutcome> {
  const days = Math.max(1, Math.min(90, Math.trunc(lookbackDays)))
  const outcome = await callInterface(data, TOOLS.announcements, {
    type: 'stock',
    stock_code: normalizeStockSymbol(symbol),
    page: 1,
    page_size: 30,
  }, signal, logger)
  if (outcome.state !== 'available') return outcome
  const seen = new Set<string>()
  const unique = outcome.rows
    .filter(item => {
      const key = String(item.announcement_id ?? item.id ?? item.url_hash ?? item.announcement_title ?? JSON.stringify(item))
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => String(right.announcement_time ?? right.updated_at ?? '').localeCompare(String(left.announcement_time ?? left.updated_at ?? '')))
  const value: JsonRecord = {
    data: unique.slice(0, 100),
    metadata: {
      source: 'ftshare',
      tool: TOOLS.announcements,
      operation: `recent_${days}d`,
      as_of: asOf,
      returned: Math.min(unique.length, 100),
      total: unique.length,
      truncated: unique.length > 100,
    },
  }
  return { ...outcome, value, rows: unique }
}

/**
 * 一条能力一个接口。旧的成对候选（`beta`/`betaPreferred`、
 * `announcements`/`announcementsPreferred`、`security`/`securityPreferred`、
 * `capitalFlow`/`capitalFlowPreferred`）按规格 §附录 B 删除：降级本身就是「假定两个
 * 上游接口之间存在对应关系」。
 *
 * 接口名以底座的 `catalog.json` 为准（`ft_v2_*` 才是上游真实存在的那一版）：旧实现的
 * `ft_v3_report_stock_reports`、`ft_v3_announcements_stock_announcements` 与两个
 * `*_risk_beta` 在 250 条目录里**都不存在**。风险暴露（Beta）因此没有可指的上游接口，
 * 它是能力缺口：不再发一次注定失败的调用。
 */
const TOOLS = {
  security: 'ft_v1_company_list',
  securityRealtime: 'ft_v4_stock_realtime_day_kline',
  kline: 'ft_v1_stock_candlesticks',
  income: 'ft_v1_finance_income',
  cashflow: 'ft_v1_finance_cashflow',
  valuation: 'ft_v1_eastmoney_stock_valuation',
  capitalFlow: 'ft_v1_eastmoney_stock_flow',
  announcements: 'ft_v2_announcements_stock_announcements',
  research: 'ft_v2_report_stock_reports',
} as const

export interface SnapshotLoadOptions {
  /** Skip optional event/research calls when loading large candidate pools. */
  includeAnnouncements?: boolean
  includeResearch?: boolean
  /** Load stock-level flow facts for reports that render them. */
  includeExtendedFacts?: boolean
}

export async function loadSnapshot(
  data: FtshareCaller,
  symbol: string,
  asOf: string,
  maxKlineDays: number,
  signal: AbortSignal,
  announcementLookbackDays = 30,
  options: SnapshotLoadOptions = {},
  logger?: Logger,
): Promise<Snapshot> {
  const range = dateRange(asOf, maxKlineDays)
  const includeAnnouncements = options.includeAnnouncements ?? true
  const includeResearch = options.includeResearch ?? true
  const includeExtendedFacts = options.includeExtendedFacts ?? false
  const currentDate = new Date().toISOString().slice(0, 10)
  // 一条能力一个接口：当天用实时日线，历史用公司名录快照，二者不再互为降级候选。
  const securityTool = asOf === currentDate ? TOOLS.securityRealtime : TOOLS.security
  const securityArguments: JsonRecord = asOf === currentDate
    ? { symbols: [normalizeStockSymbol(symbol)] }
    : { stock_code: bareStockSymbol(symbol), page: 1, page_size: 5 }
  const skipped: FtshareOutcome = { state: 'empty', value: null, rows: [], retryable: false }
  const callSpecs: Array<{ tool: string; run: () => Promise<FtshareOutcome> }> = [
    { tool: securityTool, run: () => callInterface(data, securityTool, securityArguments, signal, logger) },
    {
      tool: TOOLS.kline,
      run: () => callInterface(data, TOOLS.kline, {
        symbol: normalizeStockSymbol(symbol),
        interval_unit: 'Day',
        interval_value: 1,
        since_ts_millis: timestampForDate(range.since),
        until_ts_millis: timestampForDate(range.until, true),
        adjust_kind: 'Forward',
        limit: 500,
      }, signal, logger),
    },
    { tool: TOOLS.income, run: () => callInterface(data, TOOLS.income, { stock_code: bareStockSymbol(symbol) }, signal, logger) },
    { tool: TOOLS.cashflow, run: () => callInterface(data, TOOLS.cashflow, { stock_code: bareStockSymbol(symbol) }, signal, logger) },
    {
      tool: TOOLS.valuation,
      run: () => callInterface(data, TOOLS.valuation, {
        symbol: normalizeStockSymbol(symbol),
        start_date: range.since,
        end_date: range.until,
        page: 1,
        page_size: 30,
      }, signal, logger),
    },
    {
      tool: TOOLS.announcements,
      run: includeAnnouncements
        ? () => loadRecentAnnouncements(data, symbol, asOf, announcementLookbackDays, signal, logger)
        : () => Promise.resolve(skipped),
    },
    {
      tool: TOOLS.research,
      run: includeResearch
        ? () => callInterface(data, TOOLS.research, { type: 'StockReport', stock_code: normalizeStockSymbol(symbol), page: 1, page_size: 30 }, signal, logger)
        : () => Promise.resolve(skipped),
    },
    ...(includeExtendedFacts ? [{
      tool: TOOLS.capitalFlow,
      run: () => callInterface(data, TOOLS.capitalFlow, { symbol: normalizeStockSymbol(symbol), start_date: range.since, end_date: range.until, page: 1, page_size: 200 }, signal, logger),
    }] : []),
    { tool: 'ft_v1_finance_balance', run: () => callInterface(data, 'ft_v1_finance_balance', { stock_code: bareStockSymbol(symbol) }, signal, logger) },
  ]
  const calls = await Promise.all(callSpecs.map(async spec => {
    try {
      return { tool: spec.tool, ...await spec.run() }
    } catch (error) {
      // 叶子取数不抛异常：连日期解析这类同步错误也只折成一条 failed，绝不让整份
      // 快照因为一个模块崩掉。
      return {
        tool: spec.tool,
        state: 'failed' as const,
        value: null,
        rows: [],
        gap: `FTShare 工具调用失败：${spec.tool}`,
        warning: error instanceof Error ? error.message : String(error),
        retryable: false,
      }
    }
  }))

  const dataGaps: string[] = []
  const warnings: string[] = []
  const permissions: PermissionNotice[] = []
  const blockedPermissions: PermissionNotice[] = []
  const successful = new Map<number, JsonRecord>()
  calls.forEach((call, index) => {
    if (call.permission) {
      permissions.push(call.permission)
      blockedPermissions.push(call.permission)
    }
    if (call.gap) dataGaps.push(call.gap)
    if (call.warning) warnings.push(call.warning)
    if (call.state === 'available' && call.value) {
      successful.set(index, call.value)
      const warning = sourceWarning(call.value, call.tool)
      if (warning) warnings.push(warning)
    }
  })

  let securitySource = successful.get(0)
  // 实时接口在非交易时段会返回「调用成功但没有收盘价」的信封。旧实现在这时降级调
  // 免费快照接口；候选链删除后不再降级，如实记为缺少实时行情，绝不让空信封变成一条
  // 全是 null 的假报价（下游据此误判「有行情」并压掉正确的缺口标记）。
  if (securitySource && securityTool === TOOLS.securityRealtime
    && !klineRows(securitySource).some(row => number(row, 'close', 'close_price', 'price', 'last', 'last_price') !== null)) {
    securitySource = undefined
    warnings.push(`FTShare ${TOOLS.securityRealtime} 未返回可用实时行情，本次不展示报价`)
  }
  const securityRows = securitySource ? klineRows(securitySource) : []
  const rawSecurityRow = securityRows[0] ?? rows(securitySource ?? {})[0]
  const securityRow = rawSecurityRow ? normalizeQuote(rawSecurityRow) : null
  const ohlcvSource = successful.get(1)
  const incomeSource = successful.get(2)
  const cashflowSource = successful.get(3)
  const valuationSource = successful.get(4)
  const announcementSource = successful.get(5)
  const researchSource = successful.get(6)
  const capitalFlowSource = includeExtendedFacts ? successful.get(7) : undefined
  const balanceSource = successful.get(includeExtendedFacts ? 8 : 7)
  const name = text(securityRow ?? {}, 'name', 'stock_name', 'company_name')
    ?? text(rows(incomeSource ?? {})[0] ?? {}, 'stock_name', 'company_name', 'name')
    ?? text(rows(valuationSource ?? {})[0] ?? {}, 'stock_name', 'company_name', 'name')
    ?? symbol
  const ohlcv = ohlcvSource ? parseOhlcv(ohlcvSource) : []
  const valuationRows = valuationSource
    ? rows(valuationSource)
      .map(normalizeValuation)
      .sort((left, right) => String(right.trade_date ?? '').localeCompare(String(left.trade_date ?? '')))
    : []
  const latestRow = (source: JsonRecord | undefined): JsonRecord | null => {
    const sourceRows = source ? rows(source) : []
    return sourceRows
      .slice()
      .sort((left, right) => String(right.trade_date ?? right.tradeDate ?? right.date ?? '').localeCompare(String(left.trade_date ?? left.tradeDate ?? left.date ?? '')))[0] ?? null
  }
  const normalizeCapitalFlow = (row: JsonRecord | null): JsonRecord | null => {
    if (!row) return null
    return {
      ...row,
      trade_date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.ts_millis ?? row.tsMillis) ?? text(row, 'trade_date', 'tradeDate', 'date'),
      main_net_val: number(row, 'main_net_val', 'main_net', 'mainNet', 'main_net_inflow', 'mainNetInflow'),
      huge_net_val: number(row, 'huge_net_val', 'super_large_net', 'superLargeNet', 'huge_net', 'super_large_net_inflow'),
      large_net_val: number(row, 'large_net_val', 'large_net', 'largeNet', 'large_net_inflow'),
      medium_net_val: number(row, 'medium_net_val', 'medium_net', 'mediumNet', 'medium_net_inflow'),
      small_net_val: number(row, 'small_net_val', 'small_net', 'smallNet', 'small_net_inflow'),
    }
  }
  const capitalFlow = includeExtendedFacts ? normalizeCapitalFlow(latestRow(capitalFlowSource)) : null

  if (!securityRow) dataGaps.push('缺少 FTShare 实时行情数据')
  if (ohlcv.length === 0) dataGaps.push('缺少可用于技术分析的日线 OHLCV 数据')
  if (!incomeSource || rows(incomeSource).length === 0) dataGaps.push('缺少 FTShare 财务收入数据')
  if (!cashflowSource || rows(cashflowSource).length === 0) dataGaps.push('缺少 FTShare 现金流数据')
  if (valuationRows.length === 0) dataGaps.push('缺少 FTShare 估值数据')
  if (includeExtendedFacts && !capitalFlow) dataGaps.push('缺少 FTShare 个股资金流数据')
  if (includeAnnouncements && (!announcementSource || rows(announcementSource).length === 0)) dataGaps.push('缺少 FTShare 公告数据')
  if (includeResearch && (!researchSource || rows(researchSource).length === 0)) dataGaps.push('缺少 FTShare 研报数据')

  let marginDetail: JsonRecord | null = null
  let marginSource: JsonRecord | undefined
  const marginDate = ohlcv.filter(point => point.date <= asOf).at(-1)?.date
  if (includeExtendedFacts && marginDate) {
    const margin = await callInterface(data, 'ft_v1_margin_trading_details', { stock: normalizeStockSymbol(symbol), date: compactDate(marginDate) }, signal, logger)
    if (margin.permission) {
      permissions.push(margin.permission)
      blockedPermissions.push(margin.permission)
      dataGaps.push(margin.permission.message)
    } else if (margin.state === 'failed') {
      dataGaps.push('FTShare 两融接口调用失败')
    }
    if (margin.warning) warnings.push(margin.warning)
    if (margin.state === 'available' && margin.value) {
      marginSource = margin.value
      const row = rows(marginSource).find(row => bareStockSymbol(String(row.symbol ?? '')) === bareStockSymbol(symbol) && dateText(row.date) === marginDate)
      if (row) {
        const financing = number(row, 'margin_trading_balance')
        const total = number(row, 'total_balance')
        marginDetail = { trade_date: marginDate, fin_bal: financing, fin_buy_bal: number(row, 'margin_trading_buying_amount'),
          sloan_bal: total !== null && financing !== null && total >= financing ? total - financing : null,
          sloan_sell_vol: number(row, 'securities_lending_selling_volume'), mtss_bal: total }
      }
      if (!marginDetail) dataGaps.push(`FTShare ${marginDate} 未返回该标的两融记录`)
    } else if (margin.state === 'empty') {
      dataGaps.push(`FTShare ${marginDate} 未返回该标的两融记录`)
    }
  }
  const sources: Provenance[] = []
  ;[
    [securityTool, securitySource],
    [TOOLS.kline, ohlcvSource],
    [TOOLS.income, incomeSource],
    ['ft_v1_finance_balance', balanceSource],
    ['ft_v1_margin_trading_details', marginSource],
    [TOOLS.cashflow, cashflowSource],
    [TOOLS.valuation, valuationSource],
    ...(includeExtendedFacts ? [[TOOLS.capitalFlow, capitalFlowSource] as [string, JsonRecord | undefined]] : []),
    ...(includeAnnouncements ? [[TOOLS.announcements, announcementSource] as [string, JsonRecord | undefined]] : []),
    ...(includeResearch ? [[TOOLS.research, researchSource] as [string, JsonRecord | undefined]] : []),
  ].forEach(([tool, source]) => {
    if (source) sources.push(provenance(tool as string, source as JsonRecord))
  })

  const disclosedRows = (source: JsonRecord | undefined): JsonRecord[] => source ? rows(source)
    .filter(row => !row.publish_date || String(row.publish_date).slice(0, 10) <= asOf)
    .sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0)
      || ({ annual: 4, q3: 3, q2: 2, q1: 1 }[String(b.report_type)] ?? 0) - ({ annual: 4, q3: 3, q2: 2, q1: 1 }[String(a.report_type)] ?? 0))
    .slice(0, 12) : []
  return {
    symbol,
    name,
    asOf,
    quote: securityRow,
    ohlcv,
    financial: incomeSource || cashflowSource
      ? { income: disclosedRows(incomeSource), cashflow: disclosedRows(cashflowSource), balance: disclosedRows(balanceSource) }
      : null,
    valuation: valuationRows[0] ?? null,
    capitalFlow,
    marginDetail,
    announcements: announcementSource ? rows(announcementSource).slice(0, 30) : [],
    research: researchSource ? rows(researchSource).slice(0, 30) : [],
    provenance: sources,
    dataGaps: [...new Set(dataGaps)],
    warnings: [...new Set(warnings)],
    permissions: [...new Map(permissions.map(item => [permissionKey(item), item])).values()],
    blockedPermissions: [...new Map(blockedPermissions.map(item => [permissionKey(item), item])).values()],
  }
}
