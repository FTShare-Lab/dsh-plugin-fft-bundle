# 轻量因子库与相关性

标准名：`factor-lib-lite-v1`。在本地目录维护矩阵 + 目录 + 评价摘要，入库前查重。不做分布式调度，不依赖外部集群。

## 1. 目录布局

```
factor_lib/
  catalog.csv          # 一行一个因子
  matrix/<factor_id>.parquet   # index=stock_code, columns=YYYYMMDD, float32
  eval/<factor_id>.json        # 日频研究评价摘要（无巨型日序列也可）
  combo/<author>_<universe>.parquet   # 可选：作者等权合成
```

`catalog.csv` 列：

`factor_id, name, author, universe, orientation, version, start, end, n_dates, ic1, icir1, open_ls_sharpe, peak_q, q10_q9, status, created_at, path`

`status` ∈ `draft | intake_ok | rejected | duplicate`。

`factor_id` 建议 `{universe}_{author}_{seq:05d}` 或用户指定 slug（只含字母数字和下划线）。

## 2. 入库步骤

1. 解析 CSV → 对齐交易日 → 得到与市场日历同形的矩阵。
2. 用同形状的收益或价格三列，在本地跑 `python scripts/factor_lib.py eval`（或 `ingest --ret/--price`）。没有收益/价格就只存矩阵，不算 IC。
3. 与库内 **同股票池、status=intake_ok** 的矩阵算相关（见下）。
4. 写 parquet + eval json + 追加 catalog。相关过高则 `duplicate`，不覆盖旧条目。
5. 若用户要求「作者合成」：同作者、同股票池的正式因子矩阵先截面 rank 再等权（缺失忽略），存 `combo/`。合成后再评价一次，但 **合成 IC 升高不能单独作为入库理由**。

草稿（有效日 <60 或缺涨跌停）可以进 `draft`，不参与正式相关门槛，除非用户明确要「和草稿比」。

## 3. 相关性（查重主指标）

对每个交易日 t，在两列因子同时有限、有效数 ≥30 的股票上算截面 Spearman（秩相关）。因子库相关 = 这些日度相关的 **均值**。

同时报：

- 相关有效天数；
- Q10 成员 Jaccard：每日两因子 Q10 集合交集/并集，再对日平均；
- Q1 Jaccard（空头重叠）。

经验阈值（同股票池）：

| RankCorr | Q10 Jaccard | 处理 |
|---:|---:|---|
| ≥ 0.95 | ≥ 0.80 | 近复制：不双挂正式库 |
| 0.80–0.95 | ≥ 0.40 | 同族：只保留分层更好的一条作代表，另一条标 `duplicate` 或 `family` |
| 0.30–0.80 | 任意 | 可并存，入库说明重叠 |
| < 0.30 | < 0.15 | 视为不同簇 |

不要用全历史把两个矩阵拉直再算一个 Pearson 当作「因子相关」——那会混进时间趋势。必须 **逐日截面，再对日平均**。

## 4. 附带脚本

仓库内 `scripts/factor_lib.py`（依赖 `numpy` / `pandas` / `pyarrow`）：

```bash
# 只要两张三列面板：因子 + 已对齐的远期收益
python scripts/factor_lib.py eval --csv factor.csv --ret ret.csv --orientation 1

# 或者因子 + 价格（默认 t+1 → t+2）
python scripts/factor_lib.py eval --csv factor.csv --price open.csv --hold-days 1

# 入库（带评价）
python scripts/factor_lib.py ingest --csv factor.csv --lib ./factor_lib \
  --name my_factor --author Alice --universe csi_300 --orientation 1 \
  --ret ret.csv --calendar trading_days.txt

python scripts/factor_lib.py corr --lib ./factor_lib --a csi_300_Alice_00001 --top-k 5
```

`trading_days.txt` 每行一个 `YYYYMMDD`。缺日历时按 CSV 中出现的日期透视，不再做「≤ 最近交易日」映射。全部在本地算，不提交到任何远程评价服务。

行情不进库目录。评价用 `--data-dir` 读本机矩阵，或 `--ftshare` 把缺失股票缓存到 `~/.factor-intake/market_cache/`。`python scripts/factor_lib.py discover` 只扫本机，不下载。

## 5. 轻量实现要点

- 矩阵用 float32 parquet，日期列名 `YYYYMMDD`，股票索引与评价所用代码一致。
- 算相关时两矩阵按日期内连接、股票内连接；不要外连接后填 0。
- 一次只把「候选 + 库内同池正式因子」载入；库很大时按 catalog 的 `ic1/open_ls_sharpe` 先筛再精算。
- 相关矩阵可缓存到 `factor_lib/corr_{universe}.csv`（factor_id 对），候选入库后只更新该行该列。
- 作者合成：`nanmean(cs_rank(F_i))`，不要先把原值加总（量纲不同）。

## 6. 查重输出模板

对每个候选给出 Top-K（默认 5）库内邻居：

`factor_id, name, rank_corr, q10_jaccard, q1_jaccard, n_days, peak_q, open_ls_sharpe, decision`

`decision`：`keep` / `family` / `duplicate`。

## 7. 组合注意

- 等权把同族低波因子加在一起，通常 IC 微升、Q10 变平或倒挂。入库合成前必须看分层，不只看 IC。
- 近复制因子进入作者合成会变相加杠杆，查重未过的不要进 combo。
- 本库是研究库：不执行实盘下单，不假设成交量能吃下全市场十分位。

## 8. 与评价报告的衔接

评价 JSON 至少保存：窗口、股票池、方向、四种中性化的 1 日 RankIC/ICIR/开盘 LS Sharpe、peak_q、q10_q9、VWAP 1 日 LS Sharpe、可交易性摘要、相关 Top-K。不要把完整日收益序列默认为库的必选字段（文件会膨胀）；需要复现时用矩阵重算。
