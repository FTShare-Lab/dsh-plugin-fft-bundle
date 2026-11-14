# Changelog

本文件记录 `@ft/dsh-fft-bundle` 及其绑定组件的对外变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[SemVer](https://semver.org/lang/zh-CN/)。

## [1.0.3] - 2026-11-14

组合包不再只是组合：新增「金融工作台」自检卡，在「金融终端」设置页直接显示依赖包版本与挂载点状态。

### Added

- 组合包自身成为一行插件：宿主半提供 `GET /api/ft-workbench` 只读状态——各 registry 依赖的已装版本与声明下界、根 Loader 全局行的挂载状态、金融模式预设的注册表诊断；浏览器半在「金融终端」页贡献一张卡（依赖包 / 挂载点两列 + 复制诊断），order 15，位于数据源状态之后、运行日志之前。
- 卡内标题取各依赖自己发布的 locale 元数据（如「FT 设置」「FTShare 数据」「模拟交易」）；绘图包在 0.1.1 之前回落同名文案「FT 绘图」。
- 浏览器半与依赖表随 `lib/` 发布；依赖表在构建期从 `package.json` 生成（`link:` 检出无法解析自身包名）。

### Note

- 只读：不联网、不读取密钥、不写配置；数据源状态仍由 API Key 卡负责，账本状态仍在模拟盘面板。

## [1.0.2] - 2026-11-13

依赖声明改成下界，组件可以独立发版；模拟盘换成不内联 K 线的新版，安装体积随之变小。

### Changed

- 五个已发布组件（settings / ftshare / plot / paper-trading / kline）由精确版本改为**下界** `>=`：
  组件发新版本后不再需要 bundle 跟版才能被装上
- 模拟盘跟到 `0.7.2`：它的产物不再内联 K 线，安装时由 registry 解析（单独安装从约 1 MB 降到约 0.4 MB）

## [1.0.1] - 2026-11-13

K 线改由上游 `0.6.11` 提供，FT 定制构建退场；本次只更新装配与依赖，用户可感知的界面与功能不变。

### Changed

- `DSH Kline` 由 FT 定制的 `v0.6.10-ft.1` 改为上游 `0.6.11`：浮动 K、首启弹窗与模拟盘 K 线槽位改由上游的可选宿主契约实现，不再需要 fork 构建
- 模拟盘面板的 K 线通过上游宿主契约填充；kline 改为从 registry 安装的 `0.6.11`，不再内联进产物

## [1.0.0] - 2026-11-13

金融工作台第一次以公共包的形式发布：一个 npm 包把整座工作台装起来，不再依赖私有插件，也不需要 ssh。

### Added

- 公开分发：`@dsh-ft/finance-all-in-one` 可作为普通 npm 包一键安装，K 线随包携带
- 金融模式新增出图技能：取数结果可以渲染成内联 SVG，图随回答一起显示
- 新增 `@dsh-ft/dsh-fft-plot` 组件

### Changed

- 装配方式改为「同一个包、两份清单」：公共产物只声明公共行，内部专用行由另一份清单承载，公共产物里一行都不含
- 公共产物把 kline 内联进包并裁掉截图与构建输入，产物 556 KB
- FTShare 数据面升级到 `0.4.2`（随包目录刷新），设置页升级到 `0.7.0`
- 模拟盘升级到 `0.7.0`
- 公开仓库迁到 `FTShare-Lab/dsh-plugin-fft-bundle`

### Removed

- 移除投研舱与因子入库技能

## [0.9.3] - 2026-11-06

### Changed

- K 线升级到 `v0.6.7-ft.1`，首次安装时依赖准备不再占用宿主重连次数
- 无 Key 时可查看港股与美股日 K，行情来源在图表中标注
- 模拟盘内联的 K 线同步升级，发布清单里的 K 线依赖改为下界声明

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`v0.6.2` → `v0.6.3`
- `DSH Kline`：`v0.6.4-ft.1` → `v0.6.7-ft.1`

## [0.9.2] - 2026-11-06

### Fixed

- 修复 DSH 0.2.2 下金融模式加载失败、新会话回退标准模式的问题

### Changed

- 兼容 DSH 0.2.1 与 0.2.2

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`v0.6.1` → `v0.6.2`

## [0.9.1] - 2026-11-05

### Added

- 新增 `ftshare_status`，可查最近失败聚合与目录漂移
- 股票模拟账户初始资金改为 100 万元，重置时可自行指定初始资金

### Changed

- FTShare 失败提示改显上游原文，不再翻译或猜测原因
- 设置与 FTShare 底座改由独立仓库发版，本仓按 npm 精确版本带入
- K 线升级到 `v0.6.4-ft.1`，图表可挂进宿主面板
- 盘后、午休与集合竞价时段的市价单照常受理，排队到下一交易时段开盘成交

### Fixed

- 空结果必须有证据，形状不符不再显示成「没有数据」
- 设置页检测不再把可用的 Key 误报为请求受限

### Components

- `@dsh-ft/dsh-fft-settings`：`v0.5.0` → `v0.5.1`
- `@dsh-ft/dsh-fft-ftshare`：`v0.3.0` → `v0.4.0`
- `@dsh-ft/dsh-fft-paper-trading`：`v0.6.0` → `v0.6.2`
- `DSH Kline`：`v0.4.0-ft.2` → `v0.6.4-ft.1`

## [0.9.0] - 2026-10-28

### Added

- 设置与 FTShare 底座可从 npm 单独安装

### Changed

- 共享插件包名迁移到 `@dsh-ft` 命名空间
- 设置页改名为「金融终端」，访问凭据卡标注当前的 FTShare 数据源
- 插件页显示中文名称与一句话简介
- 模拟盘在插件管理里显示「模拟交易」名称与图标
- 模拟盘 Agent 工具改用 `paper_stock_*` / `paper_futures_*` 命名
- 模拟盘新增账本快照与恢复，旧账本不再要求重置
- K 线改挂宿主右侧栏，浮动入口与首次引导不再出现
- 宿主下限提高到 DSH 0.2.1-alpha.1（不再支持 0.2.0）

### Fixed

- 行情额度用尽不再被误判成「套餐未开通」
- 上游真停机不再显示成「额度用尽」

### Components

- `@dsh-ft/dsh-fft-settings`：`v0.4.5` → `v0.5.0`，改为可从 npm 单独安装
- `@dsh-ft/dsh-fft-ftshare`：`v0.2.0` → `v0.3.0`，改为可从 npm 单独安装
- `@dsh-ft/dsh-fft-paper-trading`：`v0.3.2` → `v0.6.0`，工具改用 `paper_*` 命名，新增账本快照与恢复
- `DSH Kline`：`v0.4.0-ft.1` → `v0.4.0-ft.2`

## [0.8.0] - 2026-10-23

### Added

- 安装 bundle 即带股票与期货模拟盘

### Changed

- 交易橙进共享品牌层，行情/交易界面可复用
- 设置页的卡片圆角与控件尺寸改为与宿主一致
- 投研舱报告卡改用宿主圆角与悬停描边
- 检查需求表时按固定四条补齐台账

### Components

- `@ft/dsh-fft-paper-trading`：新增 `v0.3.2`，含股票与期货模拟盘、注资/提款面板
- `@ft/dsh-fft-settings`：`v0.4.4` → `v0.4.5`
- `@ft/dsh-fft-research-cockpit`：`v0.2.4` → `v0.2.5`
- `DSH Kline`：`v0.4.0` → `v0.4.0-ft.1`，模拟盘内嵌完整 K 线，K 线可作为画布面板

## [0.7.2] - 2026-10-20

### Changed

- 同一份插件可同时在 DSH 0.2.0 与 0.2.1 上使用

## [0.7.1] - 2026-10-20

### Fixed

- 修复 DSH 0.2.1 下金融模式会话一开口就失败的问题

## [0.7.0] - 2026-10-19

### Added

- 新增 FTShare 数据底座，子插件可共享

### Changed

- 面板可经 /api/ftshare-data 与宿主同名地取数，四态与升级入口原样过桥
- 金融模式下 kline 的 FTShare 工具不再下发给模型，改用 ftshare_* 取数
- 投研舱取数改走 FTShare 底座，报告的「无权限」与「没有数据」不再混同
- 投研舱不再请求上游不存在的风险暴露（Beta）接口

### Components

- `@ft/dsh-fft-ftshare`：`v0.1.0` → `v0.2.0`
- `@ft/dsh-fft-research-cockpit`：`v0.2.3` → `v0.2.4`
- `DSH Kline`：`v0.3.5` → `v0.4.0`，新增 22 个绘图与图表上下文工具，可用自然语言画水平线、趋势线/通道和矩形框

## [0.6.2] - 2026-10-15

### Changed

- 非凸设置卡片跟随 DSH 的黑夜/白天主题

### Fixed

- 修复部分安装方式下 K 线工具无法启动的问题

### Components

- `@ft/dsh-fft-settings`：`v0.4.3` → `v0.4.4`

## [0.6.1] - 2026-10-15

### Added

- 新增 tarball 安装方式，下载发布文件后在插件管理器贴路径即可

### Components

- `@ft/dsh-fft-settings`：`v0.4.2` → `v0.4.3`，默认预设的说明与产物一致
- `@ft/dsh-fft-research-cockpit`：`v0.2.2` → `v0.2.3`，包文档改为自述本包内容

## [0.6.0] - 2026-10-14

### Added

- 新增 FTShare 公用底座，金融模式下多出十个体检/研报/公告类直连接口

### Changed

- 金融模式下标的情报、市场脉搏与板块详情直接给出明细，不再只报条数
- 接口无权访问时说清是「当前套餐没开通」，不再显示成「没有数据」

### Components

- `@ft/dsh-fft-ftshare`：新增 `v0.1.0`

## [0.5.5] - 2026-10-14

### Added

- 新增「金融模式」：独享 FT 提示词、行情与投研工具、因子技能，并成为默认模式
- 「金融模式」的预设说明附带示例问题，便于上手
- 新增飞书需求表操作 skill

### Changed

- 安装后默认模式自动切到「金融模式」一次
- 模型未配凭据时，报告直接提示去模型设置页配置或换模型

### Fixed

- 金融模式下报告卡片、「报告」视图与侧栏恢复加载
- 单独安装投研舱时工具栏与浏览器半同时可用
- 报告改用模型设置页选定的模型，不再跑在插件默认模型上

### Removed

- 插件配置里去掉两个已失效的字段（outputDir、saveToWorkspace）

### Components

- `@ft/dsh-fft-research-cockpit`：`v0.2.1` → `v0.2.2`
- `@ft/dsh-fft-settings`：`v0.4.1` → `v0.4.2`
- `DSH Kline`：`v0.3.5` → `v0.3.5-ft.1`，K 线取数改用 FTShare 设置页的 Key，换 Key 不用重启

## [0.5.3] - 2026-10-13

### Changed

- 会话默认带上非凸金融助手的身份、能力入口清单与数据纪律
- FTShare 凭据未配置时，回复会说明行情可能来自免费兜底数据源
- 投研报告工具统一改为 cockpit_ 前缀命名
- 运行日志卡片的说明文字精简，来源与记录为空时显示「暂无」

### Fixed

- 设置卡片读取失败时说明真实原因（含需重启 DSH），字段显示「读取失败」不再一直「读取中」

### Components

- `@ft/dsh-fft-settings`：`v0.4.0` → `v0.4.1`
- `@ft/dsh-fft-research-cockpit`：`v0.2.0` → `v0.2.1`

## [0.5.2] - 2026-10-13

### Changed

- 关闭 peer 自动安装后，首次安装解析的依赖从 542 个降至 155 个

### Fixed

- 各 FT 子插件与组合包安装时来自同一提交，不再落后于组合包

## [0.5.1] - 2026-10-13

### Added

- 设置页新增「运行日志」卡片，可预览并导出 FT 插件运行日志
- 运行日志卡片支持导出诊断包（.zip），含完整日志与来源文件
- 设置页可显示其他 FT 插件自行添加的设置卡片

### Changed

- 运行日志覆盖 FT 投研舱的接口调用失败与降级记录
- API Key 探测与保存失败会写入运行日志，便于排查

### Components

- `@ft/dsh-fft-settings`：`v0.2.0` → `v0.4.0`，新增第三方设置卡片接缝与运行日志采集、导出

## [0.5.0] - 2026-10-12

### Added

- 组合包 `@ft/dsh-fft-bundle` 首次发布：一条安装命令部署全套 FT 插件
- 适配 Deepseek Harness 0.2.0 桌面版
- 适配 `dsh-fft-research-cockpit`：提供 8 类投研报告与组合推荐，可在会话内打开阅读视图
- 适配 `dsh-fft-factor-intake-standard`: 本地策略分析功能
- 适配 `FTShare-lab/dsh_kline`: 侧边栏显示 k 线
- 适配 `dsh-fft-settings` 设置页：集中管理接口凭据

### Components

- `@ft/dsh-fft-bundle`：`v0.5.0`
- `@ft/dsh-fft-settings`：`v0.2.0`
- `@ft/dsh-fft-research-cockpit`：`v0.2.0`
- `@ft/dsh-fft-factor-intake-standard`：`v0.1.0`
- `DSH Kline`：`v0.3.5`，随组合包安装 K 线工作台、侧边栏与 MCP 服务

[1.0.1]: https://github.com/FTShare-Lab/dsh-plugin-fft-bundle/compare/v1.0.0...v1.0.1
[0.9.3]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.5.4...v0.5.5
[0.5.3]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/gigaflw/dsh-fft-bundle/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/gigaflw/dsh-fft-bundle/tree/v0.5.0
