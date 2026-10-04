// 桌面壳读取封装：无桌面运行时的降级、版本与能力读取、订阅与动作语义。
//
// 壳契约见父仓 spec 2.9；本文件在 Node 里通过替换 `globalThis.window` 模拟
// 「有壳 / 无壳」两种运行环境，因此不依赖 DOM。

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NO_SHELL_CAPABILITY,
  SHELL_BRIDGE_GLOBAL,
  SHELL_BRIDGE_PROTOCOL_VERSION,
  createShellReader,
  isShellUpdateState,
  readShellBridge,
} from '../lib/shell.js'

const idleState = { phase: 'idle', currentVersion: '0.4.2', manual: false }
const info = { productName: 'DSH FFT', version: '0.4.2', platform: 'darwin', packaged: true }

/** Run `visit` with `globalThis.window` replaced, then restore the previous value. */
async function withWindow(value, visit) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = value
  try {
    return await visit()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  }
}

function fakeBridge(overrides = {}) {
  const calls = []
  const updates = {
    getCapability: async () => ({ supported: true }),
    getState: async () => idleState,
    subscribe: listener => { listener(idleState); return () => { calls.push('unsubscribe') } },
    check: async () => { calls.push('check') },
    download: async () => { calls.push('download') },
    install: async () => { calls.push('install') },
    skip: async () => { calls.push('skip') },
    ...overrides.updates,
  }
  const bridge = { protocolVersion: SHELL_BRIDGE_PROTOCOL_VERSION, app: { getInfo: async () => info, ...overrides.app }, updates }
  return { calls, bridge }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('无桌面运行时：探测为空、版本不可知、能力不可用且给出原因，且不抛错', async () => {
  assert.equal(SHELL_BRIDGE_GLOBAL, 'dshFft')
  assert.equal(SHELL_BRIDGE_PROTOCOL_VERSION, 1)
  await withWindow(undefined, async () => {
    assert.equal(readShellBridge(), undefined)
    const shell = createShellReader()
    assert.equal(shell.available, false)
    assert.equal(await shell.appInfo(), undefined)
    assert.deepEqual(await shell.capability(), NO_SHELL_CAPABILITY)
    assert.equal((await shell.capability()).reason, '当前环境不提供版本信息')
    assert.equal(await shell.state(), undefined)
    // 订阅是空操作，但仍然返回一个可调用的取消函数。
    let pushed = 0
    const unsubscribe = shell.subscribe(() => { pushed++ })
    assert.equal(typeof unsubscribe, 'function')
    unsubscribe()
    assert.equal(pushed, 0)
    for (const action of ['check', 'download', 'install', 'skip']) shell.act(action)
  })
})

test('非浏览器上下文（没有 window 绑定）与畸形全局都降级为无壳', async () => {
  // `window` 不存在：模块本身可被 Host 侧或 Node 工具导入而不抛错。
  assert.equal(typeof globalThis.window, 'undefined')
  assert.equal(readShellBridge(), undefined)
  for (const candidate of [undefined, null, {}, { protocolVersion: 1 }, { protocolVersion: 1, app: {}, updates: {} }, { protocolVersion: '1', app: { getInfo() {} }, updates: {} }]) {
    await withWindow(candidate, () => {
      assert.equal(readShellBridge(), undefined)
      assert.equal(createShellReader().available, false)
    })
  }
  // 形状完整但少了任一白名单动作，仍不算可用的桥。
  const { bridge } = fakeBridge()
  const missing = { ...bridge, updates: { ...bridge.updates, skip: undefined } }
  await withWindow(missing, () => assert.equal(createShellReader().available, false))
})

test('读版本与能力：字段被规范化，壳异常时返回安全默认值', async () => {
  const { bridge } = fakeBridge()
  await withWindow({ dshFft: bridge }, async () => {
    const shell = createShellReader()
    assert.equal(shell.available, true)
    assert.deepEqual(await shell.appInfo(), info)
    assert.deepEqual(await shell.capability(), { supported: true })
    assert.deepEqual(await shell.state(), idleState)
  })
  const partial = fakeBridge({ app: { getInfo: async () => ({ version: '1.2.3' }) } })
  await withWindow({ dshFft: partial.bridge }, async () => {
    assert.deepEqual(await createShellReader().appInfo(), { productName: '', version: '1.2.3', platform: '', packaged: false })
  })
  const broken = fakeBridge({
    app: { getInfo: async () => { throw new Error('ipc down') } },
    updates: {
      getCapability: async () => { throw new Error('ipc down') },
      getState: async () => { throw new Error('ipc down') },
    },
  })
  await withWindow({ dshFft: broken.bridge }, async () => {
    const shell = createShellReader()
    assert.equal(await shell.appInfo(), undefined)
    assert.equal(await shell.state(), undefined)
    assert.deepEqual(await shell.capability(), { supported: false, reason: '读取更新能力失败' })
  })
  const malformed = fakeBridge({ updates: { getCapability: async () => ({ reason: 'x' }), getState: async () => ({ phase: 'up-to-date' }) } })
  await withWindow({ dshFft: malformed.bridge }, async () => {
    const shell = createShellReader()
    assert.deepEqual(await shell.capability(), { supported: false, reason: '桌面壳未返回更新能力信息' })
    assert.equal(await shell.state(), undefined, '不认识的相位不得进入界面')
  })
  // 不受支持的能力位原样透传，界面据此展示原因（spec 2.10）。
  const unsupported = fakeBridge({ updates: { getCapability: async () => ({ supported: false, reason: '开发运行不检查更新' }) } })
  await withWindow({ dshFft: unsupported.bridge }, async () => {
    assert.deepEqual(await createShellReader().capability(), { supported: false, reason: '开发运行不检查更新' })
  })
  // 可安装但需要提前告知的平台（当前 macOS 未签名）：告知必须一起读出来，
  // 否则这条信息在插件侧就断了——壳的对话框到不了设置页。
  const advised = fakeBridge({ updates: { getCapability: async () => ({ supported: true, advisory: '安装可能被拒绝', junk: 1 }) } })
  await withWindow({ dshFft: advised.bridge }, async () => {
    assert.deepEqual(await createShellReader().capability(), { supported: true, advisory: '安装可能被拒绝' })
  })
  const blank = fakeBridge({ updates: { getCapability: async () => ({ supported: true, advisory: '  ' }) } })
  await withWindow({ dshFft: blank.bridge }, async () => {
    assert.deepEqual(await createShellReader().capability(), { supported: true }, '空告知不产生空行')
  })
})

test('订阅：立即回调当前状态、转发推送、忽略畸形推送，取消后不再回调', async () => {
  let push
  const { calls, bridge } = fakeBridge({ updates: { subscribe: listener => { push = listener; listener(idleState); return () => { calls.push('unsubscribe') } } } })
  await withWindow({ dshFft: bridge }, async () => {
    const received = []
    const unsubscribe = createShellReader().subscribe(state => received.push(state.phase))
    assert.deepEqual(received, ['idle'], '订阅即回调一次当前状态')
    push({ phase: 'downloading', currentVersion: '0.4.2', availableVersion: '0.5.0', percent: 10, manual: false })
    push({ phase: 'not-a-phase' })
    push(null)
    assert.deepEqual(received, ['idle', 'downloading'], '畸形推送被忽略')
    // 监听器自身的异常不能打断壳的推送循环。
    const throwing = createShellReader().subscribe(() => { throw new Error('listener fault') })
    assert.doesNotThrow(() => push(idleState))
    throwing(); unsubscribe()
    assert.deepEqual(calls, ['unsubscribe', 'unsubscribe'])
  })
})

test('动作：受理即返回、调用对应方法、壳报错不外抛，无壳时为空操作', async () => {
  const { calls, bridge } = fakeBridge()
  await withWindow({ dshFft: bridge }, async () => {
    const shell = createShellReader()
    for (const action of ['check', 'download', 'install', 'skip']) shell.act(action)
    assert.deepEqual(calls, ['check', 'download', 'install', 'skip'])
  })
  const failing = fakeBridge({
    updates: {
      check: async () => { throw new Error('ipc down') },
      download: () => { throw new Error('ipc down') },
    },
  })
  await withWindow({ dshFft: failing.bridge }, async () => {
    const shell = createShellReader()
    assert.doesNotThrow(() => { shell.act('check'); shell.act('download') })
    await tick()
  })
  await withWindow(undefined, () => assert.doesNotThrow(() => createShellReader().act('check')))
})

test('协议版本不匹配时不驱动界面：版本仍尽力读取，更新入口判为不可用并说明原因', async () => {
  const { bridge } = fakeBridge()
  await withWindow({ dshFft: { ...bridge, protocolVersion: 2 } }, async () => {
    const shell = createShellReader()
    assert.equal(shell.available, false)
    assert.deepEqual(await shell.appInfo(), info, '版本仍可读时不得隐藏')
    const capability = await shell.capability()
    assert.equal(capability.supported, false)
    assert.match(capability.reason, /协议不兼容/)
  })
})

test('状态形状校验器只接受规格内的相位', () => {
  for (const phase of ['idle', 'checking', 'not-available', 'available', 'downloading', 'downloaded', 'installing', 'error']) {
    assert.equal(isShellUpdateState({ phase, currentVersion: '1.0.0', manual: false }), true, phase)
  }
  for (const value of [undefined, null, {}, { phase: 'unsupported' }, { phase: 'idle' }, { phase: 'idle', currentVersion: '1.0.0' }]) {
    assert.equal(isShellUpdateState(value), false)
  }
})
