# dsh_kline：实际代码与接入后代码对照

核对时间：2026-09-17。基线：`dsh_kline@d6253f07c90ebbeb25a31dd3a76565c242558d36`。

本文的“当前”摘自工作区真实源码，省略部分用注释标记。“接入后”是待 kline 实现的示例，不代表本包已修改 kline。FTShare Settings 不提供 Python 明文凭据 HTTP 服务；下面的 `privateBridge` / `settings_bridge` 是 kline 需要实现的私有 IPC 适配层。

## 0. 落地状态（2026-10-14 更新）

kline 侧已实现**凭据这一段**，但不是本文设想的私有 IPC，而是更小的文件契约：`FTShare-Lab/dsh_kline` PR #10（分支 `feat/ftshare-settings-bridge`，提交 `21539cd`，基线 `v0.3.5`）。

- 已实现：`src/ftshare-settings-bridge.ts` 用 `apiKey.resolve()` + `subscribe()` 把当前 Key 发布到 `<runtime>/credentials/ftshare-<hostPid>.json`（`0600`/目录 `0700`、原子替换、宿主退出即删、启动时清理已死宿主的残留）；`src/index.ts` 以 `ctx.inject(['ftshareSettings'], …)` 起桥，`inject` 仍是 `['webServer']`，没有该服务的宿主行为不变；启动器仅在拿到 `DSH_KLINE_HOST_PID` 时注入 `DSH_KLINE_SETTINGS_KEY_FILE`；`tools/fetch.py` 在**每次**建 FTShare 客户端前重读该文件，来源标记为 `settings_bridge` 且 `can_clear=false`（该 Key 归设置页所有）。
- 取代 IPC 的理由：两侧本就共享运行时目录（`services/<hostPid>.json` 已是同一约定），文件无需握手、实例认证与 Python 重连，跨 MCP 重启依然成立；`createEnvironment()` 仍未使用（它只是启动快照，本文档对它的判断不变）。
- 尚未实现：§2／§3 的工具委托——`configure_ftshare` / `test_ftshare_connection` / `data_source_status` 仍走 kline 自己的本地实现，因此“保存与测试结果不混淆”的适配层、Python 侧 IPC 客户端与 `persist=false` 的语义统一都还缺。
- 与 §4 的差异：当前实现**保留**了环境变量与插件自有 JSON 回退，只是把顺序固定为 显式 `FTSHARE_API_KEY_FILE` → 设置桥文件 → 插件自有存储；并非本文设想的“DSH 模式停用旧回退”。这一条要继续推进还是就此定型，取决于是否要让设置页成为唯一凭据来源。

## 1. Host：现在只向 Python 转发

当前 `dsh_kline/src/index.ts`：

```ts
export const name = 'dsh-kline-sidebar'
export const inject = ['webServer']

export function apply(ctx: WebServerContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-kline',
    handler: serveRuntimeSession,
  }), 'dsh-kline: chart session route')
}
```

同一文件的 `serveRuntimeSession` 当前分支（包括 `configure_ftshare` 和 `test_ftshare_connection`）：

```ts
const body = await readRequestBody(request)
await proxyJson(response, `${serviceOrigin(session)}/api/tools/${encodeURIComponent(action)}`, {
  method: 'POST',
  headers: { ...chartServiceHeaders(session), 'Content-Type': 'application/json' },
  body: body.toString('utf8'),
})
```

因此只改 Host 页面的代理分支，仍覆盖不了 MCP 直接调用 Python 的入口。建议保留行情代理，让两种入口最终都从 Python 私有桥调用同一个 Host 适配器。

接入后 kline 仓库 `src/index.ts` 的关键变化（本节与下文写作 `src/…`、`scripts/…` 的路径都相对 kline 仓库根，不是本包）：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@ft/dsh-fft-settings'
import { createKlineFtshareAdapter } from './ftshare-adapter.js'
// 由 kline 新增，不是 FTShare Settings 已有导出：
import { startPrivateSettingsBridge } from './private-settings-bridge.js'

export const inject = ['webServer', 'ftshareSettings']
export function apply(ctx: Context): void {
  const adapter = createKlineFtshareAdapter(ctx.ftshareSettings.apiKey)
  // 保留原 /dsh-kline 行情路由注册。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dsh-kline', handler: serveRuntimeSession,
  }), 'dsh-kline: chart session route')

  // 私有 IPC 必须仅允许当前实例的 Python 访问，不能注册为浏览器公开路由。
  const bridge = startPrivateSettingsBridge(adapter)
  ctx.effect(() => () => bridge.dispose(), 'kline: private settings bridge')
  ctx.effect(() => ctx.ftshareSettings.apiKey.subscribe(() => {
    bridge.notifyCredentialChanged() // 只发失效事件，不带 Key
  }), 'kline: credential invalidation')
}
```

`startPrivateSettingsBridge` 的实现、实例认证、启动信息交接和 Python 重连均属于 kline 后续工作；此处没有伪装成可直接运行的完整桥。创建桥后，需要在现有 `cordis.patch.yml` → `scripts/start-mcp.mjs` → `server.py` 启动链传递其连接参数，并保证 Python 连接到同一个 Host 实例。`createEnvironment()` 只提供启动快照，不能替代动态凭据桥。

> 2026-10-14：凭据这一段已按 §0 的文件契约落地（PR #10），未采用本节的 `startPrivateSettingsBridge`／适配器注入路径；本节其余内容仍是未完成的设想。

## 2. 新增 Host 适配器：保存与测试结果不混淆（未落地）

建议新增 `dsh_kline/src/ftshare-adapter.ts`：

```ts
import type { ApiKeySettings, ValidationResult } from '@ft/dsh-fft-settings/contract'

const failure = (message: string) => ({ ok: false, message })
const tested = (validation: ValidationResult) => ({
  ok: validation.status === 'passed',
  connection_ok: validation.remote.status === 'available',
  key_ok: validation.apiKey.status === 'available',
  validation,
  message: `${validation.remote.message}；${validation.apiKey.message}`,
})

export function createKlineFtshareAdapter(apiKey: ApiKeySettings) {
  return {
    async configure(args: {
      api_key?: string | null
      test_connection?: boolean
      persist?: boolean
    }) {
      if (args.persist === false) return failure('DSH 模式不支持临时 Key，请使用持久化配置')
      const value = (args.api_key ?? '').trim()
      const shouldTest = args.test_connection !== false
      try {
        if (!value) {
          await apiKey.clear()
          const status = await apiKey.describe() // 清除可能露出 .env 回退值
          const validation = shouldTest ? await apiKey.testConnection() : undefined
          return {
            ...(validation ? tested(validation) : { ok: true }),
            key_saved: false,
            configured: status.configured,
            source: status.source,
            cleared: true,
            message: validation
              ? `已清除 DSH 保存值；${validation.remote.message}；${validation.apiKey.message}`
              : '已清除 DSH 保存值',
          }
        }
        if (!shouldTest) {
          await apiKey.set(value)
          return { ok: true, key_saved: true, message: '已保存，未测试' }
        }
        const result = await apiKey.configureAndTest(value)
        return {
          ...tested(result.validation),
          ok: result.save.status === 'saved' && result.validation.status === 'passed',
          key_saved: result.save.status === 'saved',
          save: result.save,
          message: `${result.save.message}；${result.validation.remote.message}；${result.validation.apiKey.message}`,
        }
      } catch {
        return failure('配置请求未完成，请重新读取状态；不能据此断言未保存')
      }
    },
    async test() { return tested(await apiKey.testConnection()) },
    async status() {
      const { configured, source, writable, validation } = await apiKey.describe()
      return { configured, source, writable, validation }
    },
    // 只供认证后的私有 Python IPC；禁止进入浏览器 RPC 或模型工具返回值。
    async resolveForPython() { return { value: (await apiKey.resolve()) ?? null } },
  }
}
```

桥的输入层仍须校验 JSON 字段类型、未知字段、大小和操作白名单；TypeScript 类型不代替运行时校验。`resolveForPython` 只能供 Python 内部行情请求使用。不能把 `Object.keys(adapter)` 全部注册到公共 RPC。

## 3. Python MCP：当前调用本地配置函数（未落地）

当前 `dsh_kline/server.py` 的函数体：

```python
# configure_ftshare(...) 内
data = configure_ftshare_api_key(api_key, test_connection=test_connection, persist=persist)
if not data.get("ok"):
    return _result(data, str(data.get("message") or data.get("error") or "FTShare 配置失败"), error=True)
return _result(data, str(data.get("message") or "FTShare 配置已更新"))

# test_ftshare_connection_tool() 内
data = test_ftshare_connection()
if not data.get("ok"):
    return _result(data, str(data.get("message") or data.get("error") or "FTShare 连接失败"), error=True)
return _result(data, str(data.get("message") or "FTShare 连接成功"))
```

当前 `tools/fetch.py::configure_ftshare_api_key` 的核心行为（摘录）：

```python
if persist:
    if value:
        _write_persisted_ftshare_key(value)
    else:
        _remove_persisted_ftshare_key()
# 省略异常处理
if value:
    os.environ["FTSHARE_API_KEY"] = value
else:
    os.environ.pop("FTSHARE_API_KEY", None)
clear_provider_caches()
# ...
connection = test_ftshare_connection()
```

接入后，DSH 模式在同名 helper 中委托 Host；这样 `server.py` 和 `chart_service.py` 的调用可复用一个适配点：

```python
# tools/fetch.py：建议替换 DSH 模式下的实现
# settings_bridge 是由 kline 实现的同步、带超时且每实例认证的 IPC 客户端。
from .settings_bridge import settings_bridge

def configure_ftshare_api_key(api_key, *, test_connection=True, persist=True):
    result = settings_bridge.call("configure", {
        "api_key": api_key,
        "test_connection": test_connection,
        "persist": persist,
    })
    # 即使测试失败，保存也可能已成功，缓存必须失效。
    clear_provider_caches()
    return result

def test_ftshare_connection():
    return settings_bridge.call("test", {})
```

在 `server.py` 的 async MCP 函数中使用 `await asyncio.to_thread(configure_ftshare_api_key, ...)` 和 `await asyncio.to_thread(test_ftshare_connection)`，避免同步 IPC 阻塞事件循环。原 `_result(...)` 封装可以保留，`data` 中的 `key_saved`、`save`、`validation` 分别说明保存和测试结果。

`data_source_status` 中，SDK 安装状态和版本仍由 kline 本地计算；`configured/source/validation` 改用 `settings_bridge.call("status", {})`。不要直接用 Host 的状态替换包含 SDK 信息的整个工具响应。

## 4. Python 行情：每次操作读取当前 Key（已按文件契约落地，见 §0）

当前 `tools/fetch.py::_ftshare_market_api`：

```python
def _ftshare_market_api(timeout: float) -> Any:
    """Create an SDK client with the process key attached to every request."""
    import ftshare as ft

    key = _valid_ftshare_key(os.environ.get("FTSHARE_API_KEY"))
    headers = {"FTSHARE_API_KEY": key} if key else None
    return ft.market_api(timeout=timeout, headers=headers)
```

接入后（DSH 模式；这是本文设想的 IPC 版本，kline 实际改用 §0 的文件契约）：

```python
def _ftshare_market_api(timeout: float) -> Any:
    import ftshare as ft

    resolved = settings_bridge.call("resolveForPython", {})
    key = _valid_ftshare_key(resolved.get("value"))
    # 未配置就中止，避免 SDK 自动使用旧环境变量或本地文件作为隐藏回退。
    if not key:
        raise RuntimeError("请先在 FTShare 设置中配置 API Key")
    return ft.market_api(timeout=timeout, headers={"FTSHARE_API_KEY": key})
```

一次行情操作使用同一客户端／Key 快照，不应在逐根 K 线处理时反复读取。DSH 模式要停用 `_load_persisted_ftshare_key()` 和旧凭据 JSON 回退，不能同时维护两份配置。独立运行模式可以保留现有本地策略，但必须明确分支。Host 通知用于失效 kline 缓存，不能替代请求时解析。

## 验收边界

- 两个入口都覆盖：浏览器图表 HTTP、Python MCP。
- 设置页改 Key 后，已运行 Python 的下一次操作使用新值。
- 清除后不继续使用旧 Key；存在 DSH 环境回退时使用实际生效值。
- 保存成功、检测失败时仍保留 `key_saved=true`；不能只显示“保存失败”。
- `persist=false` 不静默变为持久化。
- 明文只流经 Host → 私有 Python IPC → FTShare，不出现在浏览器／MCP 工具结果／日志中。
- `validation.remote` 和 `validation.apiKey` 分别表示服务与认证，不代表行情数据完整性或全部套餐权限。

### 截至 2026-10-14 的达成情况

| 边界 | 状态 |
| --- | --- |
| 两个入口都覆盖 | ✅ 文件契约对浏览器代理与 MCP 直调同时生效（同一份 `tools/fetch.py`） |
| 设置页改 Key 后，下一次操作使用新值 | ✅ 每次建客户端前重读 |
| 清除后不继续使用旧 Key | ⚠️ 该文件被清除后不再使用，但环境变量／插件自有存储的回退仍可提供另一个 Key（§4 未收敛项） |
| 保存成功、检测失败仍保留 `key_saved=true` | ❌ 工具委托未做，仍由 kline 本地实现 |
| `persist=false` 不静默变持久化 | ❌ 同上，既有行为未变 |
| 明文只流经 Host → Python → FTShare | ✅ 改为 Host → `0600` 文件 → Python → FTShare，不入日志／工具结果 |
| 两个 validation 字段的含义 | ✅ 不变（设置页自身语义） |
