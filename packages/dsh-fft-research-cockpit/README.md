# FT 投研舱

安装包名为 `@ft/dsh-fft-research-cockpit`（用于 npm/pnpm 和 DeepSeek Harness 包解析），运行时插件显示名为 `FT 投研舱`，profile 行 id 仍为 `ft-research-cockpit`。

> **本仓迁移（2026-10）**：源码自 `dsh-ft/submodules/dsh-ft-research-cockpit@b91ff2a` 整包搬入 `dsh-fft-bundle`，包名由 `ft-research-cockpit` 改为 `@ft/dsh-fft-research-cockpit`，并按 DSH 0.2.0-rc.2 校准宿主 API。共享设置依赖由 `@ft/dsh-ftshare-settings` 改为 `@ft/dsh-fft-settings`（Host 服务名 `ftshareSettings` 与路由未变）。迁移条目见仓库根 [releases.md](../../docs/releases.md)。

已有 profile 若仍保留旧的 `investment-research` 或 `ft-个人投研-kit` 条目，请将该条目的 `id` 更新为 `ft-research-cockpit`，并将依赖名改为本仓的 `@ft/dsh-fft-research-cockpit`；这是一次插件身份改名，不会自动迁移旧条目。

独立于 `stock_rec_stream` 的 DeepSeek Harness 投研报告插件。当前设计边界是：

- 运行时金融数据只来自 FTShare Streamable HTTP MCP；
- 不导入、不修改 `/Users/xzmini24/FtNova_work/stock_rec_stream`；
- 已提供 8 类报告：`deep_read`、`holding_analysis`、`limit_up_attribution`、`market_commentary`、`portfolio_etfs`、`portfolio_stocks`、`review`、`sector_analysis`；另有独立的 `cockpit_portfolio_recommendation` 组合构建工具；
- 报告结果返回 HTML 及结构化结果、证据、来源、新鲜度和数据缺口；Web 对话中显示紧凑报告卡片，点击“打开报告”进入占满会话区的独立阅读视图，也可以切换为全屏阅读；用户点击下载按钮后才保存到本地；
- 公告默认回看 `30` 个自然日，可通过 `announcementLookbackDays` 调整；
- T0 等没有被 FTShare 确认提供的数据不会伪造，统一进入 `dataGaps`。

## 目录

```text
dsh-investment-research/                 # 当前 checkout 目录
├── package.json
├── cordis.patch.yml
├── cordis.local.patch.yml
├── src/
│   ├── index.ts
│   ├── report-tool.ts
│   ├── report-service.ts
│   ├── portfolio-recommendation.ts  # 候选池筛选、主题/分散选股与权重
│   ├── ftshare-client.ts
│   ├── ftshare-data.ts
│   ├── indicators.ts
│   ├── llm-report.ts
│   ├── report-schema.ts
│   ├── html-renderer.ts
│   └── client/index.js                 # DSH Web 报告卡片、独立阅读视图、右侧详情与按需下载
└── resources/templates/
    ├── deep_read_report.html
    ├── holding_analysis_report.html
    ├── limit_up_attribution_report.html
    ├── market_commentary_report.html
    ├── portfolio_etfs_report.html
    ├── portfolio_stocks_report.html
    ├── review_report.html
    └── sector_analysis_report.html
```

插件遵循 Harness 官方的 Cordis 形态：入口导出 `apply(ctx, config)`，通过 `inject` 声明 `tools`、`llm`、`credentials`，工具使用 `defineTool` 注册；`package.json` 同时声明 `dsh.client`，让 DSH Web 自动加载报告卡片。正式分发采用 `dsh.bundle.patch` 组合包格式。参考：[第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)、[开发一个工具](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md)、[打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。

## FTShare 配置

默认地址是 `https://market.ft.tech/gateway/mcp`。FTShare 的部分实时行情、日线和研报接口需要 API Key；插件不会把密钥写入仓库，可通过环境变量注入：

报告默认只保存在 DSH 会话结果中，供 Web 独立报告视图或右侧详情面板读取；插件不会自动创建或覆盖工作区文件。独立报告视图使用会话正文的完整宽度，提供返回对话、报告切换、全屏阅读以及 HTML、PDF、PNG 下载。点击下载按钮时，浏览器才会保存当前报告。旧版本的 `outputDir` / `saveToWorkspace` 配置字段仅为兼容旧 profile 保留，不再触发自动写盘。

```bash
export FTSHARE_API_KEY='你的 FTShare API Key'
pnpm test:ftshare 300750 2026-09-02
```

也可以在 Harness 的插件配置中传入请求头：

```yaml
config:
```

全部报告均优先读取真实 FTShare 数据；不同报告按需调用行情、日线、财务、估值、公告、资金流、行业、涨停、ETF 等 FTShare 工具。LLM 只能使用本次 FTShare 返回的事实，未接入字段统一以数据遮罩呈现，并保留已返回事实。

当前使用的核心 FTShare 工具为：

| 数据 | 工具 |
| --- | --- |
| 证券行情 | `ft_v1_company_list` |
| 日线 OHLCV | `ft_v1_stock_candlesticks` |
| 利润表 | `ft_v1_finance_income` |
| 现金流量表 | `ft_v1_finance_cashflow` |
| 个股估值 | `ft_v1_eastmoney_stock_valuation` |
| 公司公告 | `ft_v1_report_announcement_list` |
| 机构研报 | `ft_v3_report_stock_reports` |

报告级数据接口还会按报告类型补充调用：

- 市场点评/复盘：`ft_v1_daec_stocks`、`ft_v1_daec_market_snapshot`、`ft_v1_eastmoney_market_valuation`、`ft_v1_stock_capital_flows`、`ft_v2_eastmoney_dapan_flow`、`ft_v2_ths_hot_list`、`ft_v1_limit_list`、ETF 描述接口；
- 板块分析：`ft_v1_ths_board_list`、`ft_v1_sw_industry_overview`、`ft_v1_ths_all_board_kline`（自动兼容 `ft_v1_ths_board_kline`）、`ft_v1_ths_industry_daily_flow`、`ft_v1_eastmoney_sector_flow`、`ft_v1_tdx_board_members`、产业链接口及成员实时行情接口；
- ETF 组合：`ft_v2_etf_description_all`、`ft_v4_etf_realtime_day_kline`，并自动降级到 `ft_v1_etf_candlesticks`；
- 涨停归因：`ft_v1_limit_list`、`ft_v2_limit_event_timeline_3s`、`ft_v3_limit_up_reports_briefs` 及公告兼容接口。

接口返回空数据或被拒绝时，报告会保留已获得的真实内容，并把原因写入 `dataGaps`/`warnings`；权限受限模块使用升级遮罩，普通空数据使用中性占位，绝不填充模拟金融数据。套餐按 FTShare 文档的免费版、基础版、进阶版、专业版（Pro）识别；同一数据存在多个接口时，默认按专业版 → 进阶版 → 基础版 → 免费版尝试，在上游明确返回权限不足、接口别名不支持或结果为空时尝试已配置的兼容接口。降级前的权限缺口同时保留在 `permissions` 和 `blockedPermissions` 中；返回了可用事实时以 `partial` 标记，在保留这些事实的同时展示独立受限数据遮罩。

权限限制统一从 MCP 错误及成功响应的权限元数据读取。深度研读报告保留完整量化底稿（财务、估值、资金流、两融、风险暴露及图表），缺失值不伪造；已移除独立 T0 评估，市场份额、竞争格局、历史分位和同业比较仅在有实际内容时展示。章节编号随内容连续排列。订阅受限与普通空数据仍分别处理。未匹配到既有展示位置的受限接口会保留具名遮罩，避免静默消失。普通空数据不冒充订阅限制。

若 FTShare 返回订阅权限不足，结果会包含 `permissions`，并在对应 HTML 数据模块内显示 50% 透明灰色遮罩和可点击的 [升级 FtShare 订阅](https://ftai.chat/me/profile?tab=subscription) 入口；页面顶部不再插入统一权限横幅。当前已接入的典型降级链包括：专业版实时股票日 K → 免费版公司/行情快照；基础版股票公告 → 免费版兼容公告接口。行情和研报权限不足时仍可生成降级报告；日线、财务、估值和公告会独立保留。

非权限型数据缺口会保留其余已接入事实，并在对应模块使用中性占位；明确的 FTShare 权限不足会显示 50% 透明升级遮罩和升级入口。报告正文不暴露“数据不足”“当前模块无法接入”或底层工具调用诊断。

## 本地开发

当前机器没有全局 `dsh`，但 `/Users/xzmini24/FtNova_work/deepseek-harness` 源码仓库可以通过 `pnpm dsh` 启动。安装并准备好与 Harness 匹配的依赖后：

```bash
pnpm install
pnpm build
```

本地无密钥只能运行接口契约与渲染验收；不会生成或展示模拟金融数据：

```bash
pnpm test:report-facts
pnpm test:completeness
pnpm test:llm
pnpm test:missing-data
pnpm test:market-commentary
```

浏览器权限回归（需要 Playwright 和 Chrome；可用 `PLAYWRIGHT_MODULE` 指向 Playwright 模块，`CHROME_BIN` 指定浏览器）：

```bash
pnpm test:permissions:browser
```

覆盖全部 8 类报告的权限拒绝、部分数据可用、无权限限制三种状态，以及 375/705/768/1280/1640px 五种宽度；逐接口检查遮罩可见性、按钮边界、横向溢出和页面脚本错误。测试数据仅用于回归，不进入实际报告。

`dsh` 命令需要在 DeepSeek Harness 源码仓库根目录执行；本插件目录只负责构建 bundle。准备好 Harness checkout 后：

```bash
cd /path/to/deepseek-harness
pnpm dsh web --patch /Users/xzmini24/FtNova_work/dsh-investment-research/cordis.local.patch.yml
```

如果插件已经通过 `dsh plugin --profile <name> add` 安装到 profile，就不要再传入
`cordis.local.patch.yml`：该 overlay 也会插入同一个插件条目，导致重复加载。已安装的 profile
直接这样启动即可：

```bash
cd /Users/xzmini24/FtNova_work/deepseek-harness
pnpm dsh --profile headless '请调用 cockpit_deep_read_report，对 300750 生成一份深度研读报告。'
```

`cordis.local.patch.yml` 仅用于插件尚未安装时的源码 overlay 场景；如果需要覆盖已安装插件的配置，
请在 profile 的 `cordis.patch.yml` 中用同一个 `id` 写普通覆盖 patch，而不是再次 `insert`。

插件需要两类完全不同的凭证：

- `FTSHARE_API_KEY`：只给 FTShare MCP 数据接口使用；
- `DEEPSEEK_API_KEY`：由 Harness 的 `deepseek-official` provider 使用，负责 `ctx.llm.stream`。

DSH 会优先从其本地凭证库 `$DSH_HOME/.credentials.yaml`（本机默认为
`~/.dsh/.credentials.yaml`）读取这两个引用；继承的环境变量仍可用于临时覆盖。凭证库由 DSH
以仅用户可读写的权限保存，插件不会把密钥写进源码或 bundle。

例如在本机源码仓库中做 headless 验证：

```bash
export FTSHARE_API_KEY='你的 FTShare key'
export DEEPSEEK_API_KEY='你的 DeepSeek key'
cd /Users/xzmini24/FtNova_work/deepseek-harness
pnpm dsh --profile headless \
  '请对 300750 做一份深度研读报告，并调用 cockpit_deep_read_report 工具。'
```

只有在尚未把插件安装进 profile 时，才使用上面的 `--patch` 源码 overlay 命令。

没有 `DEEPSEEK_API_KEY` 时，Harness 仍会加载插件，但会在真正调用 `ctx.llm` 前报 `MISSING_CREDENTIAL`；这不代表 FTShare 或模板链路失败。

对话中使用：

```text
请对 300750 做一份深度研读报告
```

组合推荐使用独立的构建工具。它会把用户给出的代码当作候选池，而不是默认全部买入；生成结果包含候选池覆盖率、每只股票的评分依据、组合权重、行业暴露、重合度和数据缺口。

```text
从中证1000的股票中给我做一个5只股票的组合推荐
```

```text
我有股票池 300750、600519、601318、000333，请生成两个多主题分散组合，并使用风险预算权重
```

工具参数示例：

```json
{
  "poolSource": "custom",
  "symbols": ["300750", "600519", "601318", "000333"],
  "portfolioSize": 4,
  "portfolioCount": 2,
  "strategy": "risk_budgeting",
  "includeReport": true
}
```

支持的组合方式包括 `theme`（主题优先）、`diversified`（多主题分散）、`equal_weight`、`minimum_variance`、`risk_budgeting` 和 `auto`。中证1000默认使用 FTShare 的 `ft_v1_index_index_weight(index_code=000852)` 成分权重接口；若当前 FTShare 会话没有该能力，工具会明确返回数据缺口，不会自行填充股票代码。

Web 版本使用 `web` profile，默认监听 `http://127.0.0.1:3080`：

```bash
cd /Users/xzmini24/FtNova_work/deepseek-harness
pnpm dsh web
```

如果不希望自动打开默认浏览器，可使用 `pnpm dsh web --no-open`，然后手动打开终端打印的 URL。

## 板块报告样式

板块报告默认使用 Nova Research 八章布局，由 `resources/templates/sector_analysis_report.html` 与 `resources/templates/sector-nova.css` 生成。山景图片随插件打包，渲染时嵌入 HTML，下载后无需访问本地图片路径。

首页“核心逻辑”和“主要风险”由 LLM 生成独立的 `overview_analysis`，每条包含分析、验证条件和事实引用；引用内容由插件从已核验数据绑定。缺失或无效输出会重试；重试后仅保留逐条校验通过的模型原文，每类至少两条，否则显示 AI 分析未生成，不用固定观察项替代。

DSH 的报告页、侧栏和消息预览共用该模板；内嵌报告中的 PDF／分享按钮通过宿主导出，继续保留 iframe 沙箱。新生成的报告使用新版布局，历史报告是生成时的快照，需要重新生成才会更新。

## 正式安装

构建产物发布或打包后，可以安装 bundle：

```bash
cd /Users/xzmini24/FtNova_work
dsh plugin --profile demo add ./dsh-investment-research
dsh --profile demo
```

也可以交付 tarball：

```bash
cd /Users/ben/workspace/dsh-fft-bundle/packages/dsh-fft-research-cockpit
pnpm pack
dsh plugin --profile demo add ./ft-dsh-fft-research-cockpit-0.2.0.tgz
```

`package.json` 中的 `dsh.bundle.patch` 使用安装包名引用入口；本地开发 patch 才使用绝对路径。正式 bundle 需要先在 Harness 可解析的包源中安装 `@ft/dsh-fft-research-cockpit`，或直接安装组合层 `@ft/dsh-fft-bundle`。

## 与原项目的迁移边界

原项目的 `base_data`、`llm_content`、`quant_data`、`kline_data`、`kline_indicator_data`、`t0_data` 概念被保留为新插件的内部报告上下文，但实现全部位于本项目。Rust Tera 不作为运行时依赖，HTML 模板也位于本项目自己的 `resources/templates` 目录。

当前实现已经包含：五轮分章节 deep_read LLM 生成、其余 7 类报告逐类型结构化 LLM 合约与字段校验、JSON 上下文降级、8 个完整 HTML 模板、ECharts 图表、FTShare 来源追溯和订阅权限提示。每类报告都会真实调用配置的 LLM；只有 LLM 返回空内容、非法 JSON 或不符合该模板字段合约时，才回退到确定性 FTShare 上下文，并在 `warnings` 中披露原因。由于 FTShare 当前未提供与原项目等价的 T0 回测及 PIT financial_indicator 数据，这些区域会明确显示模块未接入的中性状态，不会伪造。

除统一工具 `cockpit_investment_report` 外，还注册了 8 个专用工具（如 `cockpit_holding_analysis_report`、`cockpit_market_commentary_report`）。持仓分析工具接收结构化 `holdings` 快照；用户可以先上传持仓截图，由 Harness 多模态模型识别为 JSON，经用户确认后再调用该工具。截图适合当前组合快照分析；历史收益曲线、最大回撤和交易归因仍需要交易记录或历史持仓快照。建议上传前遮挡姓名、账号、资产总额等敏感信息。

`reports/300750-2026-09-02-deep-read-data-only.html` 是之前的 FTShare 数据链路测试产物，`llm_content` 明确为 `null`，不是 LLM 报告。使用 Harness 且配置 `DEEPSEEK_API_KEY` 后生成的正式文件名为 `300750-YYYY-MM-DD-deep-read.html`，会使用本项目自己的完整模板。

### 全报告真实 LLM 分析

8 类报告均从 DSH 配置的 LLM 获取分析。模板报告使用完整字段契约：首次生成后仅对未完成字段重试，保留已成功的模型内容；仅允许契约内的分析字段写入报告，行情、持仓数量、财务表和图表仍来自 FTShare 或确定性计算。板块报告的八个章节解读、核心逻辑、主要风险，以及持仓关注点、市场观察清单均有独立字段。

每份结构化结果的 `analysis_meta` 记录生成状态与字段覆盖情况。失败字段显示“本次 AI 分析未生成”，不使用固定文案冒充模型分析；深度研究五轮中失败的章节同样保留明确状态，不影响已完成章节。FTShare 订阅拒绝仍通过升级遮罩展示，普通数据不足由分析说明边界。接入和结构校验不代表模型判断必然正确。

回归测试：`pnpm build && node scripts/test-all-llm-analysis.mjs`（使用明确标识的测试模型，不是实盘数据验收）。

### FFT Better Sidebar 接入

消息预览的“右侧展开”和工具卡的“在右侧打开”使用 `dsh-better-sidebar` 的公开服务：注册 `ft-research-cockpit:report` 标签类型，通过 `openTab(seed, { sessionId })` 打开对应报告。投研插件不创建右侧浮层，也不修改 FFT/DSH 核心。相同报告重复打开会聚焦原标签，标签只保存会话与调用 ID，正文从该会话的工具结果读取，不复制到侧栏的 localStorage。

本插件是 FFT Better Sidebar 的子插件：`dsh-better-sidebar`（服务 API ≥0.18.0）为 peer 依赖。宿主安装并启用 Better Sidebar 时，“右侧展开/在右侧打开”走它注册的 `ft-research-cockpit:report` 标签类型；未安装时侧栏路由按「能力不可用」报错，并退还到 `ctx.inject(['betterSidebar', 'uiConversation'])` 之外的注册路径（工具卡与轮末卡片仍渲染，只是没有侧栏入口）。“独立放大”保留独立弹层。

DSH 0.2.0-rc.2 起，原来的 `conversation.details.tool.preview` 槽与 `ctx.layout.closeDetails()` 已从宿主移除，本插件的右侧详情预览路径随之删除：完整报告改为会话视图标签（`conversation.view`，id `investment-report`，标签名“报告”）承载，工具卡上的“打开报告”在无 `openView` 座位时回落到 Better Sidebar 标签。

联调建议使用装好 Better Sidebar 的宿主，并验证：工具卡“在右侧打开”产生 FFT 报告标签、重复点击不重复建标签、关闭后可重新打开，以及会话视图“报告”标签能切换到对应报告。

侧栏回归：`pnpm build && node scripts/test-fft-sidebar.mjs && node scripts/test-report-host-sidebar.mjs`。其中包含禁止用原生 `openDetails` 替代 FFT 路由的断言。
