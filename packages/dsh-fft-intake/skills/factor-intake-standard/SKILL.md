---
name: factor-intake-standard
description: "Evaluate and ingest alpha factors locally from 3-column panels (date, stock, value)—no remote service. Given a factor table plus an optional return or price table of the same shape, compute RankIC/ICIR, Q1–Q10, Q10−Q1, turnover, and optional neutralization; maintain a lightweight factor library with cross-sectional rank correlation and Q10 Jaccard. Use whenever the user says 入库, 回测, 测评, 因子评价, RankIC, 十分位, 相关性, 因子库, 查重, uploads a factor CSV/Parquet, or asks to compare factors. Anyone with two 3-col CSVs can run scripts/factor_lib.py eval. Do not treat simulator book AnnRet as the headline KPI."
---

# 因子入库标准

用户已经有因子表（至少 **日期、股票代码、因子值**）时使用本 Skill。目标不是刷一个最好看的 IC，而是在同一股票池、同一时点、同一收益窗口、同一可交易性规则下，给出可复核的回测与入库证据，并把因子放进轻量库里算相关性。

详细定义：

- [日频研究评价](references/daily-research-eval.md)
- [轻量因子库与相关性](references/factor-library.md)
- [本地行情发现与 FTShare 补洞](references/market-data.md)
- 本地脚本：[scripts/factor_lib.py](scripts/factor_lib.py)（三列面板解析、交易日对齐、RankIC/十分位/换手、parquet 入库、截面 RankCorr / Q10 Jaccard）。**不调用任何远程评价服务。** 行情/涨跌停/指数优先读本机 OpenAlpha `data_dir`；缺字段才用 FTShare MCP 按标的补洞。不把行情数据写进本 Skill 目录。

默认路径是纯本地：用户有因子三列，再给一张同形状的收益（或价格）三列，就能算出研究口径。周频点时 Top-N 对照仍可按 `stock-factor-eval-v1` 做，但那是可选加料，不是本 Skill 的执行依赖。

在 DSH 中执行本 Skill 的脚本时**不要依赖 `PATH` 上的 Python**，用 `uv` 按需加载解释器与依赖。`<skilldir>` 是本 Skill 的目录（`skill` 工具返回的 `resourceBase.path`），用绝对路径调用脚本：

```bash
uv run --quiet --python 3.12 --with-requirements <skilldir>/requirements.txt \
  python <skilldir>/scripts/factor_lib.py eval --csv factor.csv --ret ret.csv
```

FTShare API Key 由脚本自己从 DSH 解析：环境变量 `FTSHARE_API_KEY` → DSH 凭据文档（`$DSH_HOME/.credentials.yaml`，即「设置 → FTShare」写入的位置）。不要在命令里传 key、不要写进报告或仓库。

## When to use

出现以下任一情况时加载本 Skill：

- 用户交出 CSV/Parquet/JSON，列为日期 + 股票 + 因子值，要求回测、评价、出报告；
- 要把因子「入库」、建个人/项目因子库、算相关、查重、看多头重叠；
- 要解释 RankIC、ICIR、十分位、Q10−Q1、换手、开盘/VWAP 执行、行业或市值中性化；
- 要判断因子能不能进库，而不是只看仿真器账面收益；
- 用户说「不要走服务」「本地算」「我只有两张 csv」。

即使用户只说「帮我测一下这个 csv」「和库里重不重复」「这两个因子像不像」，也要加载，不要等到对方说出完整术语。

## 两条评价轨道（都要保留）

| 轨道 | 何时用 | 主 KPI |
|---|---|---|
| **日频研究（默认，本 Skill）** | 已有日频因子矩阵 | t 收盘信号 → **t+1 开盘买、t+2 开盘卖** 的 Q10−Q1；同步给 5 日/20 日与 VWAP |
| **周频点时（v1）** | 要对齐官方指数、周频 Top-N、成本与门禁评级 | 连续周频 open-to-open，Top-N 等权对官方指数超额 |

禁止把仿真器「账面多空 × 252」的 AnnRet 当作报告主数字。报告主数字永远是分层 Q10−Q1（或周频轨道的净超额）。

## 固定流程

1. **声明评价状态**：`recomputed` / `reused_evaluator` / `interpretation_only`。
2. **识别输入**：把用户文件映射到 `date, stock_code, factor_value`。列名别名见下。不要猜缺失列。
3. **冻结方向**：`orientation=+1` 高值预期高收益；`-1` 相反。方向必须事前声明或来自独立校准期，禁止看完全样本 IC 再翻号还称样本外。
4. **识别股票池**：全市场 / 沪深300 / 中证500 / 中证1000。历史成分必须用信号时点或更早快照，禁止用当前成分回填。
5. **对齐交易日**：CSV 日期映射到 **≤ 该日的最近交易日**（无前视），同一股票两次快照之间前向填充，最后一笔之后不虚构到样本末尾。
6. **窗口**：按用户年份截取；若因子是稀疏快照，自动收窄到「有值的首末日 + 足够的 t+21 开盘空间」，并在报告里写明日历窗。
7. **日频研究计算**（默认）：
   - **最小输入**：因子三列 + 收益三列（收益已对齐到信号日，值为该日持有期回报）。命令：`factor_lib.py eval --csv factor.csv --ret ret.csv`。
   - **价格输入**：因子三列 + 价格三列。脚本按 `px[t+1+H]/px[t+1]-1` 构造收益（默认 H=1，即 t+1→t+2）。给的是开盘价就是开盘路径，给 VWAP 就是 VWAP 路径。
   - **本机行情矩阵（优先）**：`--data-dir` / `--auto-market` 读 OpenAlpha 风格 `open/high/low/volume/vwap/limit_*/adjfactor/csi_*`。一次出开盘 1/5/20、VWAP 1/5/20、涨跌停可交易、指数超额。先跑 `factor_lib.py discover`。
   - **FTShare 补洞（可选）**：`--ftshare` 只拉因子里缺字段的股票；缓存 `~/.factor-intake/market_cache/`。全市场必须用 data_dir，不要对五千只逐票打 MCP。
   - **HTML**：`--html` 写单文件离线报告（有 matplotlib 则 PNG，否则 SVG）。
   - 可选：行业、对数市值两张同样三列，才做四种中性化；没有就不做，不报错。
   - 可选：涨跌停/成交量面板才做可交易过滤；没有则在报告写 `has_limit=false`，收益侧缺失仍不当 0。
   - 指标：日度 RankIC、ICIR、t、正 IC 比例；十分位 Q1–Q10 年化、Sharpe、最大回撤、成员单向换手；Q10−Q1。
8. **分层审美（入库时优先于刷 IC）**：看 Q8/Q9/Q10 是否单调、峰值是否在 Q10、Q10−Q9 是否为正。IC 高但 Q10 倒挂的因子标 `分层失败`，不得只因 |IC| 进库。
9. **周频轨道（若用户要指数超额/门禁评级）**：按 `stock-factor-eval-v1` 跑，输出 `unrated/reject/watch/promising/strong`。
10. **入库**：通过最低门禁后写入轻量库（矩阵 + 目录行 + 评价 JSON）。入库前算与库内因子的截面 RankCorr 与 Q10 Jaccard；近复制（RankCorr≥0.95 或 Q10 Jaccard≥0.80 且经济含义同类）只保留一条或标重复。
11. **输出报告**：窗口、方向、覆盖、RankIC/ICIR、Q8/Q9/Q10、峰值分位、换手、入库决定。用户没给行业/市值/涨跌停时，注明未中性化、未做涨跌停过滤；不要假装跑过带图的服务端全套报告。

## 输入约定

### 列名

| 标准列 | 接受的别名（大小写不敏感） |
|---|---|
| `date` | `date`, `signal_date`, `trade_dt` |
| `stock_code` | `stock_code`, `stock`, `code`, `s_info_windcode` |
| `factor_value` | `factor_value`, `factor`, `value`, `score`, `adjusted_rank_score` |

日期写成 `YYYY-MM-DD` 或 `YYYYMMDD`。股票代码 `000001.SZ` / `600000.SH`（或 Wind 六位+.SZ/.SH）。内部可把 `.SZ`→深交所、`.SH`→上交所，但报告对外仍用用户代码。

### 元数据（能提供就冻结，缺则显式标注 unknown）

`factor_name`, `factor_version`, `author`, `universe`, `orientation`, `startyear`, `endyear`。

### 股票池与默认对照指数

| 股票池 | 指数 | 周频默认 Top-N |
|---|---|---:|
| 沪深300 | `000300.SH` | 100 |
| 中证500 | `000905.SH` | 150 |
| 中证1000 | `000852.SH` | 300 |
| 全市场 | 默认对照中证1000 | 视覆盖而定 |

## 强制禁止

- 不用当前成分股回填历史池。
- 不把仿真账面 AnnRet 当主 KPI。
- 不把 close-to-close、open-to-open、VWAP 结果混在一张排名表里当同一口径。
- 不在全样本上选方向/参数还称样本外。
- 不把缺失因子填 0，不把缺价/不可交易当成 0 收益。
- 不只报毛收益、不报换手与可成交过滤。
- 不把 `p<0.05` 写成可上线，也不把 `p≥0.05` 写成因子无效。
- 入库时不靠堆相关因子刷 IC；相关≥0.9 的同族只留分层最好的一条。
- 正文、路径、注释、报告只用中性称呼（本地评价、因子库、交易日对齐）。不要写内部平台名、集群调度名、分布式存储名、产品代号或未公开的优化算法标签。评价默认在用户机器上跑脚本，不把任务提交到任何远程服务。

## 最低入库门禁（日频研究轨道）

同时满足才标 `intake_ok`（仍可能只是 `watch`）：

1. 方向已冻结，评价窗内未再翻转。
2. 有效交易日 ≥ 60（不足则 `unrated`，可入库为草稿不可当正式因子）。
3. 若用户提供了涨跌停/成交量，必须做可交易过滤；若没有，报告写明未过滤，不得假装已过滤。
4. 不中性化下 1 日 RankIC 与开盘 Q10−Q1 Sharpe 符号一致。
5. 分层：峰值在 Q8–Q10；若峰值≤Q7 或 Q10 明显低于 Q8，标 `分层失败`，默认不进正式库。
6. 与库内已有正式因子的截面 RankCorr 若 ≥ 0.95，视为重复，除非用户书面要求并存。

## 固定输出结构

0. **因子总结（开头必出，结尾再复述一次）**：入库决定一句话 + 开盘 1 日 RankIC / Q10−Q1 Sharpe / peak_q / Q10−Q9；分层是否成立；IC 与多空是否同号；VWAP 对照；可交易与缺字段；库内最近邻。正文表格之前先让人读完这段，数字细节放后面。HTML 用 `<section class="summary">`，终端用同样的 bullets。
0b. **报告文件（每次会话必出）**：报告写在会话工作区的 `reports/` 下，DSH 的 Files 面板能直接渲染 HTML。脚本 stderr / JSON 的 `open_html`、`open_md` 就是报告的**绝对路径**：原样贴给用户，别改写成 `file://`、`http://` 或别加端口——聊天窗口点不开那些，也不要起本地 HTTP 服务。多因子就每个因子一行。
1. 评价状态、窗口、股票池、方向、覆盖率、排除原因。
2. 时点与可交易性（开盘 / VWAP 各持有期的可买可卖比例）。
3. RankIC、ICIR、t、Q10−Q1 Sharpe/年化/回撤/换手；有行业/市值才出四种中性化。
4. 十分位表（至少 Q8/Q9/Q10 与峰值分位）。
5. VWAP 执行对照。
6. 若跑了周频轨道：官方指数超额、成本、门禁等级。
7. 库内相关性：Top 相似因子、RankCorr、Q10 Jaccard、是否重复。
8. 入库决定：`draft` / `reject` / `intake_ok` 及理由。
9. 局限：样本外、涨跌停字段是否齐全、成本是否计入、多重检验。
10. **结论（文末再出同一份总结）**：不要改数字、不要另写一套叙事；开头总结与文末结论必须同源。

## 与周频 Skill 的分工

- 「两张 csv 本地算、入库、查重」→ 只跑本 Skill 的脚本，不访问网络。
- 「周频点时、指数超额、strong/promising」→ 仅当用户另有官方指数与周频实现时，才同时加载 `stock-factor-evaluation`。
- 两套数字必须分表，不得平均、不得选好看的那张当唯一结论。

## Examples

（下文 `uv … factor_lib.py` 是上面那条 uv 前缀 + `<skilldir>/scripts/factor_lib.py` 的简写。）

**例 A：两张三列 CSV，本地算完。**  
`factor.csv` 为 `date,code,factor`，`ret.csv` 为 `date,code,value`（已是信号日对应的远期收益）。  
`uv … factor_lib.py eval --csv factor.csv --ret ret.csv --orientation 1`  
未声明方向则标 `unrated` 并询问，不擅自按全样本 IC 翻号。没有 ret/price 时只入库矩阵、不算 IC。

**例 D：本机 data_dir + HTML。**  
`uv … factor_lib.py discover`  
`uv … factor_lib.py eval --csv factor.csv --orientation 1 --data-dir "$OPENALPHA_DATA_DIR" --html`  
跑完后 stderr 有 `open_html=/…/reports/因子评价报告-….html`。回复里原样给出该绝对路径，说明用户在 DSH 的 Files 面板打开。

**例 E：小面板、本机无行情，FTShare 补洞。**  
`uv … factor_lib.py ftshare-probe`  
`uv … factor_lib.py eval --csv factor.csv --orientation 1 --ftshare --html`  
只拉 CSV 里出现的股票。缓存不进仓库。

**例 B：入库并查重。**  
评价通过后写入 `factor_lib/`。与同池正式因子算逐日截面 RankCorr 与 Q10 Jaccard。RankCorr 0.99 且 Jaccard 0.90 → `duplicate`，不双挂。

**例 C：IC 高、Q10 倒挂。**  
1 日 RankIC 0.07 但 Q8>Q9>Q10 → `分层失败`，默认 `reject`。建议折尾或多头规则，而不是再堆同族因子刷 IC。
