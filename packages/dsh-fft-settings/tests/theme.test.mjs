// 主题层：插件 token 与 DSH 调色板之间的映射。
//
// 本插件的 UI 曾把深色调色板写死在 CSS 字面量里，于是在 DSH 白天主题下它仍然是
// 一块深色卡片。现在调色板只有一个来源：`SETTINGS_CSS` 中声明在 `.ftshare-settings`
// （每张卡片的根元素）上的 `--ftshare-*`，取值来自宿主调色板 `--dsw-alias-*`。
// 这组用例钉住五件事：
//   1. 调色板只声明一处，卡片不自带颜色字面量，也不引用无人声明的 token；
//   2. 声明落在卡片根而不是 `:root`——自定义属性在它被声明的地方求值，而
//      `--dsw-alias-*` 只在 `body` 及其后代存在，写到 `:root` 上会静默退回字面量；
//   3. 用到的宿主 token 真的在 DSH 的调色板样式表里，且解析值随主题一起变；
//   4. 文字与其所在表面满足对比度下限，白天主题下品牌黄依然可读；
//   5. 组件几何只消费共享圆角尺度（`--dsw-radius-*`），不写 7/12px 这类私值。
// 第 3、4 条要读 DSH 源码（`thirdparty/` 不入库），取不到时按配方跳过。

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SETTINGS_CSS } from '../lib/core/styles.js'
import { API_KEY_CARD_CSS } from '../lib/features/api-key/styles.js'
import { LOGS_CARD_CSS } from '../lib/features/logs/styles.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The sheets a card renders, by the name a failure should report. */
const CARD_SHEETS = { 'the api-key card': API_KEY_CARD_CSS, 'the logs card': LOGS_CARD_CSS }

/** Every sheet this plugin puts on the page, token declarations included. */
const ALL_SHEETS = { 'the section shell': SETTINGS_CSS, ...CARD_SHEETS }

/**
 * The published token contract: the card root declares these and nothing else,
 * so a card — ours or a third party's — may read any of them and no more.
 * `--ftshare-accent*` is this plugin's brand; the rest are host palette.
 */
const TOKENS = [
  'text', 'muted', 'panel', 'border', 'control', 'input', 'link', 'error',
  'accent', 'accent-ink', 'accent-on-surface',
]

/** Tokens that must resolve to a different value in the dark palette. */
const SCHEME_DEPENDENT = ['text', 'muted', 'panel', 'border', 'control', 'input', 'link', 'error']

/** Body attribute selecting DSH's dark palette; the presenter toggles it from `active.colorScheme`. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Strip comments and split a flat stylesheet into `selector { body }` pairs. */
function rules(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/g, ' '), body }))
}

/** Every `--name: value;` declaration in one rule body. */
function declarations(body) {
  return [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
}

/** The one rule that declares this plugin's tokens. */
function tokenRule() {
  const rule = rules(SETTINGS_CSS).find(candidate => candidate.body.includes('--ftshare-'))
  assert.ok(rule, 'SETTINGS_CSS declares no --ftshare-* token')
  return { selector: rule.selector, values: new Map(declarations(rule.body)) }
}

/** Token names read through `var()` in one sheet. */
function used(css) {
  return [...css.matchAll(/var\(\s*--ftshare-([a-z0-9-]+)\s*(,?)/g)].map(([, name, fallback]) => ({ name, fallback }))
}

/** The DSH theme stylesheets, or null when no harness checkout is reachable. */
function stylesheets() {
  const root = process.env.DSH_HARNESS_ROOT ?? resolve(PACKAGE_ROOT, '../..', 'thirdparty/deepseek-harness')
  const directory = join(root, 'packages/client/ui-theme/src/styles')
  return existsSync(directory) ? directory : null
}

/** Passed to every test that reads the palette, so an unreachable copy skips with the recipe. */
const SKIP_PALETTE = stylesheets() === null
  ? 'cannot reach the DSH theme stylesheets: set DSH_HARNESS_ROOT to a harness checkout to run the palette guard'
  : false

/** Host palette per scheme: `--dsw-*` name → declared value, light block first. */
function palette() {
  const directory = stylesheets()
  const light = new Map()
  const dark = new Map()
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.css')) continue
    for (const { selector, body } of rules(readFileSync(join(directory, file), 'utf8'))) {
      // `html[data-platform='darwin'] …` blocks retune native chrome, not the alias palette.
      const target = selector.includes(DARK_ATTRIBUTE) && !selector.includes('data-platform') ? dark
        : selector === 'body' || selector === ':root' ? light
          : null
      if (target === null) continue
      for (const [name, value] of declarations(body)) target.set(name, value)
    }
  }
  assert.ok(light.size > 100 && dark.size > 100, `the palette read as ${light.size} light / ${dark.size} dark tokens — DSH renamed its palette blocks`)
  return { light, dark }
}

/** Follow `var()` chains, preferring this plugin's own declarations, then the scheme's palette. */
function substitute(value, scheme, tokens, host) {
  let text = value
  for (let round = 0; round < 20 && text.includes('var('); round++) {
    text = text.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^(),]*))?\)/g, (_, name, fallback) => {
      const found = tokens.get(name) ?? host[scheme].get(name) ?? host.light.get(name)
      return found ?? (fallback ?? `UNRESOLVED(${name})`).trim()
    })
  }
  return text.trim()
}

/** Parse an opaque `#rgb`/`#rrggbb`/`rgb()` colour into 0..255 channels. */
function parseColor(text) {
  const value = text.trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex !== null) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(d => d + d).join('') : hex[1]
    const [red, green, blue] = [0, 2, 4].map(offset => Number.parseInt(digits.slice(offset, offset + 2), 16))
    return [red, green, blue, digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1]
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value)
  assert.ok(rgb !== null, `not a colour: ${value}`)
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
}

/** Evaluate the one colour-mix shape the token layer uses: two stops, weighted, in srgb. */
function colorMix(text, scheme, tokens, host) {
  const match = /^color-mix\(in srgb,(.+?)\s+([\d.]+)%,(.+)\)$/.exec(text.trim())
  assert.ok(match !== null, `unsupported colour mix: ${text}`)
  const [start, end] = [substitute(match[1], scheme, tokens, host), substitute(match[3], scheme, tokens, host)]
  const weight = Number(match[2]) / 100
  const [left, right] = [parseColor(start), parseColor(end)]
  return [...left.slice(0, 3).map((channel, index) => channel * weight + right[index] * (1 - weight)), 1]
}

/** Resolve one plugin token under one scheme to channels plus alpha. */
function resolveToken(name, scheme, tokens, host) {
  const declared = tokens.get(`--ftshare-${name}`)
  assert.ok(declared !== undefined, `--ftshare-${name} is not declared`)
  const value = substitute(declared, scheme, tokens, host)
  return value.startsWith('color-mix(') ? colorMix(value, scheme, tokens, host) : parseColor(value)
}

/** WCAG relative luminance of an opaque colour; a translucent one has no single ratio. */
function luminance([red, green, blue, alpha]) {
  assert.equal(alpha, 1, 'contrast is measured on opaque colours only')
  const [r, g, b] = [red, green, blue].map(channel => {
    const scaled = channel / 255
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two resolved colours. */
function contrast(left, right) {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

test('the palette is declared once, on the root element every card renders', () => {
  const { selector, values } = tokenRule()
  // Not `:root`: a custom property resolves where it is declared, and the host
  // palette only exists from `body` downwards.
  assert.equal(selector, '.ftshare-settings')
  assert.deepEqual([...values.keys()].sort(), TOKENS.map(name => `--ftshare-${name}`).sort())

  // No second declaration site anywhere: one palette, one place to change it.
  for (const [sheet, css] of Object.entries(ALL_SHEETS)) {
    const declared = [...css.matchAll(/--ftshare-[a-z0-9-]+\s*:/g)]
    assert.equal(declared.length, sheet === 'the section shell' ? TOKENS.length : 0, `${sheet} declares tokens of its own`)
  }
})

test('every token a sheet reads is declared, and a card reads it bare', () => {
  const { values } = tokenRule()
  for (const [sheet, css] of Object.entries(ALL_SHEETS)) {
    for (const { name, fallback } of used(css)) {
      assert.ok(values.has(`--ftshare-${name}`), `${sheet} reads undeclared --ftshare-${name}`)
      // A fallback in a card would be a second copy of a palette value.
      if (sheet !== 'the section shell') assert.equal(fallback, '', `${sheet} repeats a value for --ftshare-${name}`)
    }
  }
})

test('a card carries no colour literal of its own', () => {
  for (const [sheet, css] of Object.entries(CARD_SHEETS)) {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${sheet} hard-codes a hex colour`)
    assert.doesNotMatch(css, /\brgba?\(/i, `${sheet} hard-codes an rgb colour`)
    assert.doesNotMatch(css, /color-mix\(/i, `${sheet} mixes a colour instead of reading a token`)
  }
})

test('every host token the palette layer reads exists, and follows the scheme', { skip: SKIP_PALETTE }, () => {
  const host = palette()
  const { values } = tokenRule()
  // Host tokens are read through `var()` in the declarations, with the literal
  // fallback after the comma being this plugin's pre-theme value.
  for (const [, name] of SETTINGS_CSS.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)) {
    assert.ok(host.light.has(name), `DSH publishes no ${name}`)
  }
  for (const token of SCHEME_DEPENDENT) {
    const [light, dark] = [resolveToken(token, 'light', values, host), resolveToken(token, 'dark', values, host)]
    assert.notDeepEqual(light, dark, `--ftshare-${token} is the same colour in both schemes`)
  }
  // The brand is scheme-invariant: the fill and its ink are the same yellow pair
  // in both palettes, and only the on-surface mix follows the host.
  for (const token of ['accent', 'accent-ink']) {
    assert.deepEqual(
      resolveToken(token, 'light', values, host),
      resolveToken(token, 'dark', values, host),
      `--ftshare-${token} must not shift with the scheme`,
    )
  }
})

test('text and the brand stay legible on the surface they sit on', { skip: SKIP_PALETTE }, () => {
  const host = palette()
  const { values } = tokenRule()
  for (const scheme of ['light', 'dark']) {
    const token = name => resolveToken(name, scheme, values, host)
    const page = parseColor(substitute('var(--dsw-alias-bg-base)', scheme, values, host))
    // Card copy on the card surface, and the eyebrow/focus ring, which sit on
    // the settings page itself rather than on a card.
    for (const [what, colour, surface] of [
      ['--ftshare-text on the card', token('text'), token('panel')],
      ['--ftshare-muted on the card', token('muted'), token('panel')],
      ['--ftshare-accent-on-surface on the page', token('accent-on-surface'), page],
      ['--ftshare-accent-ink on the brand fill', token('accent-ink'), token('accent')],
    ]) {
      assert.ok(contrast(colour, surface) >= 4.5, `${what} is only ${contrast(colour, surface).toFixed(2)}:1 in the ${scheme} theme`)
    }
  }
})

test('component geometry consumes the shared radius scale', () => {
  for (const [sheet, css] of Object.entries(ALL_SHEETS)) {
    assert.doesNotMatch(css, /border-radius:\s*[0-9]/, `${sheet} hard-codes a corner radius`)
  }
})
