/**
 * 目录（catalog）：上游接口的**全量快照**，回答「上游有什么」。
 *
 * 与接口表（`capabilities.ts`，回答「我们承接什么」）不是一回事。目录由
 * `scripts/build-catalog.mjs` 从 `tools/list` 生成，随包发布两份产物：
 * `catalog.json`（完整，含 `description` 与 `inputSchema`）与 `catalog.txt`
 * （一线索引，供模型 `grep`）。本模块只做纯函数——查名字、读必填入参——因此宿主
 * 与浏览器两侧都能用；读文件的那一半在 `catalog-host.ts`。
 * @module @dsh-ft/dsh-fft-ftshare/catalog
 */

/** 目录里的一条：接口名、标题、上游说明与入参 JSON Schema。 */
export interface CatalogEntry {
  /** 上游接口名，例如 `ft_v1_finance_income`。 */
  name: string
  /** 上游标题。 */
  title: string
  /** 上游说明原文。 */
  description?: string
  /** 上游入参 JSON Schema 原文，未做任何改写。 */
  inputSchema?: unknown
}

/** 随包的完整目录产物。 */
export interface Catalog {
  /** 全部条目，按接口名排序。 */
  entries: readonly CatalogEntry[]
}

/** 判断一个值是不是可当对象读的记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把任意解析结果收敛成目录。字段缺失的条目直接丢掉而不是留半条：目录是准入判据，
 * 半条会让「在目录里」这个断言变得没有意义。
 * @param value - `catalog.json` 的解析结果。
 * @returns 目录；形状不对时为空目录。
 */
export function asCatalog(value: unknown): Catalog {
  const raw = isRecord(value) && Array.isArray(value.entries) ? value.entries : []
  const entries: CatalogEntry[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '') continue
    entries.push({
      name: entry.name,
      title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : entry.name,
      ...typeof entry.description === 'string' && entry.description !== '' ? { description: entry.description } : {},
      ...entry.inputSchema !== undefined ? { inputSchema: entry.inputSchema } : {},
    })
  }
  return { entries }
}

/**
 * 按接口名查目录。
 * @param catalog - 目录。
 * @param name - 上游接口名。
 * @returns 条目；不在目录里时 undefined。
 */
export function catalogEntryOf(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.entries.find(entry => entry.name === name)
}

/**
 * 读出上游 `inputSchema.required` 里、这次调用没有给的入参名。
 *
 * 只查「有没有给」，不查类型与取值：本地能确定说出口的只有缺席，类型判断留给上游，
 * 免得把「上游其实能容忍的写法」判成错误。
 * @param entry - 目录条目。
 * @param args - 本次调用入参。
 * @returns 缺席的必填入参名，按 schema 顺序。
 */
export function missingRequiredArgs(entry: CatalogEntry, args: Record<string, unknown> | undefined): string[] {
  const schema = entry.inputSchema
  if (!isRecord(schema) || !Array.isArray(schema.required)) return []
  return schema.required.filter((name): name is string =>
    typeof name === 'string' && (args === undefined || args[name] === undefined || args[name] === null))
}
