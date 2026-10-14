# @ft/dsh-fft-ftshare

FTShare 公用底座。两件事：

1. 一处取数：把 `https://market.ft.tech/gateway/mcp` 的 StreamableHTTP MCP 网关包成
   `ctx.ftshareMarket`，结果统一归一成 `available / empty / denied / failed` 四态，
   登录凭据只从设置服务取。
2. 一处修投影：把 `@ftshare-lab/dsh-kline` 摘要式 MCP 工具藏在 `structuredContent`
   里的明细投影回**模型可见文本**，并把三态显式说清楚。

## 修的是什么

- **P7（明细看不见）**：`dsh-kline` 的 `security_intelligence` 等工具把明细只放进
  `structuredContent`，`content` 只有一行 `security_intelligence · 600519.XSHG ·
  flows=10 · events=0`。DSH 的 MCP 桥只把 `content` 投影给模型
  （`@deepseek-ai/dsh-mcp-client` 的 `createOutput`），所以模型看不到那 10 条资金流。
- **P8（三态被压成 0）**：同一行摘要把「真的没有」「套餐无权限（网关 403
  `route_not_allowed`）」「取数失败」一律印成 `0`。

修复手段是 `tools/post-execute` waterfall 钩子：只替换 `content`（不动 `value`，也不
用 `block`），渲染成

```
标的情报 · 600519.XSHG · 贵州茅台 · 数据源 FTShare · 2026-10-13 06:00 UTC
资金流：可用
1. 2026-10-13 · 净额 5040.12万 · 占比 1.49% · 收盘 1274.89 · -1.02%
…
交易事件：✗ 当前套餐无权访问该接口（403 route_not_allowed）—— 不是“没有事件”。上游标记 capability_limited：…
```

形状不符时**原样放行**并记一条 warn，绝不吞结果。

## 三个平面

| 入口 | 平面 | 职责 |
|---|---|---|
| 裸包名 `@ft/dsh-fft-ftshare` | **全局** | `provide('ftshareMarket')`，`inject: ['ftshareSettings']`，出站 HTTPS 到网关。凭据只走 `ctx.ftshareSettings.apiKey.resolve()`。 |
| `/tools` | preset | 把白名单注册成 `ftshare_*` 工具（`inject: ['tools','ftshareMarket']`）。只覆盖 `dsh_kline` 没有的能力。 |
| `/project` | preset | 注册 `tools/post-execute` 投影钩子（`inject: ['tools']`）。P7/P8 的修复本体。 |

**provider 必须挂全局**：preset 内 `provide` 会直接抛
`Preset services require isolate realms`（`@deepseek-ai/dsh-agent-preset-registry` 的
`mount.ts`）；按提示加 `isolate` 之后服务又变成 preset 私有，preset 之外的插件再也
`inject` 不到。所以服务全局、工具与钩子 preset——标准模式因此一条 `ftshare_*` 工具、
一个投影钩子都看不到。

本包**纯 host，不声明 `dsh.client`**，浏览器半平面问题不存在。

## 消费方式

```ts
import type { FtshareMarketService, FtshareCallResult } from '@ft/dsh-fft-ftshare/contract'

export const inject = ['ftshareMarket']

export function apply(ctx: Context): void {
  ctx.inject(['ftshareMarket'], scoped => {
    const market: FtshareMarketService = scoped.ftshareMarket
    // 只有 available 才能说「有数据」；empty 才是「没有」；denied 是套餐/凭据问题。
    const result: FtshareCallResult = await market.call('ft_v1_finance_income', { stock_code: '600519' })
  })
}
```

`call()` 不抛异常：权限与失败走 `state` / `notice`。`ok` 只表示「通道走通了」，不表示
「有数据」——后者看 `state`。

## 开发

```bash
pnpm build      # tsc，产物 lib/（git 安装只送达被跟踪文件，lib/ 必须入库）
pnpm test       # 先 build，再跑投影与归一测试
pnpm typecheck
```

`scripts/test-projection.mjs`：真实形状的 fixture 下，断言「修复前是 `events=0`、
修复后是三态加明细」、四种段落状态的措辞、长度上限、形状不符时原样放行，以及钩子
本体在命中/未命中/被下游 block/被下游替换 value 四种情况下的行为。

`scripts/test-service.mjs`：假 transport，断言 `call()` 的四态归一（不发网络请求）。
