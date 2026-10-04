// 版本与检查更新卡片：1.9 表的相位 → 文案／可用性映射，以及 2.10 的降级矩阵。
//
// 映射是纯函数，因此在 Node 里直接断言，不渲染 React 组件。

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FTSHARE_SETTINGS_SECTION } from '../lib/contract.js'
import { NO_SHELL_CAPABILITY } from '../lib/shell.js'
import { describeUpdateView, productVersionLine } from '../lib/modules/app-version/view.js'
import { settingsCards } from '../lib/cards.js'

const supported = { supported: true }
const state = (phase, extra = {}) => ({ phase, currentVersion: '0.4.2', manual: true, ...extra })

test('设置节标识：id 改为 dsh-fft，标签为品牌名，order 不变，旧 id 不再出现', () => {
  assert.deepEqual(FTSHARE_SETTINGS_SECTION, { id: 'dsh-fft', order: 120, label: '非凸金融终端' })
  assert.notEqual(FTSHARE_SETTINGS_SECTION.id, 'ftshare')
})

test('卡片登记：应用版本卡排在凭据卡之前', () => {
  assert.deepEqual(settingsCards.map(card => [card.id, card.order]), [['appVersion', 0], ['apiKey', 10]])
})

test('1.9 表：每个相位的按钮文案与可用性', () => {
  const cases = [
    ['idle', state('idle'), '检查更新', true, 'check'],
    ['checking', state('checking'), '正在检查更新…', false, undefined],
    ['not-available', state('not-available'), '已是最新版本', false, undefined],
    ['available', state('available', { availableVersion: '0.5.0' }), '下载', true, 'download'],
    ['downloading', state('downloading', { availableVersion: '0.5.0', percent: 41.6 }), '正在下载 v0.5.0… 42%', false, undefined],
    ['downloaded', state('downloaded', { availableVersion: '0.5.0' }), '重启以安装 v0.5.0', true, 'install'],
    ['installing', state('installing', { availableVersion: '0.5.0' }), '正在退出并安装…', false, undefined],
    ['error', state('error', { message: '网络不可达' }), '重试', true, 'check'],
  ]
  for (const [phase, current, label, enabled, action] of cases) {
    const view = describeUpdateView(current, supported)
    assert.equal(view.primary.label, label, phase)
    assert.equal(view.primary.enabled, enabled, phase)
    assert.equal(view.primary.action, action, phase)
    assert.ok(view.status.length > 0, `${phase} 必须有一行结果/说明文案`)
  }
})

test('发现新版本：主按钮下载、附带跳过，且结果文案给出目标版本', () => {
  const view = describeUpdateView(state('available', { availableVersion: '0.5.0' }), supported)
  assert.equal(view.primary.action, 'download')
  assert.deepEqual(view.extra.map(control => [control.label, control.enabled, control.action]), [['跳过此版本', true, 'skip']])
  assert.equal(view.status, '发现新版本 v0.5.0')
  assert.equal(view.tone, 'normal')
})

test('失败：原因可读并带重试，文案使用错误色', () => {
  const view = describeUpdateView(state('error', { message: 'sha512 校验失败' }), supported)
  assert.equal(view.status, '更新失败：sha512 校验失败')
  assert.equal(view.primary.label, '重试')
  assert.equal(view.tone, 'error')
  assert.equal(describeUpdateView(state('error'), supported).status, '更新失败：原因未知')
})

test('缺字段不产生 undefined：没有目标版本时仍给出可读文案', () => {
  for (const current of [
    state('available'),
    state('downloading'),
    state('downloaded'),
    state('installing'),
    undefined,
  ]) {
    const view = describeUpdateView(current, supported)
    assert.ok(!JSON.stringify(view).includes('undefined'))
    assert.ok(view.primary.label.trim().length > 0)
    assert.ok(view.status.trim().length > 0)
  }
  assert.equal(describeUpdateView(state('downloading', { availableVersion: '0.5.0' }), supported).primary.label, '正在下载 v0.5.0…')
  assert.equal(describeUpdateView(state('downloading', { availableVersion: '0.5.0', percent: 130 }), supported).primary.label, '正在下载 v0.5.0… 100%')
  assert.equal(describeUpdateView(state('downloading', { availableVersion: '0.5.0', percent: Number.NaN }), supported).primary.label, '正在下载 v0.5.0…')
  assert.equal(describeUpdateView(state('downloaded'), supported).primary.label, '重启以安装')
  assert.equal(describeUpdateView(undefined, supported).primary.label, '检查更新')
  // 畸形推送（字段类型不对）同样不能把 undefined 或异常带进渲染。
  assert.equal(describeUpdateView({ phase: 'error', currentVersion: '0.4.2', manual: true, message: 42 }, supported).status, '更新失败：原因未知')
  assert.equal(describeUpdateView({ phase: 'available', currentVersion: '0.4.2', manual: true, availableVersion: 5 }, supported).status, '发现新版本')
  assert.equal(describeUpdateView(state('idle'), { supported: false, reason: 42 }).status, '当前环境不支持应用内更新')
})

test('2.10 降级：能力不可用时版本照常展示，入口禁用并给出原因', () => {
  for (const [reason, expected] of [
    [NO_SHELL_CAPABILITY, '当前环境不提供版本信息'],
    [{ supported: false, reason: '开发运行不检查更新' }, '开发运行不检查更新'],
    [{ supported: false, reason: '当前平台不支持应用内更新' }, '当前平台不支持应用内更新'],
    [{ supported: false }, '当前环境不支持应用内更新'],
  ]) {
    const view = describeUpdateView(state('idle'), reason)
    assert.equal(view.primary.label, '检查更新')
    assert.equal(view.primary.enabled, false)
    assert.equal(view.primary.action, undefined)
    assert.equal(view.status, expected)
    assert.deepEqual(view.extra, [])
  }
})

test('能力尚未读出时不误报原因：入口禁用并提示正在读取', () => {
  const view = describeUpdateView(undefined, undefined)
  assert.equal(view.primary.enabled, false)
  assert.equal(view.status, '正在读取版本与更新能力…')
})

test('安装告知：能力可用时也显示，随能力消失，不影响按钮', () => {
  const advisory = '当前产物未签名，安装可能被拒绝'
  const view = describeUpdateView(state('available', { availableVersion: '0.5.0' }), { supported: true, advisory })
  assert.equal(view.advisory, advisory)
  assert.equal(view.primary.enabled, true, '告知不是禁用')
  assert.equal(view.primary.action, 'download')
  // 没有告知时不产生空行，渲染层因此只需判断有无。
  assert.equal(describeUpdateView(state('idle'), supported).advisory, undefined)
  assert.equal(describeUpdateView(state('idle'), { supported: true, advisory: '   ' }).advisory, undefined)
  // 不可用的能力用 reason 说话，不会同时挂一条告知。
  assert.equal(describeUpdateView(state('idle'), { supported: false, reason: '开发运行不检查更新', advisory }).advisory, undefined)
})

test('版本行：已知版本用品牌名，未知与读取中都不出现空版本号', () => {
  assert.equal(productVersionLine({ productName: 'DSH FFT', version: '0.4.2', platform: 'darwin', packaged: true }, true), '非凸金融终端 v0.4.2')
  assert.equal(productVersionLine(undefined, false), '非凸金融终端（正在读取版本信息…）')
  assert.equal(productVersionLine(undefined, true), '非凸金融终端（版本未知）')
  assert.equal(productVersionLine({ productName: '', version: '  ', platform: '', packaged: false }, true), '非凸金融终端（版本未知）')
})
