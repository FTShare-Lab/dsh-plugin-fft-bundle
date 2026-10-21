#!/usr/bin/env node
/**
 * FT 子插件 UI 守卫：把 `docs/specs/ui/design.md` 的三条硬约束做成可执行检查。
 *
 * 检查项：
 *   1. 引用的 `--dsw-*` 必须在宿主 `ui-theme` 的基线样式表里有声明——这一条能挡下
 *      `text-primary`、`interactive-border-hover`、`divider-default` 这类幻影 token；
 *   2. feature 样式不得出现 `[data-ds-dark-theme]` 或 `prefers-color-scheme:`，主题选择器
 *      只属于主题所有者；
 *   3. `border-radius` 只用共享 token（胶囊 999px 与登记过的图画细节除外）；
 *   4. 含交互控件的包必须有 `:focus-visible`。
 *
 * 品牌 token 的「fallback 必须与 token 同值」不在这里：它由
 * `packages/dsh-fft-settings/tests/brand.test.mjs` 跨包执行，避免两处维护。
 *
 * 用法：`pnpm ui:audit`；读不到宿主检出时按配方跳过（与 settings 的主题用例一致）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')
const HOST_STYLES = process.env.DSH_HARNESS_ROOT
  ? join(process.env.DSH_HARNESS_ROOT, 'packages/client/ui-theme/src/styles')
  : join(ROOT, 'thirdparty/deepseek-harness/packages/client/ui-theme/src/styles')

/** Directories that never carry shipped browser chrome. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'tmp', 'docs', 'tests', 'scripts', 'resources'])
/** Vendored payloads are upstream's to style; the brand guard covers what we consume. */
const VENDOR = new Set(['dsh-ami-bundle'])
/** Files that render documents rather than plugin chrome. */
const SKIP_FILES = new Set([
  // The report HTML generator belongs to the report document, not to the dialog.
  'dsh-fft-research-cockpit/src/html-renderer.ts',
])
const EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.css'])

/** The token names the host base palette actually declares. */
function hostTokens() {
  const names = new Set()
  for (const file of readdirSync(HOST_STYLES)) {
    if (!file.endsWith('.css')) continue
    for (const match of readFileSync(join(HOST_STYLES, file), 'utf8').matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) {
      names.add(match[1])
    }
  }
  return names
}

/** One source file with its normalized repository label. */
function sources() {
  const found = []
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory() || VENDOR.has(entry.name)) continue
    const packageRoot = join(PACKAGES, entry.name)
    const walk = (directory) => {
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        if (SKIP_DIRS.has(child.name)) continue
        const path = join(directory, child.name)
        const label = relative(PACKAGES, path).split(sep).join('/')
        if (child.isDirectory()) walk(path)
        else if (EXTENSIONS.has(extname(child.name)) && !SKIP_FILES.has(label)) {
          found.push({ package: entry.name, label, text: readFileSync(path, 'utf8') })
        }
      }
    }
    walk(packageRoot)
  }
  return found
}

/** Registered exceptions, each with the reason it is not a violation. */
function allowlist() {
  const path = join(ROOT, 'scripts/ui-audit.allow.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

/** Report one finding at its line. */
const findings = []
function report(file, line, message) {
  findings.push({ file, line, message })
}

if (!existsSync(HOST_STYLES)) {
  console.log(`ui-audit: 跳过——读不到宿主主题样式表（${HOST_STYLES}）。`)
  console.log('          设置 DSH_HARNESS_ROOT 指向一个 DSH 检出即可运行。')
  process.exit(0)
}

const declared = hostTokens()
const allowed = allowlist()
const files = sources()
const perPackage = new Map()

for (const { package: name, label, text } of files) {
  const state = perPackage.get(name) ?? { interactive: false, focus: false }
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)) {
      if (!declared.has(match[1])) report(label, index + 1, `${match[1]} is not declared by the host palette`)
    }
    if (/\[data-ds-dark-theme\]|prefers-color-scheme\s*:/.test(line)) {
      report(label, index + 1, 'theme selector belongs to the theme owner, not a feature stylesheet')
    }
    for (const match of line.matchAll(/border-radius:\s*([0-9.]+)px/g)) {
      const value = Number(match[1])
      if (value === 999) continue
      const exempt = (allowed.radius ?? []).some(entry => entry.file === label && Number(entry.value) === value)
      if (!exempt) report(label, index + 1, `border-radius:${value}px is off the shared scale; use --dsw-radius-*`)
    }
    if (/\bbutton\s*[,{:.]/.test(line) || /createElement\(\s*['"]button['"]/.test(line)) state.interactive = true
    if (line.includes(':focus-visible')) state.focus = true
  }
  perPackage.set(name, state)
}

for (const [name, state] of perPackage) {
  if (state.interactive && !state.focus) report(`${name}/*`, 1, 'interactive styles have no :focus-visible rule')
}

if (findings.length === 0) {
  console.log(`ui-audit: ${files.length} 个源文件通过（宿主 token 存在、无主题选择器、圆角在尺度上、焦点可见）。`)
  process.exit(0)
}
for (const { file, line, message } of findings) console.error(`${file}:${line}  ${message}`)
console.error(`\nui-audit: ${findings.length} 处不符合 docs/specs/ui/design.md 的基线。`)
process.exit(1)
