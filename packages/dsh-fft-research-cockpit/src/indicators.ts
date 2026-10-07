import type { OhlcvPoint, TechnicalSignals } from './types.js'

function values(points: OhlcvPoint[], key: 'close' | 'volume'): number[] {
  return points.map(point => point[key]).filter((value): value is number => value !== null && Number.isFinite(value))
}

function average(input: number[], period: number): number | null {
  if (input.length < period) return null
  const window = input.slice(-period)
  return window.reduce((sum, value) => sum + value, 0) / period
}

function emaSeries(input: number[], period: number): number[] {
  if (input.length === 0) return []
  const alpha = 2 / (period + 1)
  const result = [input[0]]
  for (const value of input.slice(1)) result.push(alpha * value + (1 - alpha) * result.at(-1)!)
  return result
}

function alignedEmaSeries(points: OhlcvPoint[], period: number): Array<number | null> {
  const result: Array<number | null> = []
  let previous: number | null = null
  const alpha = 2 / (period + 1)
  for (const point of points) {
    const close = point.close
    if (close === null || !Number.isFinite(close)) {
      result.push(null)
      continue
    }
    previous = previous === null ? close : alpha * close + (1 - alpha) * previous
    result.push(previous)
  }
  return result
}

function rollingBollingerSeries(points: OhlcvPoint[], period = 20, multiplier = 2): {
  upper: Array<number | null>
  middle: Array<number | null>
  lower: Array<number | null>
} {
  const closes = points.map(point => point.close)
  const upper: Array<number | null> = []
  const middle: Array<number | null> = []
  const lower: Array<number | null> = []
  for (let index = 0; index < closes.length; index += 1) {
    const window = closes.slice(Math.max(0, index - period + 1), index + 1)
    if (window.length < period || window.some(value => value === null || !Number.isFinite(value))) {
      upper.push(null)
      middle.push(null)
      lower.push(null)
      continue
    }
    const numeric = window as number[]
    const mean = numeric.reduce((sum, value) => sum + value, 0) / period
    const variance = numeric.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period
    const deviation = Math.sqrt(Math.max(variance, 0))
    middle.push(mean)
    upper.push(mean + multiplier * deviation)
    lower.push(mean - multiplier * deviation)
  }
  return { upper, middle, lower }
}

function alignedMacdSeries(points: OhlcvPoint[]): {
  dif: Array<number | null>
  dea: Array<number | null>
  histogram: Array<number | null>
} {
  const ema12 = alignedEmaSeries(points, 12)
  const ema26 = alignedEmaSeries(points, 26)
  const dif: Array<number | null> = ema12.map((value, index) => {
    const slow = ema26[index]
    return value === null || slow === null ? null : value - slow
  })
  const dea: Array<number | null> = []
  const histogram: Array<number | null> = []
  let previous: number | null = null
  const alpha = 2 / (9 + 1)
  for (const value of dif) {
    if (value === null) {
      dea.push(null)
      histogram.push(null)
      continue
    }
    previous = previous === null ? value : alpha * value + (1 - alpha) * previous
    dea.push(previous)
    histogram.push((value - previous) * 2)
  }
  return { dif, dea, histogram }
}

function rsi(input: number[], period: number): number | null {
  if (input.length <= period) return null
  const changes = input.slice(1).map((value, index) => value - input[index])
  const recent = changes.slice(-period)
  const gains = recent.filter(value => value > 0).reduce((sum, value) => sum + value, 0) / period
  const losses = recent.filter(value => value < 0).reduce((sum, value) => sum - value, 0) / period
  if (losses === 0) return gains > 0 ? 100 : 50
  return 100 - 100 / (1 + gains / losses)
}

export function calculateTechnicalSignals(points: OhlcvPoint[], requestedPoints = 120): TechnicalSignals {
  const closes = values(points, 'close')
  const volumes = values(points, 'volume')
  const ema5 = emaSeries(closes, 5)
  const ema10 = emaSeries(closes, 10)
  const ema20 = emaSeries(closes, 20)
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)
  const difSeries = ema12.map((value, index) => value - (ema26[index] ?? value))
  const deaSeries = emaSeries(difSeries, 9)
  const dif = difSeries.at(-1) ?? null
  const dea = deaSeries.at(-1) ?? null
  const histogram = dif !== null && dea !== null ? (dif - dea) * 2 : null
  const recent = closes.slice(-20)
  const middle = average(closes, 20)
  const deviation = middle === null ? null : Math.sqrt(recent.reduce((sum, value) => sum + (value - middle) ** 2, 0) / recent.length)
  const highs = points.slice(-9).map(point => point.high).filter((value): value is number => value !== null)
  const lows = points.slice(-9).map(point => point.low).filter((value): value is number => value !== null)
  const latest = closes.at(-1) ?? null
  const high9 = highs.length ? Math.max(...highs) : null
  const low9 = lows.length ? Math.min(...lows) : null
  const rsv = latest !== null && high9 !== null && low9 !== null && high9 !== low9
    ? (latest - low9) / (high9 - low9) * 100
    : null
  const k = rsv
  const d = k === null ? null : (50 * 2 + k) / 3
  const j = k !== null && d !== null ? 3 * k - 2 * d : null
  const volume5 = average(volumes, 5)
  const volume20 = average(volumes, 20)
  const seriesEma5 = alignedEmaSeries(points, 5)
  const seriesEma10 = alignedEmaSeries(points, 10)
  const seriesEma20 = alignedEmaSeries(points, 20)
  const seriesBoll = rollingBollingerSeries(points)
  const seriesMacd = alignedMacdSeries(points)

  return {
    latestClose: latest,
    ema5: ema5.at(-1) ?? null,
    ema10: ema10.at(-1) ?? null,
    ema20: ema20.at(-1) ?? null,
    boll: {
      upper: middle !== null && deviation !== null ? middle + 2 * deviation : null,
      middle,
      lower: middle !== null && deviation !== null ? middle - 2 * deviation : null,
    },
    macd: { dif, dea, histogram },
    rsi14: rsi(closes, 14),
    kdj: { k, d, j },
    volumeRatio5To20: volume5 !== null && volume20 !== null && volume20 !== 0 ? volume5 / volume20 : null,
    coverage: {
      requestedPoints,
      receivedPoints: points.length,
      complete: points.length >= requestedPoints,
    },
    series: {
      dates: points.map(point => point.date),
      ema5: seriesEma5,
      ema10: seriesEma10,
      ema20: seriesEma20,
      bollUpper: seriesBoll.upper,
      bollMiddle: seriesBoll.middle,
      bollLower: seriesBoll.lower,
      macdDif: seriesMacd.dif,
      macdDea: seriesMacd.dea,
      macdHistogram: seriesMacd.histogram,
    },
    methodology: '基于 FTShare 日线 OHLCV 确定性计算；EMA、BOLL、MACD、RSI14、KDJ 使用标准窗口，成交量比为近5日均量/近20日均量。',
  }
}
