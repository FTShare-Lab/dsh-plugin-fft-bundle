/**
 * 生成随包目录产物：`catalog.json`（全量快照）、`catalog.txt`（一线索引）与
 * `catalog.meta.json`（条目数与生成时间）。
 *
 * 目录回答的是「上游有什么」，与接口表（`src/capabilities.ts`，「我们承接什么」）
 * 是两件事。模型用 `grep` 查索引，宿主路由与浏览器用完整 JSON 校验接口名。
 *
 * ```bash
 * pnpm build && node scripts/build-catalog.mjs            # 匿名会话拉 tools/list
 * node scripts/build-catalog.mjs --tools <tools.json>     # 用本地快照重生成（离线）
 * node scripts/build-catalog.mjs --check                  # 重生成并与盘上产物比对
 * ```
 *
 * 产物必须可复现：同样输入产出字节相同的结果，所以时间戳只写进 `catalog.meta.json`，
 * 条目按接口名排序，JSON 用固定缩进。
 * @module @dsh-ft/dsh-fft-ftshare/build-catalog
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { FTSHARE_GATEWAY_ENDPOINT, createFtshareTransport } from '../lib/transport.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const CATALOG_JSON = new URL('../catalog.json', import.meta.url)
const CATALOG_TXT = new URL('../catalog.txt', import.meta.url)
const CATALOG_META = new URL('../catalog.meta.json', import.meta.url)

/** 参数解析：只认 `--tools <path>` 与 `--check`。 */
function parseArgs(argv) {
  const options = { toolsPath: undefined, check: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') options.check = true
    else if (arg === '--tools') {
      index += 1
      options.toolsPath = argv[index]
      if (options.toolsPath === undefined) throw new Error('--tools 需要跟一个文件路径')
    } else throw new Error(`未知参数：${arg}`)
  }
  return options
}

/**
 * 把一次 `tools/list` 的原始应答规整成目录条目。
 *
 * 只留四样：接口名、标题、说明、入参 schema。排序是为了可复现——上游的返回顺序
 * 不构成契约，按名字排才能「同样输入产出同样字节」。
 * @param listed - `transport.listTools()` 的返回。
 * @returns 排序后的条目。
 */
export function toCatalogEntries(listed) {
  return listed
    .map(entry => ({
      name: entry.tool,
      title: entry.title,
      ...entry.description !== undefined ? { description: entry.description } : {},
      ...entry.inputSchema !== undefined ? { inputSchema: entry.inputSchema } : {},
    }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

/**
 * 一线索引：一行一个接口，`名字 | 标题 | 入参`，必填入参带 `*`。
 *
 * 存在的理由是提示词预算：模型 grep 这一份就够选接口，不必读 444 KB 的完整 JSON。
 * @param entries - 目录条目。
 * @returns 以换行结尾的索引文本。
 */
export function renderIndex(entries) {
  const lines = entries.map(entry => {
    const schema = entry.inputSchema
    const properties = schema !== null && typeof schema === 'object' && typeof schema.properties === 'object' && schema.properties !== null
      ? Object.keys(schema.properties)
      : []
    const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
    const args = properties.map(name => required.has(name) ? `${name}*` : name).join(',')
    return `${entry.name} | ${entry.title} | ${args}`
  })
  return `${lines.join('\n')}\n`
}

/**
 * 渲染三份产物。纯函数，便于测试断言可复现性。
 * @param entries - 目录条目。
 * @param generatedAt - 生成时点（ISO-8601）。
 * @returns 产物文件名到内容的映射。
 */
export function renderArtifacts(entries, generatedAt) {
  const catalog = `${JSON.stringify({ entries }, undefined, 2)}\n`
  const index = renderIndex(entries)
  const meta = `${JSON.stringify({
    count: entries.length,
    generatedAt,
    endpoint: FTSHARE_GATEWAY_ENDPOINT,
    catalogBytes: Buffer.byteLength(catalog),
    indexBytes: Buffer.byteLength(index),
  }, undefined, 2)}\n`
  return { catalog, index, meta }
}

/** 读盘上的产物内容；缺失时返回 undefined。 */
function readArtifact(url) {
  try {
    return readFileSync(url, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * 命令行主流程。
 * @param argv - 去掉 `node <script>` 之后的参数。
 */
async function main(argv) {
  const options = parseArgs(argv)

  let listed
  if (options.toolsPath !== undefined) {
    const raw = JSON.parse(readFileSync(options.toolsPath, 'utf8'))
    const tools = Array.isArray(raw) ? raw : raw.tools
    listed = tools.map(entry => ({
      tool: entry.name,
      title: entry.title ?? entry.name,
      ...entry.description !== undefined ? { description: entry.description } : {},
      ...entry.inputSchema !== undefined ? { inputSchema: entry.inputSchema } : {},
    }))
  } else {
    // 匿名会话：`tools/list` 不需要 Key，目录因此不依赖任何凭据。
    const transport = createFtshareTransport({ resolveApiKey: async () => undefined })
    listed = await transport.listTools()
  }

  const entries = toCatalogEntries(listed)
  const artifacts = renderArtifacts(entries, new Date().toISOString())

  if (options.check) {
    const drifted = []
    if (readArtifact(CATALOG_JSON) !== artifacts.catalog) drifted.push('catalog.json')
    if (readArtifact(CATALOG_TXT) !== artifacts.index) drifted.push('catalog.txt')
    if (drifted.length > 0) {
      console.error(`✗ 目录产物与上游不一致：${drifted.join('、')}；跑 node scripts/build-catalog.mjs 重新生成`)
      process.exit(1)
    }
    console.log(`✓ 目录产物与上游一致（${entries.length} 条）`)
    return
  }

  writeFileSync(CATALOG_JSON, artifacts.catalog)
  writeFileSync(CATALOG_TXT, artifacts.index)
  writeFileSync(CATALOG_META, artifacts.meta)
  console.log(`✓ 已写出 ${entries.length} 条目录：${packageRoot}catalog.json / catalog.txt / catalog.meta.json`)
}

// 只有被当脚本跑时才连网关；被测试 import 时只拿纯函数。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2))
}
