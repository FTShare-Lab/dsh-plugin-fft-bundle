/**
 * The kline FTShare-wrapper mask has to name tools that kline really publishes.
 *
 * A mask that names an unknown tool cannot silently "do nothing": the row
 * intersects its list with the visible set, so a typo or an upstream rename
 * would quietly stop masking that tool while every test stayed green. This test
 * pins the list against the installed kline package's own `@mcp.tool(name=…)`
 * declarations, the same way `kline-rows.test.mjs` pins the mirrored patch rows.
 *
 * The mask deliberately does NOT cover `configure_ftshare` /
 * `test_ftshare_connection` / `data_source_status`: those belong to kline's own
 * settings and self-check surface and the sidebar still drives them.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { MASKED_KLINE_TOOLS, publicToolName } from '@dsh-ft/dsh-fft-ftshare/mask'

const require = createRequire(import.meta.url)

/** Read kline's declared MCP tool names out of its `server.py`. */
function klineToolNames() {
  const serverPy = resolve(dirname(require.resolve('@ftshare-lab/dsh-kline/package.json')), 'server.py')
  const source = readFileSync(serverPy, 'utf8')
  return {
    serverPy,
    names: new Set([...source.matchAll(/@mcp\.tool\(\s*name\s*=\s*"([^"]+)"/gu)].map(match => match[1])),
  }
}

describe('ftshare kline-wrapper mask', () => {
  it('names MCP public names on the dsh-kline server', () => {
    for (const tool of MASKED_KLINE_TOOLS) {
      assert.equal(publicToolName(tool), `mcp__dsh-kline__${tool}`, `${tool} 的公共名格式不对`)
    }
  })

  it('is a subset of the tool names kline really declares', () => {
    const { serverPy, names } = klineToolNames()
    assert.ok(names.size > 0, `没能从 ${serverPy} 里读到任何 @mcp.tool`)
    const unknown = MASKED_KLINE_TOOLS.filter(tool => !names.has(tool))
    assert.deepEqual(unknown, [], `掩码名单里有 kline 不存在的工具（${serverPy}）`)
  })

  it('keeps the three FTShare wrappers and nothing else', () => {
    // 名单的边界是人为决定的：只掩直接对接 FTShare 网关的 wrapper。多一个少一个
    // 都要人来改，测试只负责把决定钉住。
    assert.deepEqual([...MASKED_KLINE_TOOLS].sort(), ['market_board_detail', 'market_pulse', 'security_intelligence'])
  })

  it('leaves kline own settings and self-check tools visible', () => {
    const { names } = klineToolNames()
    for (const kept of ['configure_ftshare', 'test_ftshare_connection', 'data_source_status']) {
      assert.ok(names.has(kept), `${kept} 是 kline 自己的工具`)
      assert.ok(!MASKED_KLINE_TOOLS.includes(kept), `${kept} 属于 kline 的设置面，不该被掩`)
    }
  })
})
