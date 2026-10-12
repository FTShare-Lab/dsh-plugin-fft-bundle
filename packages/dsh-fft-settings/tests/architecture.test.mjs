// 架构守护：核心缝不认识任何特性。
//
// 与 DSH 自己的 verify-client-domain-graph 同性质——「core 不得 import
// features，特性只能用 core 的通用类型与工具」这条约束靠 grep 测试守住，
// 而不是靠约定。目录边界一旦被无声打破（核心出现特性词汇、或反向依赖
// features/），这里就会变红。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CORE = new URL('../src/core/', import.meta.url)

/** Every file under one directory, recursively. */
async function filesBelow(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) found.push(...await filesBelow(child))
    else found.push(child)
  }
  return found
}

/** Feature vocabulary the generic seam must never learn. */
const FORBIDDEN = [
  ['an apiKey term', /api[ _-]?key/i],
  ['credential vocabulary', /\bcredentials?\b/i],
  ['probe vocabulary', /\bprobe/i],
  ['a path into features/', /features\//],
]

test('the core seam carries no feature vocabulary and depends on no feature', async () => {
  const files = await filesBelow(CORE)
  assert.ok(files.length >= 6, `expected the core seam files, found ${files.length}`)
  for (const file of files) {
    const label = fileURLToPath(file).split('/src/')[1]
    const source = await readFile(file, 'utf8')
    for (const [what, pattern] of FORBIDDEN) assert.doesNotMatch(source, pattern, `${label} mentions ${what}`)
  }
})
