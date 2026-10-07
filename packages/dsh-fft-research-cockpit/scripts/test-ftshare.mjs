import { calculateTechnicalSignals } from '../lib/indicators.js'
import { FtShareClient } from '../lib/ftshare-client.js'
import { loadSnapshot } from '../lib/ftshare-data.js'

const symbol = process.argv[2] || '300750'
const asOf = process.argv[3] || new Date().toISOString().slice(0, 10)

if (!process.env.FTSHARE_API_KEY?.trim()) {
  console.error('缺少 FTSHARE_API_KEY；请在同一个 shell 中先 export，再运行本脚本。')
  process.exit(2)
}

const client = new FtShareClient(process.env.FTSHARE_MCP_URL || 'https://market.ft.tech/gateway/mcp')
try {
  const snapshot = await client.withSession(
    new AbortController().signal,
    session => loadSnapshot(session, symbol, asOf, 120, new AbortController().signal),
  )
  const technical = calculateTechnicalSignals(snapshot.ohlcv, 120)
  console.log(JSON.stringify({
    symbol: snapshot.symbol,
    name: snapshot.name,
    asOf: snapshot.asOf,
    quote: snapshot.quote,
    rows: {
      ohlcv: snapshot.ohlcv.length,
      income: snapshot.financial?.income.length ?? 0,
      cashflow: snapshot.financial?.cashflow.length ?? 0,
      announcements: snapshot.announcements.length,
      research: snapshot.research.length,
    },
    technical,
    valuation: snapshot.valuation,
    dataGaps: snapshot.dataGaps,
    warnings: snapshot.warnings,
    provenance: snapshot.provenance.map(item => ({ provider: item.provider, tool: item.tool })),
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
