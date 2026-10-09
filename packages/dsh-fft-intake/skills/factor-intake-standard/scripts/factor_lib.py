#!/usr/bin/env python3
"""Lightweight local factor library: CSV ingest, rank-corr, Q10 Jaccard.

Pure-local library + evaluation. Anyone with 3-column panels can compute
RankIC / deciles / turnover / rank-corr without a remote service.

Needs only:
  - factor CSV: date, stock, value
  - optional return CSV (same shape) OR price CSV (to build t+1 -> t+1+H returns)
  - optional trading-day list (one YYYYMMDD per line)
  - a local factor_lib/ directory
  - optional OpenAlpha-style data_dir (open/high/low/volume/vwap/limit/adj/index)
  - optional FTShare MCP fill for missing names (never vendors market data)
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from typing import Iterable

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import numpy as np
import pandas as pd

DATE_ALIASES = ("date", "signal_date", "trade_dt")
STOCK_ALIASES = ("stock_code", "stock", "code", "s_info_windcode")
VALUE_ALIASES = ("factor_value", "factor", "value", "score", "adjusted_rank_score")

_SLUG_RE = re.compile(r"[^a-zA-Z0-9_]+")


def _norm_date(raw: str) -> str | None:
    s = str(raw or "").strip().replace("-", "").replace("/", "")[:8]
    if len(s) == 8 and s.isdigit():
        return s
    return None


def _pick_col(fields: dict[str, str], aliases: Iterable[str]) -> str | None:
    for a in aliases:
        if a in fields:
            return fields[a]
    return None


def parse_factor_csv(text: str) -> pd.DataFrame:
    """Return columns date (YYYYMMDD int), stock_code, factor_value."""
    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        raise ValueError("csv has no header")
    fields = {(c or "").strip().lower(): c for c in reader.fieldnames}
    dcol = _pick_col(fields, DATE_ALIASES)
    scol = _pick_col(fields, STOCK_ALIASES)
    vcol = _pick_col(fields, VALUE_ALIASES)
    if not (dcol and scol and vcol):
        raise ValueError(
            "columns must map to date, stock_code, factor_value; "
            f"got {list(reader.fieldnames)}"
        )
    rows: list[tuple[int, str, float]] = []
    for rec in reader:
        ds = _norm_date(rec.get(dcol) or "")
        if ds is None:
            continue
        try:
            val = float(rec.get(vcol))
        except (TypeError, ValueError):
            continue
        code = str(rec.get(scol) or "").strip().upper()
        if not code:
            continue
        rows.append((int(ds), code, val))
    if not rows:
        raise ValueError("no valid factor rows")
    return pd.DataFrame(rows, columns=["date", "stock_code", "factor_value"])


def load_calendar(path: Path | None) -> np.ndarray | None:
    if path is None or not path.exists():
        return None
    days = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        ds = _norm_date(ln.split(",")[0])
        if ds:
            days.append(int(ds))
    if not days:
        return None
    return np.unique(np.array(days, dtype=np.int64))


def align_to_calendar(long_df: pd.DataFrame, calendar: np.ndarray | None) -> pd.DataFrame:
    """Pivot to stock x date. Map each snapshot to last trading day <= date; ffill between snapshots only."""
    if calendar is None or calendar.size == 0:
        wide = long_df.pivot_table(
            index="stock_code", columns="date", values="factor_value", aggfunc="last"
        )
        return wide.sort_index().sort_index(axis=1)

    cal = np.asarray(calendar, dtype=np.int64)
    cal.sort()
    snaps = sorted(int(x) for x in long_df["date"].unique())
    mapped: dict[int, int] = {}
    for snap in snaps:
        idx = int(np.searchsorted(cal, snap, side="right") - 1)
        if idx < 0:
            continue
        mapped[snap] = int(cal[idx])
    if not mapped:
        raise ValueError("no CSV dates fall on or after first trading day")

    by_d: dict[int, dict[str, float]] = {}
    for rec in long_df.itertuples(index=False):
        col = mapped.get(int(rec.date))
        if col is None:
            continue
        by_d.setdefault(col, {})[str(rec.stock_code)] = float(rec.factor_value)

    stocks = sorted({s for m in by_d.values() for s in m})
    keys = sorted(by_d)
    col_pos = {int(d): i for i, d in enumerate(cal.tolist())}
    out = np.full((len(stocks), len(cal)), np.nan, dtype=np.float32)
    stock_ix = {s: i for i, s in enumerate(stocks)}
    key_idx = [col_pos[k] for k in keys]
    for k, idx in enumerate(key_idx):
        nxt = key_idx[k + 1] if k + 1 < len(key_idx) else idx + 1
        snap = keys[k]
        for code, val in by_d[snap].items():
            out[stock_ix[code], idx:nxt] = val
    return pd.DataFrame(out, index=stocks, columns=cal)


def cs_rank(mat: np.ndarray) -> np.ndarray:
    out = np.full_like(mat, np.nan, dtype=np.float64)
    for t in range(mat.shape[1]):
        x = mat[:, t]
        m = np.isfinite(x)
        k = int(m.sum())
        if k < 3:
            continue
        order = x[m].argsort()
        ranks = np.empty(k, dtype=np.float64)
        ranks[order] = np.linspace(0.0, 1.0, k, endpoint=False)
        col = out[:, t]
        col[m] = ranks
        out[:, t] = col
    return out


def q10_set(rank_col: np.ndarray) -> set[int]:
    m = np.isfinite(rank_col)
    if m.sum() < 10:
        return set()
    q = np.minimum((rank_col[m] * 10).astype(int), 9)
    idx = np.flatnonzero(m)
    return set(idx[q == 9].tolist())


def pairwise_stats(a: pd.DataFrame, b: pd.DataFrame, min_names: int = 30) -> dict:
    """Daily cross-section Spearman (via rank corr) and Q10 Jaccard, then average over days."""
    cols = a.columns.intersection(b.columns)
    rows = a.index.intersection(b.index)
    if len(cols) == 0 or len(rows) < min_names:
        return {"rank_corr": None, "q10_jaccard": None, "q1_jaccard": None, "n_days": 0}
    xa = a.loc[rows, cols].to_numpy(dtype=np.float64)
    xb = b.loc[rows, cols].to_numpy(dtype=np.float64)
    ra, rb = cs_rank(xa), cs_rank(xb)
    corrs, j10, j1 = [], [], []
    for t in range(ra.shape[1]):
        m = np.isfinite(ra[:, t]) & np.isfinite(rb[:, t])
        if int(m.sum()) < min_names:
            continue
        x, y = ra[m, t], rb[m, t]
        if x.std() < 1e-12 or y.std() < 1e-12:
            continue
        corrs.append(float(np.corrcoef(x, y)[0, 1]))
        sa, sb = q10_set(ra[:, t]), q10_set(rb[:, t])
        if sa or sb:
            j10.append(len(sa & sb) / max(len(sa | sb), 1))
        # Q1 = rank in [0, 0.1)
        def q1(col):
            mm = np.isfinite(col)
            if mm.sum() < 10:
                return set()
            q = np.minimum((col[mm] * 10).astype(int), 9)
            return set(np.flatnonzero(mm)[q == 0].tolist())
        qa, qb = q1(ra[:, t]), q1(rb[:, t])
        if qa or qb:
            j1.append(len(qa & qb) / max(len(qa | qb), 1))
    n = len(corrs)
    return {
        "rank_corr": float(np.mean(corrs)) if n else None,
        "q10_jaccard": float(np.mean(j10)) if j10 else None,
        "q1_jaccard": float(np.mean(j1)) if j1 else None,
        "n_days": n,
    }


def fwd_from_price(price: pd.DataFrame, entry: int, exit_: int) -> pd.DataFrame:
    """r[t] = px[t+exit] / px[t+entry] - 1 on the column axis (sorted dates)."""
    px = price.copy()
    px.columns = [int(c) for c in px.columns]
    cols = sorted(px.columns)
    arr = px[cols].to_numpy(dtype=np.float64)
    r = np.full_like(arr, np.nan)
    n = arr.shape[1]
    if exit_ <= entry or exit_ >= n:
        return pd.DataFrame(r, index=px.index, columns=cols)
    width = n - exit_
    den = arr[:, entry : entry + width]
    num = arr[:, exit_ : exit_ + width]
    with np.errstate(divide="ignore", invalid="ignore"):
        r[:, :width] = num / np.where(np.abs(den) > 1e-12, den, np.nan) - 1.0
    return pd.DataFrame(r, index=px.index, columns=cols)


def _rank_ic_np(f: np.ndarray, r: np.ndarray, min_names: int = 30) -> dict:
    ics = []
    for t in range(f.shape[1]):
        m = np.isfinite(f[:, t]) & np.isfinite(r[:, t])
        if int(m.sum()) < min_names:
            continue
        x, y = f[m, t], r[m, t]
        rx = x.argsort().argsort().astype(float)
        ry = y.argsort().argsort().astype(float)
        if rx.std() < 1e-12 or ry.std() < 1e-12:
            continue
        ics.append(float(np.corrcoef(rx, ry)[0, 1]))
    if not ics:
        return {"mean_ic": None, "ic_std": None, "icir": None, "t_stat": None, "n": 0, "pos": None}
    arr = np.array(ics, dtype=float)
    mean = float(arr.mean())
    std = float(arr.std(ddof=1)) if arr.size > 1 else 0.0
    n = int(arr.size)
    return {
        "mean_ic": mean,
        "ic_std": std,
        "icir": (mean / std) if std > 0 else None,
        "t_stat": (mean / (std / n ** 0.5)) if std > 0 and n > 1 else None,
        "n": n,
        "pos": float((arr > 0).mean()),
    }


def _decile_ls_np(f: np.ndarray, r: np.ndarray, nq: int = 10, hold_days: int = 1) -> dict:
    n_stocks, n_dates = f.shape
    group = [[] for _ in range(nq)]
    group_tvr = [[] for _ in range(nq)]
    ls, ls_tvr, used = [], [], []
    prev_hold = [set() for _ in range(nq)]
    codes = np.arange(n_stocks)
    for t in range(n_dates):
        m = np.isfinite(f[:, t]) & np.isfinite(r[:, t])
        if int(m.sum()) < nq * 5:
            continue
        x, y, idx = f[m, t], r[m, t], codes[m]
        order = x.argsort()
        ranks = np.empty_like(order, dtype=float)
        ranks[order] = np.linspace(0, 1, len(x), endpoint=False)
        q = np.minimum((ranks * nq).astype(int), nq - 1)
        means, holds, ok = [], [], True
        for i in range(nq):
            sel = y[q == i]
            if sel.size < 3:
                ok = False
                break
            means.append(float(sel.mean()))
            holds.append(set(idx[q == i].tolist()))
        if not ok:
            continue
        for i, v in enumerate(means):
            group[i].append(v)
            cur, prev = holds[i], prev_hold[i]
            tvr = 1.0 if not prev else len(cur - prev) / max(len(cur), 1)
            group_tvr[i].append(float(tvr))
            prev_hold[i] = cur
        ls.append(means[-1] - means[0])
        ls_tvr.append(float(0.5 * (group_tvr[0][-1] + group_tvr[-1][-1])))
        used.append(t)

    def pack(a, tv=None):
        a = np.asarray(a, dtype=float)
        if a.size == 0:
            return {}
        k = 1.0 / float(max(hold_days, 1))
        sk = k ** 0.5
        nav = np.cumprod(1 + a)
        peak = np.maximum.accumulate(nav)
        std = float(a.std())
        out = {
            "ann_ret": float(a.mean() * 252 * k),
            "sharpe": float(a.mean() / std * (252 ** 0.5) * sk) if std > 0 else None,
            "max_dd": float((nav / np.maximum(peak, 1e-12) - 1).min()),
            "n": int(a.size),
        }
        if tv is not None and len(tv):
            out["tvr_avg"] = float(np.mean(tv))
        return out

    out: dict = {"n_days": int(len(used))}
    q_ann = []
    for i, rets in enumerate(group, 1):
        rec = pack(rets, group_tvr[i - 1])
        out[f"q{i}"] = rec
        q_ann.append(rec.get("ann_ret"))
    out["long_short"] = pack(ls, ls_tvr)
    finite = [x for x in q_ann if x is not None]
    out["peak_q"] = int(np.nanargmax(np.array([np.nan if x is None else x for x in q_ann], dtype=float))) + 1 if finite else None
    q10, q9, q8 = (out.get("q10") or {}).get("ann_ret"), (out.get("q9") or {}).get("ann_ret"), (out.get("q8") or {}).get("ann_ret")
    out["q10_q9"] = None if q10 is None or q9 is None else q10 - q9
    out["q9_q8"] = None if q9 is None or q8 is None else q9 - q8
    top = [q_ann[i] for i in range(5, 10)]
    if all(x is not None for x in top):
        d = np.diff(np.array(top, dtype=float))
        out["mono_top"] = int((d > 0).sum())
        out["inv_top"] = int((d < 0).sum())
    else:
        out["mono_top"] = out["inv_top"] = None
    return out


def _ols_resid(y: np.ndarray, *xs: np.ndarray) -> np.ndarray:
    cols = [np.ones(len(y))]
    for x in xs:
        cols.append(np.asarray(x, dtype=float))
    X = np.column_stack(cols)
    try:
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        return y - X @ beta
    except Exception:
        return y - y.mean()


def neutralize(factor: pd.DataFrame, *, size: pd.DataFrame | None = None, industry: pd.DataFrame | None = None, mode: str = "none") -> pd.DataFrame:
    if mode == "none":
        return factor
    f = factor.copy()
    f.columns = [int(c) for c in f.columns]
    arr = np.array(f.to_numpy(dtype=np.float64), copy=True)
    sz = size.reindex(index=f.index, columns=f.columns).to_numpy(dtype=np.float64) if size is not None else None
    ind = industry.reindex(index=f.index, columns=f.columns).to_numpy(dtype=np.float64) if industry is not None else None
    for t in range(arr.shape[1]):
        y = arr[:, t]
        if mode == "size" and sz is not None:
            x = sz[:, t]
            m = np.isfinite(y) & np.isfinite(x)
            if int(m.sum()) < 30:
                continue
            col = arr[:, t]
            col[m] = _ols_resid(y[m], x[m])
            arr[:, t] = col
        elif mode == "industry" and ind is not None:
            g = ind[:, t]
            m = np.isfinite(y) & np.isfinite(g)
            if int(m.sum()) < 30:
                continue
            yg, gg = y[m].copy(), g[m]
            for val in np.unique(gg):
                gm = gg == val
                if int(gm.sum()) < 3:
                    continue
                yg[gm] = yg[gm] - yg[gm].mean()
            col = arr[:, t]
            col[m] = yg
            arr[:, t] = col
        elif mode == "size_industry" and sz is not None and ind is not None:
            x, g = sz[:, t], ind[:, t]
            m = np.isfinite(y) & np.isfinite(x) & np.isfinite(g)
            if int(m.sum()) < 40:
                continue
            yg, xg, gg = y[m], x[m], g[m]
            levels = np.unique(gg)
            if levels.size >= 2:
                dummies = [(gg == lv).astype(float) for lv in levels[1:]]
                yg = _ols_resid(yg, xg, *dummies)
            else:
                yg = _ols_resid(yg, xg)
            col = arr[:, t]
            col[m] = yg
            arr[:, t] = col
    return pd.DataFrame(arr, index=f.index, columns=f.columns)


def align_pair(factor: pd.DataFrame, other: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    f, o = factor.copy(), other.copy()
    f.columns = [int(c) for c in f.columns]
    o.columns = [int(c) for c in o.columns]
    cols = sorted(set(f.columns) & set(o.columns))
    rows = f.index.intersection(o.index)
    return f.loc[rows, cols], o.loc[rows, cols]


def evaluate_local(
    factor: pd.DataFrame,
    ret: pd.DataFrame,
    *,
    hold_days: int = 1,
    orientation: int = 1,
    size: pd.DataFrame | None = None,
    industry: pd.DataFrame | None = None,
    modes: tuple[str, ...] = ("none",),
) -> dict:
    """All inputs are stock x date frames. ret already aligned to the signal date."""
    f0, r0 = align_pair(factor, ret)
    if orientation not in (-1, 1):
        raise ValueError("orientation must be +1 or -1")
    if orientation == -1:
        f0 = -f0
    out = {
        "window": {
            "start": int(f0.columns.min()) if len(f0.columns) else None,
            "end": int(f0.columns.max()) if len(f0.columns) else None,
            "n_dates": int(f0.shape[1]),
            "n_stocks": int(f0.shape[0]),
        },
        "hold_days": hold_days,
        "orientation": orientation,
        "coverage": float(np.isfinite(f0.to_numpy()).mean()) if f0.size else 0.0,
        "modes": {},
    }
    r_arr_base = r0.to_numpy(dtype=np.float64)
    for mode in modes:
        sz = size.reindex(index=f0.index, columns=f0.columns) if size is not None else None
        ind = industry.reindex(index=f0.index, columns=f0.columns) if industry is not None else None
        fm = neutralize(f0, size=sz, industry=ind, mode=mode)
        f_arr = fm.to_numpy(dtype=np.float64)
        ic = _rank_ic_np(f_arr, r_arr_base)
        dec = _decile_ls_np(f_arr, r_arr_base, hold_days=hold_days)
        ls = dec.get("long_short") or {}
        out["modes"][mode] = {
            "rank_ic": ic.get("mean_ic"),
            "icir": ic.get("icir"),
            "t_stat": ic.get("t_stat"),
            "ic_positive_rate": ic.get("pos"),
            "n_ic": ic.get("n"),
            "ls_ann_ret": ls.get("ann_ret"),
            "ls_sharpe": ls.get("sharpe"),
            "ls_max_dd": ls.get("max_dd"),
            "ls_tvr_avg": ls.get("tvr_avg"),
            "peak_q": dec.get("peak_q"),
            "q8_ann": (dec.get("q8") or {}).get("ann_ret"),
            "q9_ann": (dec.get("q9") or {}).get("ann_ret"),
            "q10_ann": (dec.get("q10") or {}).get("ann_ret"),
            "q10_q9": dec.get("q10_q9"),
            "q9_q8": dec.get("q9_q8"),
            "mono_top": dec.get("mono_top"),
            "inv_top": dec.get("inv_top"),
            "n_days": dec.get("n_days"),
        }
    none = out["modes"].get("none") or {}
    peak = none.get("peak_q")
    q10q9 = none.get("q10_q9")
    ic1 = none.get("rank_ic")
    ls_s = none.get("ls_sharpe")
    n_days = none.get("n_days") or 0
    reasons = []
    if n_days < 60:
        reasons.append("n_days<60")
    if peak is not None and peak <= 7:
        reasons.append("peak_q<=7")
    if q10q9 is not None and q10q9 < 0 and (none.get("q10_ann") or 0) < (none.get("q8_ann") or 0):
        reasons.append("q10_inverted")
    if ic1 is not None and ls_s is not None and ic1 * ls_s < 0:
        reasons.append("ic_ls_sign_mismatch")
    if "peak_q<=7" in reasons or "q10_inverted" in reasons:
        gate = "reject"
        note = "分层失败"
    elif n_days < 60:
        gate = "draft"
        note = "样本不足，仅草稿"
    elif reasons:
        gate = "watch"
        note = ",".join(reasons)
    else:
        gate = "intake_ok"
        note = "pass"
    out["intake"] = {"status": gate, "note": note, "reasons": reasons}
    return out


def load_panel_csv(path: Path, calendar: np.ndarray | None = None) -> pd.DataFrame:
    return align_to_calendar(parse_factor_csv(path.read_text(encoding="utf-8")), calendar)


def duplicate_decision(rank_corr: float | None, q10_jaccard: float | None) -> str:
    rc = -1.0 if rank_corr is None else rank_corr
    jq = -1.0 if q10_jaccard is None else q10_jaccard
    if rc >= 0.95 or (rc >= 0.90 and jq >= 0.80):
        return "duplicate"
    if rc >= 0.80 or jq >= 0.40:
        return "family"
    return "keep"


@dataclass
class Library:
    root: Path

    def __post_init__(self):
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "matrix").mkdir(exist_ok=True)
        (self.root / "eval").mkdir(exist_ok=True)
        cat = self.catalog_path
        if not cat.exists():
            pd.DataFrame(
                columns=[
                    "factor_id",
                    "name",
                    "author",
                    "universe",
                    "orientation",
                    "version",
                    "start",
                    "end",
                    "n_dates",
                    "status",
                    "created_at",
                    "path",
                ]
            ).to_csv(cat, index=False)

    @property
    def catalog_path(self) -> Path:
        return self.root / "catalog.csv"

    def catalog(self) -> pd.DataFrame:
        return pd.read_csv(self.catalog_path)

    def load_matrix(self, factor_id: str) -> pd.DataFrame:
        p = self.root / "matrix" / f"{factor_id}.parquet"
        if not p.exists():
            raise FileNotFoundError(p)
        df = pd.read_parquet(p)
        df.columns = [int(str(c).replace("-", "")[:8]) for c in df.columns]
        return df

    def next_id(self, universe: str, author: str) -> str:
        slug_u = _SLUG_RE.sub("_", universe) or "market"
        slug_a = _SLUG_RE.sub("_", author) or "user"
        prefix = f"{slug_u}_{slug_a}_"
        cat = self.catalog()
        n = 1
        if not cat.empty:
            ids = cat["factor_id"].astype(str)
            same = ids[ids.str.startswith(prefix)]
            if len(same):
                tails = []
                for x in same:
                    try:
                        tails.append(int(str(x)[len(prefix) :]))
                    except ValueError:
                        continue
                if tails:
                    n = max(tails) + 1
        return f"{prefix}{n:05d}"

    def ingest(
        self,
        csv_text: str,
        *,
        name: str,
        author: str = "user",
        universe: str = "market",
        orientation: int = 1,
        version: str = "v1",
        calendar: np.ndarray | None = None,
        factor_id: str | None = None,
        status: str = "draft",
        eval_summary: dict | None = None,
        ret: pd.DataFrame | None = None,
        price: pd.DataFrame | None = None,
        hold_days: int = 1,
        size: pd.DataFrame | None = None,
        industry: pd.DataFrame | None = None,
    ) -> dict:
        long_df = parse_factor_csv(csv_text)
        wide = align_to_calendar(long_df, calendar)
        fid = factor_id or self.next_id(universe, author)
        mx = self.root / "matrix" / f"{fid}.parquet"
        wide.astype("float32").to_parquet(mx)
        if eval_summary is None and (ret is not None or price is not None):
            if ret is None:
                ret = fwd_from_price(price, 1, 1 + max(hold_days, 1))
            modes = ("none", "industry", "size", "size_industry") if (size is not None or industry is not None) else ("none",)
            eval_summary = evaluate_local(
                wide, ret, hold_days=hold_days, orientation=orientation,
                size=size, industry=industry, modes=modes,
            )
            if status == "draft":
                status = eval_summary.get("intake", {}).get("status") or status
        neighbors = self.correlate(wide, universe=universe)
        decision = "keep"
        if neighbors:
            top = neighbors[0]
            decision = duplicate_decision(top.get("rank_corr"), top.get("q10_jaccard"))
            if decision == "duplicate" and status == "intake_ok":
                status = "duplicate"
        dates = [int(c) for c in wide.columns if np.isfinite(wide[c]).any()]
        rec = {
            "factor_id": fid,
            "name": name,
            "author": author,
            "universe": universe,
            "orientation": int(orientation),
            "version": version,
            "start": dates[0] if dates else "",
            "end": dates[-1] if dates else "",
            "n_dates": int(len(dates)),
            "status": status,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "path": str(mx),
        }
        none = ((eval_summary or {}).get("modes") or {}).get("none") or {}
        rec["ic1"] = none.get("rank_ic")
        rec["icir1"] = none.get("icir")
        rec["open_ls_sharpe"] = none.get("ls_sharpe")
        rec["peak_q"] = none.get("peak_q")
        rec["q10_q9"] = none.get("q10_q9")
        cat = self.catalog()
        cat = pd.concat([cat, pd.DataFrame([rec])], ignore_index=True)
        cat.to_csv(self.catalog_path, index=False)
        payload = {"record": rec, "neighbors": neighbors, "duplicate_decision": decision}
        if eval_summary:
            payload["eval"] = eval_summary
        (self.root / "eval" / f"{fid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
        return payload

    def correlate(self, wide: pd.DataFrame, *, universe: str | None = None, top_k: int = 5) -> list[dict]:
        cat = self.catalog()
        if cat.empty:
            return []
        pool = cat
        if universe:
            pool = pool[pool["universe"].astype(str) == str(universe)]
        pool = pool[pool["status"].astype(str).isin(["intake_ok", "draft", "family"])]
        rows = []
        for rec in pool.itertuples(index=False):
            try:
                other = self.load_matrix(str(rec.factor_id))
            except FileNotFoundError:
                continue
            st = pairwise_stats(wide, other)
            st.update(
                {
                    "factor_id": rec.factor_id,
                    "name": rec.name,
                    "status": rec.status,
                    "decision": duplicate_decision(st.get("rank_corr"), st.get("q10_jaccard")),
                }
            )
            rows.append(st)
        rows.sort(key=lambda r: (r.get("rank_corr") is not None, r.get("rank_corr") or -9), reverse=True)
        return rows[:top_k]


def _load_optional_panel(path: str | None, calendar: np.ndarray | None) -> pd.DataFrame | None:
    if not path:
        return None
    return load_panel_csv(Path(path), calendar)


def _cmd_ingest(args: argparse.Namespace) -> int:
    text = Path(args.csv).read_text(encoding="utf-8")
    cal = load_calendar(Path(args.calendar) if args.calendar else None)
    lib = Library(Path(args.lib))
    eval_summary = None
    if args.data_dir or args.ftshare or args.auto_market:
        from market_data import pick_data_dir
        from ftshare_client import resolve_market
        from research_eval import evaluate_research

        factor = load_panel_csv(Path(args.csv), cal)
        data_dir = args.data_dir
        if not data_dir and args.auto_market:
            picked = pick_data_dir()
            data_dir = picked["path"] if picked and picked.get("exists") else None
        dates = [int(c) for c in factor.columns]
        market = resolve_market(
            data_dir=data_dir,
            ftshare=bool(args.ftshare),
            stocks=[str(i) for i in factor.index],
            start=min(dates) if dates else None,
            end=max(dates) if dates else None,
            universe=args.universe,
            cache_dir=args.market_cache,
            ftshare_url=args.ftshare_url,
            max_stocks=args.ftshare_max_stocks,
        )
        eval_summary = evaluate_research(
            factor, market, orientation=args.orientation or 1, universe=args.universe,
            name=args.name or Path(args.csv).stem,
        )
    out = lib.ingest(
        text,
        name=args.name or Path(args.csv).stem,
        author=args.author,
        universe=args.universe,
        orientation=args.orientation or 1,
        version=args.version,
        calendar=cal,
        factor_id=args.factor_id,
        status=args.status,
        ret=_load_optional_panel(getattr(args, "ret", None), cal),
        price=_load_optional_panel(getattr(args, "price", None), cal),
        hold_days=getattr(args, "hold_days", 1),
        size=_load_optional_panel(getattr(args, "size", None), cal),
        industry=_load_optional_panel(getattr(args, "industry", None), cal),
        eval_summary=eval_summary,
    )
    html_path = _maybe_write_html(args, eval_summary or out.get("eval") or {})
    if html_path:
        out["html"] = str(html_path)
    _print_summary(eval_summary or out.get("eval") or out)
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


def _cmd_eval(args: argparse.Namespace) -> int:
    cal = load_calendar(Path(args.calendar) if args.calendar else None)
    factor = load_panel_csv(Path(args.csv), cal)
    use_market = bool(args.data_dir or args.ftshare or args.auto_market)
    if use_market and not (args.ret or args.price):
        return _cmd_eval_market(args, factor, cal)
    if args.ret:
        ret = load_panel_csv(Path(args.ret), cal)
    elif args.price:
        ret = fwd_from_price(load_panel_csv(Path(args.price), cal), 1, 1 + max(args.hold_days, 1))
    else:
        raise SystemExit(
            "eval requires --ret / --price, or --data-dir / --ftshare / --auto-market "
            "(discover local OpenAlpha matrices, optionally fill via FTShare)"
        )
    size = _load_optional_panel(args.size, cal)
    industry = _load_optional_panel(args.industry, cal)
    modes = ("none", "industry", "size", "size_industry") if (size is not None or industry is not None) else ("none",)
    if args.orientation is None:
        out = {
            "intake": {"status": "unrated", "note": "orientation undeclared", "reasons": ["orientation_unknown"]},
            "window": {
                "start": int(factor.columns.min()) if len(factor.columns) else None,
                "end": int(factor.columns.max()) if len(factor.columns) else None,
                "n_dates": int(factor.shape[1]),
            },
        }
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return 2
    out = evaluate_local(
        factor, ret, hold_days=args.hold_days, orientation=args.orientation,
        size=size, industry=industry, modes=modes,
    )
    _maybe_write_html(args, out)
    _print_summary(out)
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


def _cmd_eval_market(args: argparse.Namespace, factor: pd.DataFrame, cal: np.ndarray | None) -> int:
    from market_data import discover_data_dirs, pick_data_dir
    from ftshare_client import resolve_market
    from research_eval import evaluate_research

    if args.orientation is None:
        out = {
            "intake": {"status": "unrated", "note": "orientation undeclared", "reasons": ["orientation_unknown"]},
        }
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return 2
    data_dir = args.data_dir
    if not data_dir and args.auto_market:
        picked = pick_data_dir()
        if picked and picked.get("exists"):
            data_dir = picked["path"]
            print(json.dumps({"discovered_data_dir": picked}, ensure_ascii=False, default=str), file=sys.stderr)
        else:
            found = discover_data_dirs()
            print(json.dumps({"discovered": found}, ensure_ascii=False, indent=2, default=str), file=sys.stderr)
            if not args.ftshare:
                raise SystemExit("no local OpenAlpha data_dir found; pass --data-dir or --ftshare")
    dates = [int(c) for c in factor.columns]
    stocks = [str(i) for i in factor.index]
    start = min(dates) if dates else None
    end = max(dates) if dates else None
    if cal is not None and cal.size and end is not None:
        idx = int(np.searchsorted(cal, end, side="right") - 1)
        extra = cal[min(idx + 22, cal.size - 1)]
        end = int(max(end, extra))
    elif end is not None:
        dt = datetime.strptime(str(end), "%Y%m%d")
        end = int((dt + timedelta(days=40)).strftime("%Y%m%d"))
    market = resolve_market(
        data_dir=data_dir,
        ftshare=bool(args.ftshare),
        stocks=stocks,
        start=start,
        end=end,
        universe=args.universe,
        cache_dir=args.market_cache,
        ftshare_url=args.ftshare_url,
        max_stocks=args.ftshare_max_stocks,
    )
    out = evaluate_research(
        factor,
        market,
        orientation=args.orientation,
        universe=args.universe,
        name=args.name or Path(args.csv).stem,
    )
    html_path = _maybe_write_html(args, out)
    if html_path:
        out["html"] = str(html_path)
    _print_summary(out)
    print(json.dumps(_slim_eval(out), ensure_ascii=False, indent=2, default=str))
    return 0


def _print_summary(out: dict) -> None:
    try:
        from report_html import summarize_factor, summary_text, report_open_lines
    except Exception:
        return
    summary = summarize_factor(out, neighbors=out.get("neighbors"))
    out["summary"] = summary
    sys.stderr.write(summary_text(summary))
    links = report_open_lines(out.get("html"), out.get("md"))
    if links:
        sys.stderr.write("\n打开报告：\n")
        sys.stderr.write(links)
        try:
            from report_html import file_url
            if out.get("html") and not out.get("open_html"):
                out["open_html"] = file_url(out["html"])
            if out.get("md") and not out.get("open_md"):
                out["open_md"] = file_url(out["md"])
        except Exception:
            pass
    sys.stderr.flush()


def _slim_eval(out: dict) -> dict:
    """Drop bulky daily series from stdout; HTML still has them."""
    if "summary" not in out:
        try:
            from report_html import summarize_factor
            out["summary"] = summarize_factor(out, neighbors=out.get("neighbors"))
        except Exception:
            pass
    slim = {k: v for k, v in out.items() if k not in {"none", "industry", "size", "size_industry"}}
    for mode in ("none", "industry", "size", "size_industry"):
        block = out.get(mode)
        if not isinstance(block, dict):
            continue
        slim[mode] = {
            "title": block.get("title"),
            "label_1d": _slim_label(block.get("label_1d")),
            "label_5d": _slim_label(block.get("label_5d")),
            "label_20d": _slim_label(block.get("label_20d")),
            "close_fwd": {
                k: _slim_label(v) for k, v in (block.get("close_fwd") or {}).items()
            } if block.get("close_fwd") else None,
            "vwap_trade": {
                k: _slim_label(v) for k, v in (block.get("vwap_trade") or {}).items()
            } if block.get("vwap_trade") else None,
        }
    return slim


def _slim_label(lab: dict | None) -> dict | None:
    if not isinstance(lab, dict):
        return lab
    keep = {
        k: lab.get(k)
        for k in (
            "rank_ic", "icir", "t_stat", "ic_positive_rate", "n", "n_days",
            "ls_ann_ret", "ls_sharpe", "ls_ann_vol", "ls_max_dd",
            "ls_tvr_avg", "ls_tvr_ann", "peak_q", "q10_q9", "q9_q8", "mono_top",
        )
    }
    dec = lab.get("deciles") or {}
    keep["deciles"] = {
        qk: {sk: (qv or {}).get(sk) for sk in ("ann_ret", "sharpe", "tvr_avg", "max_dd", "excess_ann_ret")}
        for qk, qv in dec.items()
    }
    ex = lab.get("excess") if isinstance(lab.get("excess"), dict) else None
    if ex:
        keep["excess"] = {k: ex.get(k) for k in ("ann_ret", "sharpe")}
    return keep


def _maybe_write_html(args: argparse.Namespace, out: dict) -> Path | None:
    if not getattr(args, "html", False) and not getattr(args, "html_dir", None):
        return None
    if not isinstance(out, dict) or not isinstance(out.get("none"), dict):
        return None
    from report_html import render_report, save_report

    html_doc = render_report(out, neighbors=out.get("neighbors"))
    directory = Path(args.html_dir) if getattr(args, "html_dir", None) else None
    path = save_report(html_doc, directory=directory)
    out["html"] = str(path)
    md_path = None
    try:
        from report_tabs import diagnostics_markdown
        md_path = path.with_suffix(".md")
        md_path.write_text(diagnostics_markdown(out), encoding="utf-8")
        out["md"] = str(md_path)
        print(f"md={md_path}", file=sys.stderr)
    except Exception as exc:
        print(f"md_skip={exc}", file=sys.stderr)
    print(f"html={path}", file=sys.stderr)
    try:
        from report_html import file_url
        out["open_html"] = file_url(path)
        print(f"open_html={out['open_html']}", file=sys.stderr)
        if md_path is not None:
            out["open_md"] = file_url(md_path)
            print(f"open_md={out['open_md']}", file=sys.stderr)
    except Exception:
        pass
    return path


def _cmd_discover(args: argparse.Namespace) -> int:
    from market_data import discover_data_dirs, inspect_data_dir
    extra = [args.path] if args.path else None
    found = discover_data_dirs(extra)
    if args.path:
        found = [inspect_data_dir(Path(args.path).expanduser())] + [x for x in found if x.get("path") != str(Path(args.path).expanduser())]
    print(json.dumps({"n": len(found), "dirs": found}, ensure_ascii=False, indent=2, default=str))
    if not found:
        print(
            "no local OpenAlpha data_dir. Set OPENALPHA_DATA_DIR or pass --data-dir; "
            "or --ftshare to fill missing names from https://market.ft.tech/gateway/mcp",
            file=sys.stderr,
        )
        return 1
    return 0


def _cmd_ftshare_probe(args: argparse.Namespace) -> int:
    from ftshare_client import probe

    out = probe(args.url)
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0 if out.get("ok") else 1


def _cmd_corr(args: argparse.Namespace) -> int:
    lib = Library(Path(args.lib))
    a = lib.load_matrix(args.a)
    rows = lib.correlate(a, universe=args.universe, top_k=args.top_k)
    if args.b:
        b = lib.load_matrix(args.b)
        rows = [dict(pairwise_stats(a, b), factor_id=args.b, decision=duplicate_decision(
            pairwise_stats(a, b).get("rank_corr"), pairwise_stats(a, b).get("q10_jaccard")
        ))]
    print(json.dumps(rows, ensure_ascii=False, indent=2, default=str))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Lightweight factor library")
    sub = p.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="parse CSV, align, write parquet, correlate vs library")
    ing.add_argument("--csv", required=True)
    ing.add_argument("--lib", required=True)
    ing.add_argument("--name")
    ing.add_argument("--author", default="user")
    ing.add_argument("--universe", default="market")
    ing.add_argument("--orientation", type=int, default=1)
    ing.add_argument("--version", default="v1")
    ing.add_argument("--calendar", help="optional trading-day file, one YYYYMMDD per line")
    ing.add_argument("--factor-id")
    ing.add_argument("--status", default="draft", choices=["draft", "intake_ok", "rejected", "duplicate", "watch"])
    ing.add_argument("--ret", help="optional forward-return CSV, same 3-col shape as factor")
    ing.add_argument("--price", help="optional price CSV; builds ret as px[t+1+H]/px[t+1]-1")
    ing.add_argument("--hold-days", type=int, default=1)
    ing.add_argument("--size", help="optional log-size CSV")
    ing.add_argument("--industry", help="optional industry-id CSV")
    ing.set_defaults(func=_cmd_ingest)

    ev = sub.add_parser("eval", help="local RankIC / Q1-Q10; optional data_dir / FTShare / HTML")
    ev.add_argument("--csv", required=True, help="factor CSV: date, stock, value")
    ev.add_argument("--ret", help="forward-return CSV already aligned to signal date")
    ev.add_argument("--price", help="price CSV; default horizon t+1 -> t+2")
    ev.add_argument("--hold-days", type=int, default=1)
    ev.add_argument("--orientation", type=int, default=None, help="+1 or -1; omit => unrated")
    ev.add_argument("--calendar")
    ev.add_argument("--size")
    ev.add_argument("--industry")
    ev.add_argument("--universe", default="market")
    ev.add_argument("--name")
    ev.add_argument("--data-dir", help="OpenAlpha-style matrix directory (open/high/low/volume/vwap/limit/adj/index)")
    ev.add_argument("--auto-market", action="store_true", help="search local data_dir candidates")
    ev.add_argument("--ftshare", action="store_true", help="fill missing names via FTShare MCP (user-local cache only)")
    ev.add_argument("--ftshare-url", default=os.environ.get("FTSHARE_MCP_URL"))
    ev.add_argument("--ftshare-max-stocks", type=int, default=400)
    ev.add_argument("--market-cache", help="FTShare cache dir, default ~/.factor-intake/market_cache")
    ev.add_argument("--html", action="store_true", help="write standalone HTML report")
    ev.add_argument("--html-dir", help="HTML output directory")
    ev.set_defaults(func=_cmd_eval)

    cr = sub.add_parser("corr", help="rank-corr + Q10 Jaccard vs library or one peer")
    cr.add_argument("--lib", required=True)
    cr.add_argument("--a", required=True, help="factor_id")
    cr.add_argument("--b", help="optional peer factor_id")
    cr.add_argument("--universe")
    cr.add_argument("--top-k", type=int, default=5)
    cr.set_defaults(func=_cmd_corr)

    disc = sub.add_parser("discover", help="search local OpenAlpha-style data_dir; do not download")
    disc.add_argument("--path", help="extra path to inspect")
    disc.set_defaults(func=_cmd_discover)

    pr = sub.add_parser("ftshare-probe", help="handshake FTShare MCP (ohlc sample); no data vendored")
    pr.add_argument("--url", default=os.environ.get("FTSHARE_MCP_URL"))
    pr.set_defaults(func=_cmd_ftshare_probe)

    ing.add_argument("--data-dir")
    ing.add_argument("--auto-market", action="store_true")
    ing.add_argument("--ftshare", action="store_true")
    ing.add_argument("--ftshare-url", default=os.environ.get("FTSHARE_MCP_URL"))
    ing.add_argument("--ftshare-max-stocks", type=int, default=400)
    ing.add_argument("--market-cache")
    ing.add_argument("--html", action="store_true")
    ing.add_argument("--html-dir")

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
