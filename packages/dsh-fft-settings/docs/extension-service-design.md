# 设置扩展服务设计（方案 A2）：让任何插件注册自己的设置

> 状态：**已实现，未合并未发布**。A2 两条缝与第 10 节的 apiKey 归位已落在 `feat/settings-extension` 分支（三步：落缝、归位与分家、立规矩）；版本 `0.3.0`、发布说明与 ER 重绘仍待发布提交。
>
> 基线：DSH 0.2.0-rc.2；`@ft/dsh-fft-settings` 0.2.0 → 目标 0.3.0；`FTSHARE_SETTINGS_API_VERSION` 保持 `1`（路由与 envelope 不变）。
>
> 配图：[extension-service-sequences.html](extension-service-sequences.html)，1 张架构图 + 5 张时序图，与本文第 2、3、4、7 节一一对应。

## 1. 目标与非目标

目标：任意 FT 插件（本仓的、`@ftshare-lab/dsh-kline` 这类第三方的）都能**不改本插件源码**地登记一项设置，并且用户改动后**注册方自己的代码能读到**该值。

判定成功的三步，缺一不算完成：

1. 插件在自己仓里写一个 Host 模块 + 一张浏览器卡片，settings 仓库零改动；
2. 卡片出现在「非凸金融终端」设置页内，与内置的 API Key 卡并列；
3. 用户保存后，插件 Host 模块读到新值（第三方若有独立进程/语言侧，由它自己的桥接承担第二跳）。

非目标：不做主题/偏好的通用 KV 平台；不做卡片的跨命名空间通信；不做浏览器到 Python 的明文凭据通道；不改内置 API Key 的公共方法、RPC 路径与页面操作。

## 2. 架构：两条缝，各自一个平面

| 缝 | 平面 | 形式 | 谁声明位置 | 谁注册内容 |
| --- | --- | --- | --- | --- |
| 卡片位置 | 浏览器 | 槽位 `ftshare.settings.card`（`kind: list`, `scope: root`） | settings 客户端半：注册 `settings.section` 条目时在 `children` 里声明 | 任意插件的客户端半 |
| 命名空间与调用 | Host | Cordis 服务 `ctx.ftshareSettings.modules.register(module, owner)` | settings Host 半：提供注册表与活路由表 | 任意插件的 Host 半 |

两条缝都遵循 DSH 的既有分工：**UI 位置跨包走槽位，行为跨包走 Cordis 服务**。这也是不采用 better-sidebar 式自建客户端注册表服务的原因——`registerTab` 那类 API 面向"打开/关闭/聚焦"这类行为，而这里要的只是一个渲染位置；自建注册表要把响应式、去重、排序、释放、可观测性全部重写一遍，与槽位机制重复。反过来，Host 侧不能用槽位表达：RPC 是行为，且需要"注册即出现在白名单路由里"。

分层与数据流（图 1）四段：注册期两条（卡片进台账、命名空间进注册表），运行期一条（卡片 → `/api/ftshare-settings` → 归属模块），撤销期两条（随插件 fiber 一起消失）。

浏览器与宿主是**两个 Cordis 实例**：浏览器半不能运行时 import 宿主半，也不能 import 其他插件的组件；两侧各自持有自己的一半注册。

## 3. 公开接口（Host）

### 3.1 模块形状：结构化对象，无需 import 本包

```ts
interface SettingsModule<N extends string, S> {
  /** 命名空间：进 RPC endpoint 前缀，也是服务对象上的属性名。 */
  readonly namespace: N
  /** 模块用到的宿主服务；注册时逐一校验它们在 owner 上可解析，缺失即抛错。 */
  readonly inject: readonly string[]
  /** 同步创建；返回你自己的服务实例与要公开的 RPC 方法。 */
  create(ctx: Context): { service: S; rpcMethods: SettingsRpcMethods }
}
```

第三方可以完全不依赖本包的运行时导出，只按形状写对象即可；用 `defineSettingsModule` 只为了拿到类型推导。

### 3.2 注册

```ts
export function apply(ctx: Context): void {
  // 可选能力：settings 没装时这一段不生效，插件其余功能不受影响。
  // 模块自己用到的宿主服务（如 'storage'）也写进这一层的 inject，与 module.inject 对齐。
  ctx.inject(['ftshareSettings'], scoped => {
    const reg = scoped.ftshareSettings.modules.register(klineSettingsModule, scoped)
    reg.service      // 你自己 create() 返回的服务实例，类型由推断得到
    reg.namespace    // 'kline'
    reg.dispose()    // 幂等；owner fiber 释放时注册表已代为调用
  })
}
```

`register(module, owner)` 的语义（全部为硬约束，实现与测试都按此写）：

| 项 | 规则 |
| --- | --- |
| 校验时机 | 先校验后写入：命名空间非法、保留名、重复 → 抛错，且**不产生任何副作用**（不写服务属性、不写路由表、不调用 `create`） |
| 命名空间格式 | `^[a-zA-Z][a-zA-Z0-9]*$`，禁路径分隔符 |
| 保留名 | `apiVersion`、`modules`、`constructor`、`prototype`、`__proto__` |
| 重复命名空间 | 抛 `Duplicate settings namespace: <ns>`；重试的前提是前一次已撤销 |
| 生命周期 | 注册表在 `owner` 上装 effect，`owner` fiber 释放 → 服务属性删除 + 该命名空间的全部 RPC route 删除；返回的 `dispose()` 幂等 |
| 服务依赖 | 模块在 `module.inject` 里声明自己用到的服务，注册时逐项校验在 `owner` 上可解析；调用方要保证自己那一层 `ctx.inject([...])` 覆盖同一批服务（settings 不替模块声明任何服务） |
| 同步性 | `create` 必须同步返回；不做异步初始化 |
| 属性可见性 | 命名空间属性在注册后**动态出现**、撤销后消失；消费方不要在自己 apply 时解构缓存 |

### 3.3 服务对象与类型面

```ts
/** 需要跨命名空间读取的包 declare-merge 自己的一行；生产者不需要。 */
export interface FtshareSettingsNamespaces {}
export interface SettingsRegistration<N extends string, S> {
  readonly namespace: N
  readonly service: S
  dispose(): void
}
export interface FtshareSettingsModuleRegistry {
  register<const N extends string, S>(module: SettingsModule<N, S>, owner: Context): SettingsRegistration<N, S>
  namespaces(): readonly string[]
}
export type FtshareSettingsService =
  & { readonly apiVersion: typeof FTSHARE_SETTINGS_API_VERSION; readonly modules: FtshareSettingsModuleRegistry }
  & { readonly [N in keyof FtshareSettingsNamespaces & string]: FtshareSettingsNamespaces[N] }
```

- **生产者**（我注册的命名空间）靠 `register` 的泛型推断拿类型，不需要 merge。
- **消费者**（我要读别人的命名空间，例如 `ctx.ftshareSettings.kline.get()`）才需要 `declare module` 合并一行。
- 内置 `apiKey` 模块在模块文件内 merge 自己一行，保持 `ctx.ftshareSettings.apiKey` 的既有类型面不变，cockpit 等现有消费者零改动。

### 3.4 版本与兼容

- 路由 `/api/ftshare-settings`、endpoint 命名 `<namespace>/<method>`、envelope 形状**全部不变** → `apiVersion` 保持 `1`。
- 服务对象新增 `modules` 成员属加法；命名空间从"静态元组推导"改为"运行时注册 + merge 扩展"属**编译期**变化 → 包版本 `0.2.0 → 0.3.0`。
- 包内既有 `src/modules.ts` / `src/cards.ts` 清单不再是唯一入口；包内模块改为经同一注册表注册（自食其力），清单可删除或退化为内置模块的聚合点。

## 4. 公开接口（浏览器）

### 4.1 槽位 `ftshare.settings.card`

settings 客户端半注册 `settings.section` 条目时声明该子槽位，并在 section 组件里 `renderSlot` 它；内置 API Key 卡同样注册进这个槽位（`id: 'apiKey'`, `order: 10`），因此「内置」与「第三方」只有一条代码路径。

| 注册项 | 规则 |
| --- | --- |
| `name` | 固定 `'ftshare.settings.card'`（槽位键由本包声明，第三方只需 `import type {} from '@ft/dsh-fft-settings/client'` 拿到 SlotMap 合并） |
| `id` | 必填、全局唯一；同 id 同 priority 在装载时抛错 |
| `order` | 升序排列。省略时由 DSH 槽位决定：0.2.0-rc.2 的 ui-slots 把缺省当 `0`（section 只调 `renderSlot`，补不了默认值）；内置 API Key 为 `10`，要排在它之后必须显式给更大的值 |
| `label` | `string \| (() => string)`，section 内做分组标题用；缺省不显示 |
| `priority` | **不对外公开**：槽位的遮蔽语义是"同 id 不同 priority 静默遮蔽、低者渲染"，第三方能用它顶掉我们的卡片；文档与示例只给 `id`/`order` |

卡片组件拿到的是槽位标准五份额（runtime / renderSlot / store / inject face / locale），**拿不到 settings 的内部状态**：没有服务对象、没有凭据协调、没有验证模型。卡片要的数据走 4.2 或它自己的注入面。

**每张卡片自带样式**：核心只提供 CSS 变量（`--ftshare-*`）与 section 外壳样式，卡片自己的 CSS 由组件内的 `<style>` 随挂载/卸载增删。槽位的注册选项只有 `id`/`order`/`label`，没有放 CSS 的位置，`<style>` 是唯一自洽的落点；内置 API Key 卡与第三方卡片遵守同一条规则。

### 4.2 数据通道：复用现有路由与适配器

```ts
import { callSettingsRpc, createSettingsTransport } from '@ft/dsh-fft-settings/client-api'
const transport = createSettingsTransport()          // 每个插件建一次，复用
const value = await callSettingsRpc<Value>(transport, 'kline', 'get')
await callSettingsRpc(transport, 'kline', 'set', { key: 'kline setting 1', value })
```

| 约束 | 值 |
| --- | --- |
| endpoint | `<namespace>/<method>`，只派发 Host 注册表里显式登记的方法，不反射服务对象 |
| 传输 | 同源 `POST /api/ftshare-settings`，Host/Origin fence 与浏览器鉴权由 `/api` 载体负责，插件不重复实现 |
| body 上限 | 64 KiB（`FTSHARE_SETTINGS_MAX_BODY_BYTES`） |
| envelope | `{ ok: true, value }` / `{ ok: false, error: { code, message, details } }` |
| 错误码 | `not_found`（endpoint 未注册）、`bad_request`（模块 `validate` 拒绝）、`cancelled`、`operation_failed` |
| 永不开放 | `resolve()`、`createEnvironment()` 等含秘密的方法；不提供任意 URL/方法代理 |

A2 与 A1 的唯一分歧就在这里：A2 的卡片复用本插件的路由与适配器（推荐）；A1 的卡片自带数据通道（消费方自己实现路由、fence 与鉴权，成本更高，且本插件的路由本来就是为"插件与 webServer 平级"这一场景特制的）。本设计按 A2。

## 5. 能力范围

**能做到**

| 能力 | 说明 |
| --- | --- |
| 运行期注册/撤销 Host 命名空间 | 注册后立即出现在 `ctx.ftshareSettings.<ns>` 与白名单路由中；撤销后两者同时消失 |
| 运行期注册/撤销设置卡片 | 带 `id`/`order`/`label`，随注册方 fiber 释放，后注册也能渲染出来 |
| 自带服务与存储 | 值存哪、怎么读，完全由模块自己决定；settings 不碰模块的数据 |
| 卡片自带样式与文案 | 核心不集中注入卡片 CSS、也不替卡片决定文案：变量在核心，卡片样式随组件走 |
| 复用共享调用通道 | fence、鉴权、白名单、体积上限、适配器 |
| 可选装配 | settings 缺失时消费方用 `ctx.inject([...])` 挂载，插件其余部分照常工作 |
| HMR 安全 | 注册是 effect，重载不残留、不重复；重复注册在装载期就抛错 |

**做不到（含刻意不做）**

| 边界 | 原因 |
| --- | --- |
| 卡片不能新增导航条目或子分区 | 只注册进已声明的一个槽位；要独立导航页请自己注册 DSH 的 `settings.section` |
| 卡片不能读 settings 内部状态或别的命名空间 | 浏览器侧没有跨命名空间访问路径（Host 侧靠 Cordis 服务语义，见下） |
| 不提供 Secret 通道 | `resolve`/`createEnvironment` 永久排除在浏览器 API 与模型工具之外 |
| 不做 Python/子进程明文桥 | 由消费方自己实现私有 IPC（见 6.2） |
| 不保证注册顺序与代码层依赖 | 只有声明关系（槽位/服务），没有插件间的运行时 import |
| 不提供非 React 渲染入口 | 槽位只渲染组件；纯命令式 UI 需求不在本缝内 |
| 卡片之间不能通信、不能互相抢占 | 不公开 priority，不提供卡片注册表查询 API |
| 不提供"临时覆盖"语义 | 沿用现状：写入即持久化，`persist=false` 类选项不支持 |

Host 侧对已注册命名空间的服务对象没有可见性控制：**同进程任何插件都能读到** `ctx.ftshareSettings.<ns>`。共享的是服务实例（可能含秘密），不是浏览器数据；需要私密性的值应留在模块闭包里，不放进 service。

## 6. 其他插件如何使用

### 6.1 同仓插件（以投研舱为例，走 A2 全量）

```ts
// packages/dsh-fft-research-cockpit/src/settings.ts（Host 模块）
export const cockpitSettingsModule: SettingsModule<'cockpit', CockpitSettings> = {
  namespace: 'cockpit',
  inject: ['storage'],                       // 示例：只声明模块实际用到的服务
  create(ctx) {
    const service = createCockpitSettings(ctx)   // 读写自己的配置，逻辑全在插件内
    return { service, rpcMethods: createCockpitRpcMethods(service) }
  },
}
```

```jsonc
// packages/dsh-fft-research-cockpit/src/client/index.js（浏览器半）
// ctx.slots.inject('ftshare.settings.card', () => ctx.slots.register(
//   { name: 'ftshare.settings.card', id: 'cockpit', order: 40, label: '投研舱' }, CockpitCard))
```

读路径一跳：同一个 Host 模块闭包就是权威值来源。

### 6.2 第三方插件（以 `@ftshare-lab/dsh-kline` 为例）

kline 的现状对它有利也有限制：`package.json` 没有 `dependencies`/`peerDependencies`（只有 devDeps），客户端半已经用 `thirdparty/dsh_kline/src/client/index.tsx:47` 的 `ctx.inject(['betterSidebar'], …)` 做可选服务挂载，类型来自 devDependency。接入本缝照抄同一姿势即可：

- **主机半**：`ctx.inject(['ftshareSettings'], scoped => scoped.ftshareSettings.modules.register(klineSettingsModule, scoped))`；kline 现在只有 `inject = ['webServer']`，这里新增的是作用域挂载，不是静态 inject（静态 inject 缺服务会让整个宿主半不激活，独立模式会挂）。
- **浏览器半**：`import type {} from '@ft/dsh-fft-settings/client'` 只为 SlotMap 合并（devDependency，type-only，运行时零依赖），卡片用 4.2 的适配器调 `kline/get`、`kline/set`。
- **Python 侧**：kline 的行情能力在 `server.py`/`tools/`，写进 Host 的值不会自动到 Python；需要它自己实现私有桥（现有手段是 spawn MCP 时传环境变量 + 自身 HTTP 服务），或明确要求重启。这是"注册方的代码能读到"在 kline 上是第二跳，本设计不代做。
- **零依赖变体**：kline 可以完全不依赖本包——自己 `declare module '@deepseek-ai/dsh-client-ui-slots'` 补槽位键、自己 `fetch('/api/ftshare-settings')` 拼 envelope。代价是契约只靠文本约定，我方改 envelope 属无声破坏。推荐仍取"只依赖类型"的姿势。

### 6.3 只读消费方

要读别人的命名空间（例如某个报告插件想读 cockpit 的配置）：

```ts
import type { CockpitSettings } from '@ft/dsh-fft-research-cockpit'
declare module '@ft/dsh-fft-settings' {
  interface FtshareSettingsNamespaces { cockpit: CockpitSettings }
}
// apply: export const inject = ['ftshareSettings']，然后 ctx.ftshareSettings.cockpit.get()
```

### 6.4 禁止的用法

浏览器半 import Host 模块或凭据代码；卡片之间互相 import 组件；把 `resolve()` 的结果送进 DOM、模型工具结果或日志；用同一个 id 注册两张卡（装载期抛错）；靠 `priority` 顶掉别人的卡片。

## 7. 时序图说明

配图 [extension-service-sequences.html](extension-service-sequences.html) 共 6 张，按"架构 → 注册 → 使用 → 生命周期"排列：

| 图 | 标题 | 讲什么 |
| --- | --- | --- |
| 1 | 架构与两条缝 | 两个 Cordis 实例、六类参与者、注册期两条缝、运行期一条 HTTP、撤销期两条 |
| 2 | S1 插件注册命名空间 | `register(module, owner)` → 校验 → `create` → 发布服务属性与 RPC route；**校验在写之前** |
| 3 | S2 插件注册卡片 | 槽位声明 → `slots.inject` 等待声明 → 注册卡片 → 用户打开设置页后 `renderSlot` 挂载 |
| 4 | S3 端到端读写 | 用户改 `kline setting 1` → 卡片 → `/api/ftshare-settings` → kline 模块 → 自有存储 → 回读，kline 自己的代码在模块闭包里读到新值 |
| 5 | S4 卸载与 HMR | 插件 fiber 释放：Host 命名空间与它的全部路由先消失，客户端槽位注册随后消失；用户看到卡片移除，其余卡片保留 |
| 6 | S5 可选装配 | 正常路径：`ctx.inject` 拿到服务 → 注入槽位 → 声明到达 → 卡片渲染；`opt [未安装]` 分支：同一次注入只会得到"未提供"，整段不生效，插件其余功能照常 |

图 2-6 与第 3、4 节的接口一一对应；图 1 与第 2 节一一对应。

## 8. 落地清单

| 文件 | 改动 | 对应断点 |
| --- | --- | --- |
| `src/module-registry.ts` | `assembleSettings` → 活注册表：`register(module, owner)`、`namespaces()`、原子写入与撤销；内置模块走同一路径 | G1/G4 |
| `src/rpc-core.ts` | handler 由启动快照改为活表：增量 register/unregister；保留白名单与校验语义；保留名表加入 `modules` | G1 |
| `src/contract.ts` | `FtshareSettingsNamespaces` 合并点 + `FtshareSettingsModuleRegistry` / `SettingsRegistration` / 新 `FtshareSettingsService`；apiKey 的类型行 | G3 |
| `src/index.ts` | 静态 `inject` 不再从模块清单推导；`provide` 与路由注册逻辑不变（注册一次，派发看活表） | G1 |
| `src/modules.ts` | 内置清单改为"注册内置模块"的聚合点，或删除 | G4 |
| `src/client.tsx` | `settings.section` 条目声明 `children: { 'ftshare.settings.card': … }`；section 组件 `renderSlot`；内置 API Key 卡改走槽位 | G2 |
| `src/modules/api-key/card.tsx` | `defineSettingsCard` → 槽位注册；其余不变 | G2 |
| `src/card-registry.ts` / `src/cards.ts` | 删除（契约与清单的职责被槽位接管） | G2 |
| `package.json` | `./contract`/`./client`/`./client-api` 导出面按需增补类型（SlotMap 合并需在 `lib/client.d.ts` 可见，现状已满足）；版本 0.3.0 | 发布 |
| `tests/*` | 新增：晚注册后服务属性与 RPC 同时可用；`owner` fiber 释放后两者同时消失；重复命名空间抛错且无副作用；保留名；`module.inject` 声明的服务不可解析时注册抛错；内置模块经注册表仍可 `ctx.ftshareSettings.apiKey`；卡片晚注册后渲染 | 验收 |
| `README.md` | 「新增一种设置」整段重写为"由插件自己注册"，保留包内模块的说明；接入约定补 `modules.register` 与槽位键 | 文档 |
| 消费方（各自仓库） | cockpit 全量接入做验收；kline 按 6.2 接入（跨仓，单独排期）；internal-plugin 的 `settings.models.footer` 块可选迁入 | 联调 |

发布口径：本插件 `0.3.0`（新公开缝，向后兼容）；`docs/releases.draft.md` 追加一条；是否需要同步 bump 组合包版本按 `dsh-fft-release-note` 流程判断。

## 9. 决策记录

已定：

- **D1 只开放两条缝**：Host 命名空间注册 + 卡片槽位；不做客户端注册表服务（理由见第 2 节），不做 A1 的自带通道（第 4.2 节）。
- **D2 `owner` 必填**：`register(module, owner)` 显式接管生命周期，避免 HMR 下漏写 effect 造成重复命名空间。
- **D3 卡片 priority 不公开**：只给 `id`/`order`/`label`。
- **D4 apiVersion 保持 1**，包版本 0.3.0。
- **D5 内置模块与内置卡片走同一套注册路径**（自食其力），不存在内置/外部双轨。

待定（落地前定，不影响本文接口）：

- 是否把 `/client-api` 的适配器提升为 `createSettingsNamespaceClient(transport, ns)`（省掉消费方每次手写 `callSettingsRpc`）。
- 是否发布一个只含契约与类型的 `@ft/dsh-fft-settings-contract` 包，供不方便依赖完整包的第三方（如 kline）使用。
- 卡片是否需要一个"只读值展示"的轻量声明式形态（现在只能给组件）。

## 10. 现有设置的重构：把 apiKey 从"核心里的特权模块"降级为"第一个特性"

这次改造的收益不只是"允许第三方注册"：一旦两条缝成立，现有实现里**核心与特性纠缠**的部分就有了明确的目标形状。重构可以在同一分支上分三步做，每一步行为零变化。

### 10.1 现状诊断

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | 通用契约与 apiKey 词汇混在同一个"浏览器安全"入口 | `src/contract.ts` 既有 `FTSHARE_SETTINGS_ROUTE`/`apiVersion`，也有 `ApiKeyStatus`/`ProbeState`/`normalizeApiKey`；host 消费者（cockpit `src/report-service.ts:6`）只能从这个入口取 host 类型 |
| 2 | 一个特性的实现散在两处 | `src/api-key.ts`、`src/probe.ts`、`src/settings-model.ts` 在 `src/` 根，`src/modules/api-key/` 在另一处 |
| 3 | 核心与特性之间没有真边界 | 加特性必须改核心清单（`src/modules.ts`、`src/cards.ts`）；没有任何测试在守"core 不认识特性"这条约束 |
| 4 | 通用入口被特性污染 | `src/rpc.ts`（`/client-api`）硬编码 `createApiKeyClient`，每加一个特性都要改通用导出 |
| 5 | 卡片样式归核心所有 | `src/styles.ts` 是整块 `.ftshare-*`，核心必须知道卡片长什么样，第三方也无处放自己的 CSS |
| 6 | 卡片契约成为冗余层 | `src/card-registry.ts` 的 `SettingsCard`/`assembleSettingsCards` 在槽位接管后是重复机制 |

### 10.2 目标层次

```
L0  seam（核心，零业务词汇）
    host:   活注册表 / 活路由表 / envelope / 保留名 / apiVersion / transport
    client: settings.section 外壳 + 声明 ftshare.settings.card 槽位 + 主题 CSS 变量
L1  features（经公开缝注册，与第三方同一姿势）
    features/api-key/: 命名空间契约、host 模块、rpc 方法、浏览器适配器、卡片、模型、探测、样式、测试
L2  consumers（cockpit / kline / internal-plugin）
```

```
src/core/{contract,module-registry,rpc-core,transport,client-transport}.ts
src/core/shell.tsx        // section 外壳 + 槽位声明 + CSS 变量
src/features/api-key/{contract,host,rpc,client-api,card.tsx,model.ts,probe.ts,service.ts,styles.ts,index.ts}
src/index.ts              // 只装配：provide 服务 + 注册内置 feature
src/client.tsx            // 只装配：声明槽位 + 注册内置卡片
```

约束：**core 不得 import features**，特性只能用 core 的通用类型与工具。守护这条的是一条 grep 测试（`src/core/**` 不允许出现 `apiKey` 字样），与 DSH 自家 `verify-client-domain-graph` 同性质。

### 10.3 apiKey 的重写映射（对外零变化）

| 现在 | 之后 |
| --- | --- |
| `contract.ts` 的 apiKey 段（`ApiKeyStatus`/`ConfigureResult`/`ProbeState`/`ValidationResult`/`normalizeApiKey`/`untested`） | `features/api-key/contract.ts` |
| `src/api-key.ts`（凭据协调） | `features/api-key/service.ts` |
| `src/probe.ts` | `features/api-key/probe.ts` |
| `src/settings-model.ts` | `features/api-key/model.ts` |
| `src/modules/api-key/*` | `features/api-key/*` |
| 卡片 CSS 在核心 `src/styles.ts` | 卡片自带 `<style>`（见 4.1）；核心只留 CSS 变量与外壳样式 |
| `src/rpc.ts` 导出 `createApiKeyClient` | 移出 `/client-api`；通用入口只留 `createSettingsTransport`/`callSettingsRpc`/类型 |
| `src/modules.ts` / `src/cards.ts` 清单 | 删除；`src/index.ts` 直接 `ctx.ftshareSettings.modules.register(apiKeyModule, ctx)` |

**对外契约一律不动**：`ctx.ftshareSettings.apiKey.*`（含 `resolve()`）、RPC 前缀 `apiKey/*`、`/api/ftshare-settings`、envelope、`apiVersion = 1`。`/contract` 退化为**再导出汇总**（通用 + 内置特性契约），cockpit 现有的两处 `apiKey.resolve()` 与 `FtshareSettingsService` 类型导入零改动；同时把它的定位从"浏览器安全"改写为"无 Node 运行时依赖"，并在 README 写明 host/browser 两套类型各自的来源——现在"浏览器安全入口里放 host 类型"正是 10.1 第 1 条的根源。

### 10.4 是否拆成独立包

现在不拆：只有一个特性、依赖只有 `@deepseek-ai/dsh-credentials`，拆了要多吃一条发布/安装/组合行成本，而客户端每个包是一条独立动态 bundle。触发拆分（任一满足再拆）：特性带自己的重依赖（图表/SDK/Python 产物）；特性有自己的发布节奏或对外版本；特性可能被别的 profile 单独安装而不装核心。目录与接口先按"可拆"写死，真到那天只是搬目录 + 加一条依赖边。

### 10.5 顺序

1. **落缝**：core 注册表 + 槽位；内置 apiKey 原样包成一个 module + 一张卡注册进去（不动目录），测试全绿、行为零变化。
2. **归位与分家**：目录搬迁 + 契约拆分 + `/contract` 再导出，纯移动。
3. **立规矩**：core 禁特性词汇的架构测试、README 重写（「新增一种设置」改为"写一个 feature，经公开缝注册"）。

### 10.6 成本与风险

约 1.5~2 人日（缝 + 内置特性迁移 0.5~1；目录/契约归位 0.5；架构测试与文档 0.5），消费方零改动。净删除 `cards.ts`、`card-registry.ts`、`modules.ts` 与 `/client-api` 的特性导出。

风险两条：契约迁移是包内相对路径变化（不影响外部）；样式从"核心集中注入"改为"卡片自带"，4.1 的规则必须先写进 README 与示例，否则第三方会把 CSS 塞回核心。

