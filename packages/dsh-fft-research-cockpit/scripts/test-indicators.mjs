import assert from 'node:assert/strict'
import { calculateTechnicalSignals } from '../lib/indicators.js'

const points = Array.from({ length: 45 }, (_, index) => {
  const close = 10 + Math.sin(index / 3) * 0.8 + index * 0.025
  return {
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close - 0.08,
    high: close + 0.25,
    low: close - 0.25,
    close,
    volume: 100000 + index * 2500,
  }
})

const result = calculateTechnicalSignals(points, 120)
assert.ok(result.series, 'series should be present for chart rendering')
assert.equal(result.series.dates.length, points.length)
for (const key of ['ema5', 'ema10', 'ema20', 'bollUpper', 'bollMiddle', 'bollLower', 'macdDif', 'macdDea', 'macdHistogram']) {
  assert.equal(result.series[key].length, points.length, `${key} must stay aligned with OHLCV points`)
}
assert.ok(result.series.bollUpper.slice(19).some(value => value !== null), 'BOLL should become available after 20 closes')
assert.ok(new Set(result.series.bollMiddle.slice(19).filter(value => value !== null).map(value => value.toFixed(6))).size > 1, 'BOLL middle must not be a repeated latest constant')
assert.ok(new Set(result.series.macdHistogram.slice(25).filter(value => value !== null).map(value => value.toFixed(6))).size > 1, 'MACD histogram must be point-aligned and vary over time')

console.log('indicator-series: ok')
