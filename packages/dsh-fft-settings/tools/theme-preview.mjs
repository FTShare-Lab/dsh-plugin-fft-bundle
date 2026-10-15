/**
 * 主题预览：不开宿主，直接把设置卡片在**两套宿主调色板**下的实际取色打出来。
 *
 * 把 DSH 的主题样式表（`thirdparty/deepseek-harness` 里的 design-platform/base）
 * 与插件自己的 CSS 拼成一个页面，页面脚本在浅色与深色下各读一次
 * `getComputedStyle`，再用无头 Chromium 的 `--dump-dom` 把结果取回。因此它核对的
 * 是**真机行为**：alias 是否在卡片根上解析、`color-mix` 算成了什么、哪一项其实
 * 两套主题同值。静态守护见 `tests/theme.test.mjs`，两者互补。
 *
 * 用法：`pnpm build && pnpm theme:preview`（脚本读 `lib/`，所以先构建）。
 * 前置：本机有 Playwright 的 chromium 缓存，或有 `DSH_THEME_BROWSER` 指向
 * chrome-headless-shell/chromium 可执行文件；`DSH_HARNESS_ROOT` 可指向别的 DSH 检出。
 * 生成的页面留在 `tmp/theme-preview/page.html`，可以直接用浏览器打开对着看。
 * 退出码 0 = 每个该随主题变的 token 都变了。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETTINGS_CSS } from '../lib/core/styles.js'
import { API_KEY_CARD_CSS } from '../lib/features/api-key/styles.js'
import { LOGS_CARD_CSS } from '../lib/features/logs/styles.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')

/** The two token-only stylesheets the theme is published through. */
const HOST_SHEETS = ['design-platform.css', 'base.css']

/** Cards whose computed colours the preview reports, as `label → selector + property`. */
const PROBES = [
  ['page', 'body', 'background-color'],
  ['text', '.ftshare-settings', 'color'],
  ['card fill', '.ftshare-card', 'background-color'],
  ['card stroke', '.ftshare-card', 'border-top-color'],
  ['eyebrow', '.ftshare-eyebrow', 'color'],
  ['input fill', 'input', 'background-color'],
  ['input stroke', 'input', 'border-top-color'],
  ['button fill', 'button.primary', 'background-color'],
  ['button ink', 'button.primary', 'color'],
  ['error', '.ftshare-error', 'color'],
  ['link', 'p a', 'color'],
  ['log preview', '.ftshare-log-preview', 'background-color'],
]

/** Branded tokens that are meant to look the same in both palettes. */
const SCHEME_INVARIANT = new Set(['button fill', 'button ink'])

/** Markup mirror of the two built-in cards — keep the class names in step with them. */
const MARKUP = `
<section class="ftshare-settings">
  <header><div><span class="ftshare-eyebrow">FTSHARE / API KEY</span><h2>访问凭据</h2></div></header>
  <p>说明文字，含 <a href="#doc">文档链接</a></p>
  <div class="ftshare-card"><label for="ftshare-api-key">FTShare API Key</label>
    <input id="ftshare-api-key" placeholder="粘贴 API Key">
    <div class="ftshare-actions"><button class="primary" type="button">配置并测试</button><button type="button">清除</button></div>
    <div class="ftshare-result"><dt>远端服务</dt><dd>正常</dd></div>
    <p class="ftshare-error" role="alert">错误示例</p>
  </div>
  <div class="ftshare-card"><select id="ftshare-log-lines"><option>200</option></select>
    <pre class="ftshare-log-preview">log line</pre>
    <a class="ftshare-download" href="#" download="">导出诊断包</a>
  </div>
</section>`

/** Resolve the harness checkout that owns the host's theme stylesheets. */
function stylesheetDir() {
  const root = process.env.DSH_HARNESS_ROOT ?? resolve(REPO_ROOT, 'thirdparty/deepseek-harness')
  const directory = join(root, 'packages/client/ui-theme/src/styles')
  if (!existsSync(directory)) {
    throw new Error(`找不到宿主主题样式表：${directory}（用 DSH_HARNESS_ROOT 指向一个 DSH 检出）`)
  }
  return directory
}

/** Resolve the headless browser: explicit override first, then the Playwright cache. */
function browserPath() {
  if (process.env.DSH_THEME_BROWSER !== undefined) return process.env.DSH_THEME_BROWSER
  const cache = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright')
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-'))) {
      const binary = join(cache, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
      if (existsSync(binary)) return binary
    }
  }
  throw new Error('找不到无头 Chromium：装一次 `npx playwright install chromium-headless-shell`，或用 DSH_THEME_BROWSER 指向可执行文件')
}

/** The page: host palettes, then our CSS, then the probe that reads both schemes back. */
function page(hostCss) {
  const reads = PROBES.map(([label, selector, property]) => `    ${JSON.stringify(label)}: read(${JSON.stringify(selector)}, ${JSON.stringify(property)}),`).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${hostCss}</style><style>${SETTINGS_CSS}${API_KEY_CARD_CSS}${LOGS_CARD_CSS}</style></head>
<body>${MARKUP}<pre id="probe"></pre>
<script>
(() => {
  const read = (selector, property) => getComputedStyle(document.querySelector(selector)).getPropertyValue(property).trim()
  const sample = () => ({
${reads}
  })
  const light = sample()
  // Exactly what ui-layout's presenter does when the resolved theme is dark.
  document.body.setAttribute('data-ds-dark-theme', '')
  document.documentElement.style.colorScheme = 'dark'
  const dark = sample()
  document.getElementById('probe').textContent = JSON.stringify({ light, dark })
})()
</script></body></html>`
}

const hostCss = HOST_SHEETS.map(name => readFileSync(join(stylesheetDir(), name), 'utf8')).join('\n')
// House rule: scratch files go to the package's own tmp/, never the system temp dir.
const directory = join(PACKAGE_ROOT, 'tmp/theme-preview')
mkdirSync(directory, { recursive: true })
const file = join(directory, 'page.html')
writeFileSync(file, page(hostCss))

const dom = execFileSync(browserPath(), [
  '--headless',
  // DSH's own sandbox blocks Chromium's; the preview only ever reads a local file.
  '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
  `--user-data-dir=${join(directory, 'profile')}`,
  '--dump-dom', `file://${file}`,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const printed = /<pre id="probe">([\s\S]*?)<\/pre>/.exec(dom)
if (printed === null || printed[1].trim() === '') throw new Error('页面没有写回结果——探针没跑起来')
const { light, dark } = JSON.parse(printed[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'))

console.log('property'.padEnd(14), 'light'.padEnd(28), 'dark')
const unchanged = []
for (const [label] of PROBES) {
  const same = light[label] === dark[label]
  if (same && !SCHEME_INVARIANT.has(label)) unchanged.push(label)
  console.log(label.padEnd(14), String(light[label]).padEnd(28), dark[label], same ? (SCHEME_INVARIANT.has(label) ? '  (brand, 故意同值)' : '  <-- 两套主题同值') : '')
}
console.log(unchanged.length === 0
  ? '\nPASS：卡片跟随宿主调色板（只有品牌填充色与它的 ink 同值）'
  : `\nFAIL：这些 token 在浅色与深色下同值：${unchanged.join('、')}`)
process.exit(unchanged.length === 0 ? 0 : 1)
