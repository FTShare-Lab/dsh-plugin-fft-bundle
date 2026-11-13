/**
 * 发布包裁剪表：哪些文件不该进 npm tarball。
 *
 * 内联的 kline 归档是 `git archive` 原样解出来的，于是它的商店截图（`docs/`）、
 * 提交在库里的 sourcemap（`lib/client.js.map`）、tsc 中间产物（`lib/client/`，
 * 内容已内联进 `lib/client.js`——`./client` 只导出它）以及只被 kline 自己的构建
 * 脚本读取的 `view/kline.html` 都跟着走。装完之后没有任何代码读这些文件。
 *
 * 规则只作用于打包时的暂存副本，从不改动任何 checkout；上游包自己的 `files`
 * 白名单保持原样——正解属于 dsh_kline，在那之前由本仓决定内联什么。
 *
 * 规则是 `/` 分隔的路径或 glob：`*` 只在同段内匹配，`**` 跨段，命中目录即删整棵
 * 子树。命中 0 条规则只告警不报错（上游可能已经自己清理了）。
 */
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const PRUNE = {
  '@ftshare-lab/dsh-kline': [
    'docs', // 商店截图与验收记录，安装后不读
    'screenshots.json', // 商店清单归属上游仓库，不在安装包里
    'lib/client', // tsc 中间产物；./client 只指向 lib/client.js
    'lib/client.js.map', // 调试用 sourcemap，且 sources 指向未随包发布的 src/
    'view/kline.html', // kline 自己的 generate-client-view.mjs 构建输入
  ],
}

/**
 * 把一条裁剪规则翻译成匹配 `/` 分隔相对路径的正则。
 * @param {string} rule - PRUNE 里的一条路径或 glob。
 * @returns {RegExp} 命中目录时同时覆盖其子树。
 */
export function pruneMatcher(rule) {
  const escaped = rule.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u0000/gu, '.*')
  return new RegExp(`^${escaped}(?:/.*)?$`, 'u')
}

/**
 * 从一个暂存包目录里删掉裁剪表命中的文件，并统计省下的字节数。
 * @param {string} name - 包名，PRUNE 的键。
 * @param {string} dir - 暂存包目录；绝不传 checkout。
 * @param {{rules?: string[]}} [options] - 覆盖规则表，仅供测试。
 * @returns {{removed: string[], unmatched: string[], bytes: number}} 裁剪结果。
 */
export function pruneStaged(name, dir, options = {}) {
  const rules = options.rules ?? PRUNE[name] ?? []
  const matchers = rules.map(rule => ({ rule, test: pruneMatcher(rule) }))
  const hits = new Map(matchers.map(matcher => [matcher.rule, 0]))
  const removed = []
  let bytes = 0

  /** @param {string} relative - 相对 `dir` 的目录，根为 `''`。 */
  const walk = relative => {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      const hit = matchers.find(matcher => matcher.test.test(path))
      if (hit !== undefined) {
        bytes += sizeOf(join(dir, path))
        removed.push(path)
        hits.set(hit.rule, hits.get(hit.rule) + 1)
        rmSync(join(dir, path), { recursive: true, force: true })
        continue
      }
      if (entry.isDirectory()) walk(path)
    }
  }
  walk('')

  const unmatched = [...hits].filter(([, count]) => count === 0).map(([rule]) => rule)
  return { removed, unmatched, bytes }
}

/**
 * 一个暂存文件或目录树的字节数。
 * @param {string} path - 绝对路径。
 * @returns {number} 字节数。
 */
function sizeOf(path) {
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.size
  let bytes = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    bytes += entry.isDirectory() ? sizeOf(child) : statSync(child).size
  }
  return bytes
}
