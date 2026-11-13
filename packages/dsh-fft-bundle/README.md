# @dsh-ft/dsh-fft-finance-toolkit

FT 金融工作台：把 DeepSeek Harness 组装成一套做金融研究与盯盘的工作环境。
一次安装得到金融模式预设、FTShare 数据面、K 线与 A 股 / 商品期货模拟盘。

## 安装

在 DeepSeek Harness 的「设置 → 插件管理 → 添加插件」里输入包名：

```sh
dsh plugin --profile web add @dsh-ft/dsh-fft-finance-toolkit
```

装完重启应用。不需要 ssh，也不需要改 profile 的 pnpm 配置：产物是预构建的，
依赖的 K 线随包携带。

## 装了什么

| 组成 | 作用 |
| --- | --- |
| 金融模式（`ft-finance`）预设 | 新建会话时的默认工作方式：行情指标与 FTShare 数据面 |
| `@dsh-ft/dsh-fft-settings` | 设置页与 API Key 凭据 |
| `@dsh-ft/dsh-fft-ftshare` | FTShare 数据面工具 |
| `@ftshare-lab/dsh-kline` | K 线图表与 MCP 工具（随包携带） |
| `@dsh-ft/dsh-fft-paper-trading` | 模拟盘：本地账本、下单、持仓与复盘 |
| `@dsh-ft/dsh-fft-plot` | 把取数结果画成内联图表 |

数据默认按 FTShare 免费额度工作：匿名每日限额有限，没配 API Key 也能用日线收盘价练习。

## 许可

MIT。
