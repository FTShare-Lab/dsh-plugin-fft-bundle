export type JsonRecord = Record<string, unknown>

export type ReportType =
  | 'deep_read'
  | 'holding_analysis'
  | 'limit_up_attribution'
  | 'market_commentary'
  | 'portfolio_etfs'
  | 'portfolio_stocks'
  | 'review'
  | 'sector_analysis'

export interface PermissionNotice {
  /** Some facts are available; retain them alongside the restricted data surface. */
  partial?: boolean
  tool: string
  code?: string
  requiredPlan: string
  message: string
  upgradeUrl: string
}

export interface HoldingInput {
  symbol: string
  name?: string
  quantity?: number
  costPrice?: number
  currentPrice?: number
  marketValue?: number
  pnl?: number
  pnlPct?: number
  weight?: number
}

export interface ReportRequest {
  reportType: ReportType
  symbol?: string
  symbols?: string[]
  holdings?: HoldingInput[]
  asOf?: string
  startDate?: string
  endDate?: string
  phase?: 'midday' | 'after_close'
  sectorCode?: string
  sectorName?: string
  itemType?: 'stock' | 'etf'
  title?: string
}

export interface SectorConstituent {
  code: string
  name: string
  changePct?: number | null
}

export interface OhlcvPoint {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface Provenance {
  provider: 'ftshare'
  tool: string
  retrievedAt: string
  metadata?: JsonRecord
}

export interface FinancialSnapshot {
  balance?: JsonRecord[]
  income: JsonRecord[]
  cashflow: JsonRecord[]
}

export interface Snapshot {
  symbol: string
  name: string
  asOf: string
  quote: JsonRecord | null
  ohlcv: OhlcvPoint[]
  financial: FinancialSnapshot | null
  valuation: JsonRecord | null
  /** Latest stock-level capital-flow fact when the endpoint is available. */
  capitalFlow?: JsonRecord | null
  marginDetail?: JsonRecord | null
  /** Latest stock-level beta/risk fact when the endpoint is available. */
  beta?: JsonRecord | null
  announcements: JsonRecord[]
  research: JsonRecord[]
  provenance: Provenance[]
  dataGaps: string[]
  warnings: string[]
  permissions: PermissionNotice[]
  /** Permission failures that could not be satisfied by a fallback endpoint. */
  blockedPermissions?: PermissionNotice[]
}

export interface TechnicalSignals {
  latestClose: number | null
  ema5: number | null
  ema10: number | null
  ema20: number | null
  boll: {
    upper: number | null
    middle: number | null
    lower: number | null
  }
  macd: {
    dif: number | null
    dea: number | null
    histogram: number | null
  }
  rsi14: number | null
  kdj: {
    k: number | null
    d: number | null
    j: number | null
  }
  volumeRatio5To20: number | null
  coverage: {
    requestedPoints: number
    receivedPoints: number
    complete: boolean
  }
  /** Point-aligned overlays/oscillators used by the K-line renderer. */
  series?: {
    dates: string[]
    ema5: Array<number | null>
    ema10: Array<number | null>
    ema20: Array<number | null>
    bollUpper: Array<number | null>
    bollMiddle: Array<number | null>
    bollLower: Array<number | null>
    macdDif: Array<number | null>
    macdDea: Array<number | null>
    macdHistogram: Array<number | null>
  }
  methodology: string
}

export interface ReportToolResult {
  status: 'complete' | 'degraded' | 'permission_required'
  reportType: ReportType
  symbol?: string
  asOf: string
  /** Browser-facing filename; the report is not persisted unless configured explicitly. */
  reportFilename: string
  /** The rendered report retained for the Web preview/download card. */
  reportHtml: string
  /** Pre-rendered export artifacts encoded for the browser download card. */
  reportPdfBase64?: string
  reportPngBase64?: string
  /** Present only when Config.saveToWorkspace is true. */
  reportPath?: string
  structuredReport: JsonRecord | null
  evidence: JsonRecord
  provenance: Provenance[]
  freshness: JsonRecord
  dataGaps: string[]
  warnings: string[]
  permissions: PermissionNotice[]
  llm: {
    attempted: boolean
    used: boolean
    rounds: number
    provider: string
    model: string
  }
}
