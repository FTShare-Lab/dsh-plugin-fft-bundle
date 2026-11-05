# Changelog

本文件记录 `@ft/dsh-fft-bundle` 及其绑定组件的对外变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[SemVer](https://semver.org/lang/zh-CN/)。

## [0.9.1] - 2026-11-05

### Added

- 新增 `ftshare_status`，可查最近失败聚合与目录漂移

### Changed

- FTShare 失败提示改显上游原文，不再翻译或猜测原因
- 设置与 FTShare 底座改由独立仓库发版，本仓按 npm 精确版本带入
- K 线升级到 `v0.6.4-ft.1`，图表可挂进宿主面板

### Fixed

- 空结果必须有证据，形状不符不再显示成「没有数据」
- 设置页检测不再把可用的 Key 误报为请求受限

### Components

- `@dsh-ft/dsh-fft-settings`：`v0.5.0` → `v0.5.1`
- `@dsh-ft/dsh-fft-ftshare`：`v0.3.0` → `v0.4.0`
- `@dsh-ft/dsh-fft-paper-trading`：`v0.6.0` → `v0.6.1`
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
