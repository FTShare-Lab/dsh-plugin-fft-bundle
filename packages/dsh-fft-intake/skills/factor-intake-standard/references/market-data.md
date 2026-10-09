# 本地行情发现与 FTShare 补洞

本 Skill **不内置、不上传、不提交** 任何日线/涨跌停/指数数据。评价时按这个顺序找市场矩阵：

1. `--data-dir` 或环境变量 `OPENALPHA_DATA_DIR` / `OA_DATA_DIR` / `FACTOR_MARKET_DIR` / `MARKET_DATA_DIR`
2. `--auto-market`：在本机常见路径扫 OpenAlpha 风格 `data_dir`
3. `--ftshare`：只对因子面板里**缺字段的股票**走 FTShare MCP，缓存写到用户目录

全市场日频矩阵仍以本机 `data_dir` 为准。FTShare 是按标的补洞，不是全市场下载器。

## 1. 本机 data_dir 约定（OpenAlpha / 8164）

目录内每个字段一个 parquet（或 `.parquet` / `.csv`），矩阵 **行=股票、列=YYYYMMDD**。若文件是 行=日期，脚本会自动转置。

| 字段 | 必需？ | 用途 |
|---|---|---|
| `open` | 开盘路径必需 | 未复权开盘；乘 `adjfactor` 后算 t+1→t+2/6/21 |
| `high` / `low` | VWAP 一字板 | 未复权 |
| `close` | 建议有 | 对齐、覆盖 |
| `volume` | 停牌过滤 | ≤0 或缺失 = 停牌 |
| `vwap` 或 `amount`+`volume` | VWAP 路径 | `vwap=amount/volume` |
| `adjfactor` 或 `ex_factor` | 建议有 | 无则用未复权价并在报告写 `no_adjfactor` |
| `limit_up` / `limit_down` | 可交易过滤 | 无则 `has_limit=false`，只做停牌过滤 |
| `industry` / `log_size` | 中性化 | 没有就不做四种中性化 |
| `csi_300/500/1000_open` 或 `_close` | 指数超额 | 优先开盘；只有收盘则报告写 `benchmark_kind=close` |
| `csi_*_weight` | 点时成分 | `universe=csi_300_uni` 等才用 |
| `datestr` | 交易日 | 没有就用 open 的列 |

默认搜索路径（存在才读）：

```
$OPENALPHA_DATA_DIR
$OA_DATA_DIR
./data  ./market  ./openalpha-data
~/openalpha-data
~/Documents/openalpha-data
~/Documents/openalpha/data
/home/nolan/openalpha-data/rq/D1/<enddate>
```

```bash
python scripts/factor_lib.py discover
python scripts/factor_lib.py discover --path /path/to/data_dir
```

**不要**把行情 parquet 拷进 `skills/factor-intake-standard/`。

## 2. FTShare 作为补充接口

公网 MCP：`https://market.ft.tech/gateway/mcp`（可用 `FTSHARE_MCP_URL` 覆盖）。

用到的工具（现行 `ft_v1_*` 名）：

| 用途 | 工具 | 注意 |
|---|---|---|
| 未复权日 OHLC + 成交额 | `ft_v1_stock_candlesticks` | `interval_unit=day`，`adjust_kind=none`，毫秒时间窗 |
| 涨跌停 | `ft_v1_stk_limit` | `start_date`/`end_date` 为 **int YYYYMMDD** |
| 累计复权因子 | `ft_v1_stock_adjust_factor` | 用 `ex_adj_factor` |
| 指数开盘 | `ft_v1_index_candlesticks` | `000300.SH` / `000905.SH` / `000852.SH` |

日期参数类型随工具而变：K 线用毫秒，涨跌停用整数日期。实现见 `scripts/ftshare_client.py`。

```bash
python scripts/factor_lib.py ftshare-probe
```

缓存（用户本机，不进 git）：

```
~/.factor-intake/market_cache/
  symbols/ohlc/<code>.csv
  symbols/limit/<code>.csv
  symbols/adj/<code>.csv
  matrix/*.parquet          # 合并后的矩阵，下次可当 --data-dir
```

`--ftshare-max-stocks` 默认 400。因子覆盖全市场时必须给 `--data-dir`，禁止用 FTShare 扫五千只。

## 3. 评价时怎么用

```bash
# 已有本机 data_dir
python scripts/factor_lib.py eval --csv factor.csv --orientation 1 \
  --data-dir "$OPENALPHA_DATA_DIR" --html

# 本机没有矩阵：只对因子里的股票补洞（小面板）
python scripts/factor_lib.py eval --csv factor.csv --orientation 1 \
  --ftshare --html

# 先搜本机，缺字段再 FTShare
python scripts/factor_lib.py eval --csv factor.csv --orientation 1 \
  --auto-market --ftshare --html
```

报告里会写：市场源、缺失字段、`has_limit`、指数用开盘还是收盘。缺涨跌停不得假装已过滤。
