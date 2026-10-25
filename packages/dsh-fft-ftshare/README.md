# @dsh-ft/dsh-fft-ftshare

FTShare 数据底座：bundle 内所有 FTShare 取数都经过它。

- **一处凭据**：只走 `ctx.ftshareSettings.apiKey.resolve()`，本包不读任何凭据文件。
- **一处出站**：唯一的 StreamableHTTP MCP 会话，打到 `market.ft.tech/gateway/mcp`。
- **一处结局语义**：`available / empty / denied / failed` 四态 + `notice`；只有 `empty`
  才允许下游说「没有数据」。
- **两处接口定义**：接口表（策展，决定下发哪些模型工具）与目录（上游全量快照，随包发布）。
- **一条跨平面通路**：两个助手，由消费方自己挂。

## 入口

| 入口 | 平面 | 职责 |
|---|---|---|
| 裸包名 `@dsh-ft/dsh-fft-ftshare` | **全局** | `provide('ftshareData')`，`inject: ['ftshareSettings']`。唯一出站、唯一四态。 |
| `/tools` | preset | 接口表里带 `expose` 的条目 → `ftshare_*` 工具；外加长尾直调 `ftshare_call(interface, args)`。 |
| `/mask` | preset | 按 agent 掩掉 `dsh_kline` 的三个 FTShare wrapper 工具（`market_pulse` / `market_board_detail` / `security_intelligence`）。 |
| `/project` | preset | `tools/post-execute` 钩子：把保留的 kline 摘要式结果投影成模型可见文本，不输出裸计数。 |
| `/route` · 助手 | 消费方自挂 | `registerFtshareRoute(ctx, data)`：注册精确路由 `/api/ftshare-data`，四态原样过桥。 |
| `/client` · 助手 | 消费方自挂 | `createFtshareClient({ catalog, fetch })`：浏览器侧同名同形的实现 + 本地 `search()`。 |

**服务行必须挂全局**：preset 内 `provide` 会抛 `Preset services require isolate realms`
（`agent-preset-registry` 的 `mount.ts`），而加 `isolate` 之后服务变成 preset 私有，
preset 之外的消费方再也 inject 不到。工具、掩码、投影三行都是 preset 作用域内的注册，
所以标准模式看不到它们。

本包**不声明 `dsh.client`**：它不是客户端面，只发布两个助手；谁需要面板取数谁自己挂。

## 消费方式

宿主侧：

```ts
import type { FtshareCallResult } from '@dsh-ft/dsh-fft-ftshare/contract'

export const inject = ['ftshareData']

const result: FtshareCallResult = await ctx.ftshareData.call('ft_v1_finance_income', { stock_code })
if (result.state === 'available') render(result.rows)
else showNotice(result.notice)        // denied 带 upgradeUrl，empty 才是「没有数据」
```

浏览器侧：

```ts
// 宿主半：一行挂载路由
ctx.inject(['connection', 'ftshareData'], scope =>
  scope.effect(() => registerFtshareRoute(scope.ctx, scope.ftshareData), 'ftshare: /api route'))

// 客户端半：一行提供同名服务，此后面板与宿主消费方写法一致
ctx.provide('ftshareData', createFtshareClient({ catalog, fetch: window.fetch.bind(window) }))
```

要暴露新接口就把条目加进 `src/capabilities.ts`，不要自己注册模型工具，也不要自己连网关。

## 目录产物

`catalog.json`（完整，含 `description` 与 `inputSchema`）、`catalog.txt`（一线索引：
`接口名 | 标题 | 入参名`，必填带 `*`）、`catalog.meta.json`（条目数与生成时间）都由
`scripts/build-catalog.mjs` 从 `tools/list` 生成，随包发布：模型用 `grep` 查索引，
不需要为发现能力多花一个工具定义。

## 开发

```bash
pnpm build            # tsc，产物 lib/（git 安装只送达被跟踪文件，lib/ 必须入库）
pnpm test             # build + 投影/归一/目录/掩码/跨平面五组断言
pnpm catalog          # 匿名会话重新生成目录产物（联网）
pnpm catalog:check    # 重新生成并与盘上产物比对（联网；失败说明上游漂了）
```

`scripts/` 下每个用例都只做断言、不发数据请求：假 transport、假服务、进程内路由。
