#!/usr/bin/env python3
"""8164-style daily research evaluation on local matrices (+ optional FTShare fill)."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from factor_lib import neutralize
from market_data import INDEX_SYMBOL, MarketBundle, adj_price, apply_universe, coverage_report


def _rank_ic_full(f: np.ndarray, r: np.ndarray, min_names: int = 30) -> tuple[dict, list[float]]:
    ics: list[float] = []
    for t in range(f.shape[1]):
        m = np.isfinite(f[:, t]) & np.isfinite(r[:, t])
        if int(m.sum()) < min_names:
            ics.append(float("nan"))
            continue
        x, y = f[m, t], r[m, t]
        rx = x.argsort().argsort().astype(float)
        ry = y.argsort().argsort().astype(float)
        if rx.std() < 1e-12 or ry.std() < 1e-12:
            ics.append(float("nan"))
            continue
        ics.append(float(np.corrcoef(rx, ry)[0, 1]))
    arr = np.array(ics, dtype=float)
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return {
            "mean_ic": None,
            "ic_std": None,
            "icir": None,
            "t_stat": None,
            "n": 0,
            "pos": None,
        }, ics
    mean = float(finite.mean())
    std = float(finite.std(ddof=1)) if finite.size > 1 else 0.0
    n = int(finite.size)
    return {
        "mean_ic": mean,
        "ic_std": std,
        "icir": (mean / std) if std > 0 else None,
        "t_stat": (mean / (std / n ** 0.5)) if std > 0 and n > 1 else None,
        "n": n,
        "pos": float((finite > 0).mean()),
    }, ics


def _decile_full(f: np.ndarray, r: np.ndarray, nq: int = 10, hold_days: int = 1) -> dict:
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

    k = 1.0 / float(max(hold_days, 1))
    sk = k ** 0.5

    def pack(a, tv=None, keep_daily=True):
        a = np.asarray(a, dtype=float)
        if a.size == 0:
            return {}
        nav = np.cumprod(1 + a)
        peak = np.maximum.accumulate(nav)
        std = float(a.std())
        out = {
            "ann_ret": float(a.mean() * 252 * k),
            "ann_vol": float(std * (252 ** 0.5) * sk) if std > 0 else None,
            "sharpe": float(a.mean() / std * (252 ** 0.5) * sk) if std > 0 else None,
            "max_dd": float((nav / np.maximum(peak, 1e-12) - 1).min()),
            "n": int(a.size),
        }
        if tv is not None and len(tv):
            out["tvr_avg"] = float(np.mean(tv))
            out["tvr_ann"] = float(np.mean(tv) * 252.0)
        if keep_daily:
            out["daily"] = [float(x) for x in a]
        return out

    out: dict = {"n_days": int(len(used)), "_used_idx": used}
    q_ann = []
    for i, rets in enumerate(group, 1):
        rec = pack(rets, group_tvr[i - 1])
        out[f"q{i}"] = rec
        q_ann.append(rec.get("ann_ret"))
    ls_pack = pack(ls, ls_tvr)
    ls_pack["ls_daily"] = ls_pack.get("daily")
    out["long_short"] = ls_pack
    finite = [x for x in q_ann if x is not None]
    out["peak_q"] = (
        int(np.nanargmax(np.array([np.nan if x is None else x for x in q_ann], dtype=float))) + 1 if finite else None
    )
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


def fwd_from_price(price: pd.DataFrame, entry: int, exit_: int) -> pd.DataFrame:
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


def limit_ok(open_px, high, low, volume, limit_up, limit_down, *, kind: str):
    vol_ok = np.isfinite(volume) & (volume > 0) if volume is not None else np.isfinite(open_px)
    if limit_up is not None:
        valid_up = np.isfinite(limit_up) & (limit_up > 0) & (limit_up < 50000)
    else:
        valid_up = np.zeros_like(open_px, dtype=bool)
    if limit_down is not None:
        valid_dn = np.isfinite(limit_down) & (limit_down > 0) & (limit_down < 50000)
    else:
        valid_dn = np.zeros_like(open_px, dtype=bool)
    z = np.zeros_like(open_px, dtype=bool)
    if kind == "open":
        at_up = z.copy()
        at_dn = z.copy()
        if limit_up is not None:
            at_up = valid_up & np.isfinite(open_px) & (open_px >= limit_up * 0.999)
        if limit_down is not None:
            at_dn = valid_dn & np.isfinite(open_px) & (open_px <= limit_down * 1.001)
        px_ok = np.isfinite(open_px) & (open_px > 0)
        can_buy = vol_ok & px_ok & ~at_up
        can_sell = vol_ok & px_ok & ~at_dn
    else:
        lock_up = z.copy()
        lock_dn = z.copy()
        if limit_up is not None:
            px_lo = low if low is not None else open_px
            lock_up = valid_up & np.isfinite(px_lo) & (px_lo >= limit_up * 0.999)
        if limit_down is not None:
            px_hi = high if high is not None else open_px
            lock_dn = valid_dn & np.isfinite(px_hi) & (px_hi <= limit_down * 1.001)
        px_ok = np.isfinite(open_px) & (open_px > 0)
        can_buy = vol_ok & px_ok & ~lock_up
        can_sell = vol_ok & px_ok & ~lock_dn
    return can_buy, can_sell


def mask_hold(r, can_buy, can_sell, entry: int, exit_: int):
    n = r.shape[1]
    if exit_ >= n:
        return r, {}
    width = n - exit_
    buy_e = can_buy[:, entry : entry + width]
    sell_e = can_sell[:, entry : entry + width]
    buy_x = can_buy[:, exit_ : exit_ + width]
    sell_x = can_sell[:, exit_ : exit_ + width]
    long_ok = buy_e & sell_x
    short_ok = sell_e & buy_x
    ok = long_ok | short_ok
    out = np.array(r, dtype=float, copy=True)
    out[:, :width] = np.where(ok, out[:, :width], np.nan)
    stats = {
        "frac_long_ok": float(np.mean(long_ok)) if long_ok.size else None,
        "frac_short_ok": float(np.mean(short_ok)) if short_ok.size else None,
        "frac_either_ok": float(np.mean(ok)) if ok.size else None,
    }
    return out, stats


def _align_frame(base: pd.DataFrame, other: pd.DataFrame | None) -> pd.DataFrame | None:
    if other is None:
        return None
    o = other.copy()
    o.columns = [int(c) for c in o.columns]
    cols = [c for c in base.columns if c in o.columns]
    rows = base.index.intersection(o.index)
    return o.loc[rows, cols].reindex(index=base.index, columns=base.columns)


def _index_fwd(series: pd.Series, dates: list[int], entry: int, exit_: int) -> np.ndarray:
    s = series.copy()
    s.index = [int(i) for i in s.index]
    arr = np.array([float(s[d]) if d in s.index else np.nan for d in dates], dtype=float)
    n = arr.size
    out = np.full(n, np.nan)
    if exit_ >= n:
        return out
    width = n - exit_
    den = arr[entry : entry + width]
    num = arr[exit_ : exit_ + width]
    with np.errstate(divide="ignore", invalid="ignore"):
        out[:width] = num / np.where(np.abs(den) > 1e-12, den, np.nan) - 1.0
    return out


def _pack_label(ic: dict, dec: dict, hold_days: int, dates: list[int], bench: np.ndarray | None) -> dict:
    ls = dec.get("long_short") or {}
    used = dec.get("_used_idx") or []
    slim = {}
    for i in range(1, 11):
        qv = dec.get(f"q{i}") or {}
        slim[f"q{i}"] = {
            "ann_ret": qv.get("ann_ret"),
            "sharpe": qv.get("sharpe"),
            "ann_vol": qv.get("ann_vol"),
            "n": qv.get("n"),
            "max_dd": qv.get("max_dd"),
            "tvr_avg": qv.get("tvr_avg"),
            "tvr_ann": qv.get("tvr_ann"),
            "daily": qv.get("daily"),
        }
    excess = None
    if bench is not None and used and hold_days == 1:
        b = np.nan_to_num(bench[np.array(used, dtype=int)])
        q_ex = {}
        for qi in range(1, 11):
            qd = np.array((slim.get(f"q{qi}") or {}).get("daily") or [], dtype=float)
            k = min(len(qd), len(b))
            if k < 2:
                continue
            ex_i = qd[:k] - b[:k]
            q_ex[f"q{qi}"] = ex_i
            qv = slim[f"q{qi}"]
            nav = np.cumprod(1 + ex_i)
            peak = np.maximum.accumulate(nav)
            qv["excess_ann_ret"] = float(ex_i.mean() * 252)
            qv["excess_sharpe"] = float(ex_i.mean() / ex_i.std() * (252 ** 0.5)) if ex_i.std() > 0 else None
            qv["excess_max_dd"] = float((nav / np.maximum(peak, 1e-12) - 1).min())
            qv["excess_daily"] = [float(x) for x in ex_i]
        if "q10" in q_ex and "q1" in q_ex:
            k = min(len(q_ex["q10"]), len(q_ex["q1"]))
            ex_ls = q_ex["q10"][:k] - q_ex["q1"][:k]
            excess = {
                "note": "per-decile excess = group_ret - benchmark; L-S = Q10_ex - Q1_ex",
                "ann_ret": float(ex_ls.mean() * 252),
                "sharpe": float(ex_ls.mean() / ex_ls.std() * (252 ** 0.5)) if ex_ls.std() > 0 else None,
                "daily": [float(x) for x in ex_ls],
                "deciles": {qk: [float(x) for x in arr] for qk, arr in q_ex.items()},
            }
    return {
        "rank_ic": ic.get("mean_ic"),
        "ic_std": ic.get("ic_std"),
        "icir": ic.get("icir"),
        "t_stat": ic.get("t_stat"),
        "ic_positive_rate": ic.get("pos"),
        "n": ic.get("n"),
        "ls_ann_ret": ls.get("ann_ret"),
        "ls_sharpe": ls.get("sharpe"),
        "ls_ann_vol": ls.get("ann_vol"),
        "ls_max_dd": ls.get("max_dd"),
        "ls_tvr_avg": ls.get("tvr_avg"),
        "ls_tvr_ann": ls.get("tvr_ann"),
        "deciles": slim,
        "ls_daily": ls.get("daily") or ls.get("ls_daily"),
        "excess": excess,
        "used_dates": [str(dates[i]) for i in used] if used else None,
        "peak_q": dec.get("peak_q"),
        "q10_q9": dec.get("q10_q9"),
        "q9_q8": dec.get("q9_q8"),
        "mono_top": dec.get("mono_top"),
        "n_days": dec.get("n_days"),
    }


def evaluate_research(
    factor: pd.DataFrame,
    market: MarketBundle,
    *,
    orientation: int = 1,
    universe: str = "market",
    name: str = "",
) -> dict[str, Any]:
    if orientation not in (-1, 1):
        raise ValueError("orientation must be +1 or -1")
    f = factor.copy()
    f.columns = [int(c) for c in f.columns]
    f.index = [str(i).strip().upper() for i in f.index]
    f = apply_universe(f, market, universe)
    if orientation == -1:
        f = -f

    open_raw = market.get("open")
    if open_raw is None or open_raw.empty:
        raise ValueError("market bundle has no open; cannot run 8164 open path")
    open_raw = open_raw.copy()
    open_raw.columns = [int(c) for c in open_raw.columns]
    rows = f.index.intersection(open_raw.index)
    if len(rows) < 10:
        raise ValueError(f"factor/open stock overlap too small: {len(rows)}")
    cols = sorted(int(c) for c in open_raw.columns)
    # keep the price calendar so t+1/t+21 exist; factor stays missing after last snapshot
    f = f.loc[rows].reindex(columns=cols)
    open_raw = open_raw.loc[rows, cols]
    dates = cols
    stocks = list(f.index)

    adj = _align_frame(f, market.get("adjfactor"))
    high = _align_frame(f, market.get("high"))
    low = _align_frame(f, market.get("low"))
    volume = _align_frame(f, market.get("volume"))
    vwap_raw = market.get("vwap")
    if vwap_raw is None and market.get("amount") is not None and volume is not None:
        amt = _align_frame(f, market.get("amount"))
        with np.errstate(divide="ignore", invalid="ignore"):
            vwap_raw = pd.DataFrame(
                amt.to_numpy(dtype=float) / np.where(volume.to_numpy(dtype=float) > 0, volume.to_numpy(dtype=float), np.nan),
                index=f.index,
                columns=f.columns,
            )
    else:
        vwap_raw = _align_frame(f, vwap_raw)
    lup = _align_frame(f, market.get("limit_up"))
    ldn = _align_frame(f, market.get("limit_down"))
    size = _align_frame(f, market.get("log_size"))
    industry = _align_frame(f, market.get("industry"))
    close_raw = _align_frame(f, market.get("close"))

    open_px = adj_price(open_raw, adj)
    vwap_px = adj_price(vwap_raw, adj) if vwap_raw is not None else None
    close_px = adj_price(close_raw, adj) if close_raw is not None else None

    open_a = open_raw.to_numpy(dtype=float)
    high_a = high.to_numpy(dtype=float) if high is not None else None
    low_a = low.to_numpy(dtype=float) if low is not None else None
    vol_a = volume.to_numpy(dtype=float) if volume is not None else None
    lup_a = lup.to_numpy(dtype=float) if lup is not None else None
    ldn_a = ldn.to_numpy(dtype=float) if ldn is not None else None
    has_limit = lup_a is not None and ldn_a is not None

    can_buy_o, can_sell_o = limit_ok(open_a, high_a, low_a, vol_a, lup_a, ldn_a, kind="open")
    tradability: dict[str, Any] = {"open": {}, "vwap": {}, "has_limit": has_limit}

    open_rets: dict[int, np.ndarray] = {}
    for h in (1, 5, 20):
        raw = fwd_from_price(open_px, 1, 1 + h).to_numpy(dtype=float)
        masked, st = mask_hold(raw, can_buy_o, can_sell_o, 1, 1 + h)
        open_rets[h] = masked
        tradability["open"][f"h{h}"] = st

    vwap_rets: dict[int, np.ndarray] = {}
    if vwap_px is not None and vwap_raw is not None:
        ref = vwap_raw.to_numpy(dtype=float)
        can_buy_v, can_sell_v = limit_ok(ref, high_a, low_a, vol_a, lup_a, ldn_a, kind="vwap")
        v_ok = np.isfinite(ref) & (ref > 0)
        can_buy_v = can_buy_v & v_ok
        can_sell_v = can_sell_v & v_ok
        for exit_h, hold in ((2, 1), (6, 5), (21, 20)):
            raw = fwd_from_price(vwap_px, 1, exit_h).to_numpy(dtype=float)
            masked, st = mask_hold(raw, can_buy_v, can_sell_v, 1, exit_h)
            vwap_rets[hold] = masked
            tradability["vwap"][f"t1_to_t{exit_h}"] = st

    # Official diagnostics_summary close path: adj-close forward returns
    # t close -> t+H close (H=1/5/20); halt days excluded.
    close_rets: dict[int, np.ndarray] = {}
    if close_px is not None and close_raw is not None:
        close_a = close_raw.to_numpy(dtype=float)
        vol_ok = np.isfinite(vol_a) & (vol_a > 0) if vol_a is not None else np.isfinite(close_a)
        px_ok = np.isfinite(close_a) & (close_a > 0)
        can_c = vol_ok & px_ok
        tradability["close"] = {}
        for h in (1, 5, 20):
            raw = fwd_from_price(close_px, 0, h).to_numpy(dtype=float)
            masked, st = mask_hold(raw, can_c, can_c, 0, h)
            close_rets[h] = masked
            tradability["close"][f"h{h}"] = st

    idx_symbol = INDEX_SYMBOL.get(universe, "000852.SH")
    bench_series = market.index_px.get(idx_symbol)
    if bench_series is None:
        bench_series = market.index_px.get(universe)
    bench_kind = market.index_kind.get(idx_symbol) or market.index_kind.get(universe) or "unknown"
    bench_daily = _index_fwd(bench_series, dates, 1, 2) if bench_series is not None else None

    cov = coverage_report(market)
    modes = ("none",)
    if size is not None or industry is not None:
        modes = ("none", "industry", "size", "size_industry")
    titles = {
        "none": "不中性化",
        "industry": "申万一级中性化",
        "size": "市值 lncap 中性化",
        "size_industry": "行业且 lncap 中性化",
    }
    f0 = f
    out: dict[str, Any] = {
        "name": name,
        "universe": universe,
        "orientation": orientation,
        "window": {
            "start": dates[0] if dates else None,
            "end": dates[-1] if dates else None,
            "n_dates": len(dates),
            "n_stocks": len(stocks),
        },
        "coverage": float(np.isfinite(f0.to_numpy()).mean()) if f0.size else 0.0,
        "tradability": tradability,
        "benchmark": idx_symbol,
        "benchmark_kind": bench_kind,
        "market": cov,
        "labels": [1, 5, 20],
        "modes_available": list(modes),
        "timing": {
            "signal": "t日收盘后出信号（因子仅用t及以前）",
            "report_open": "t收盘信号 → t+1开盘买 → t+2/t+6/t+21开盘卖",
            "close_fwd": "复权close前向：t收盘→t+H收盘（H=1/5/20），停牌不计入",
            "vwap_trade": "t收盘信号 → t+1 VWAP买 → t+2/t+6/t+21 VWAP卖",
            "tradability": "开盘涨停不可买、开盘跌停不可卖、volume<=0停牌；VWAP剔一字板。缺字段则未过滤。",
        },
        "notes": list(market.notes),
    }
    if not has_limit:
        out["notes"].append("has_limit=false")
    if vwap_px is None:
        out["notes"].append("no_vwap")
    if bench_daily is None:
        out["notes"].append("no_index")
    if adj is None:
        out["notes"].append("no_adjfactor_used_raw_prices")

    for mode in modes:
        fm = neutralize(f0, size=size, industry=industry, mode=mode)
        f_arr = fm.to_numpy(dtype=np.float64)
        block: dict[str, Any] = {"title": titles[mode]}
        ic1, ic_series = _rank_ic_full(f_arr, open_rets[1])
        block["ic_series"] = ic_series
        block["dates"] = [str(d) for d in dates]
        for h in (1, 5, 20):
            ic, _ = _rank_ic_full(f_arr, open_rets[h])
            dec = _decile_full(f_arr, open_rets[h], hold_days=h)
            block[f"label_{h}d"] = _pack_label(ic, dec, h, dates, bench_daily if h == 1 else None)
        if vwap_rets:
            vt = {}
            for hold, rh in vwap_rets.items():
                ic, _ = _rank_ic_full(f_arr, rh)
                dec = _decile_full(f_arr, rh, hold_days=hold)
                packed = _pack_label(ic, dec, hold, dates, None)
                key = {1: "t1_to_t2", 5: "t1_to_t6", 20: "t1_to_t21"}[hold]
                vt[key] = packed
            block["vwap_trade"] = vt
        if close_rets:
            ct = {}
            for h in (1, 5, 20):
                ic, _ = _rank_ic_full(f_arr, close_rets[h])
                dec = _decile_full(f_arr, close_rets[h], hold_days=h)
                ct[f"label_{h}d"] = _pack_label(ic, dec, h, dates, None)
            block["close_fwd"] = ct
        out[mode] = block

    none = out.get("none") or {}
    l1 = none.get("label_1d") or {}
    peak = l1.get("peak_q")
    q10q9 = l1.get("q10_q9")
    q10 = ((l1.get("deciles") or {}).get("q10") or {}).get("ann_ret")
    q8 = ((l1.get("deciles") or {}).get("q8") or {}).get("ann_ret")
    ic1 = l1.get("rank_ic")
    ls_s = l1.get("ls_sharpe")
    n_days = l1.get("n_days") or l1.get("n") or 0
    reasons = []
    if n_days < 60:
        reasons.append("n_days<60")
    if peak is not None and peak <= 7:
        reasons.append("peak_q<=7")
    if q10q9 is not None and q10q9 < 0 and (q10 or 0) < (q8 or 0):
        reasons.append("q10_inverted")
    if ic1 is not None and ls_s is not None and ic1 * ls_s < 0:
        reasons.append("ic_ls_sign_mismatch")
    if "peak_q<=7" in reasons or "q10_inverted" in reasons:
        gate, note = "reject", "分层失败"
    elif n_days < 60:
        gate, note = "draft", "样本不足，仅草稿"
    elif reasons:
        gate, note = "watch", ",".join(reasons)
    else:
        gate, note = "intake_ok", "pass"
    out["intake"] = {"status": gate, "note": note, "reasons": reasons}
    # slim alias used by old catalog writers
    out["modes"] = {
        mode: {
            "rank_ic": (out[mode].get("label_1d") or {}).get("rank_ic"),
            "icir": (out[mode].get("label_1d") or {}).get("icir"),
            "t_stat": (out[mode].get("label_1d") or {}).get("t_stat"),
            "ic_positive_rate": (out[mode].get("label_1d") or {}).get("ic_positive_rate"),
            "ls_ann_ret": (out[mode].get("label_1d") or {}).get("ls_ann_ret"),
            "ls_sharpe": (out[mode].get("label_1d") or {}).get("ls_sharpe"),
            "ls_max_dd": (out[mode].get("label_1d") or {}).get("ls_max_dd"),
            "ls_tvr_avg": (out[mode].get("label_1d") or {}).get("ls_tvr_avg"),
            "peak_q": (out[mode].get("label_1d") or {}).get("peak_q"),
            "q8_ann": (((out[mode].get("label_1d") or {}).get("deciles") or {}).get("q8") or {}).get("ann_ret"),
            "q9_ann": (((out[mode].get("label_1d") or {}).get("deciles") or {}).get("q9") or {}).get("ann_ret"),
            "q10_ann": (((out[mode].get("label_1d") or {}).get("deciles") or {}).get("q10") or {}).get("ann_ret"),
            "q10_q9": (out[mode].get("label_1d") or {}).get("q10_q9"),
            "n_days": (out[mode].get("label_1d") or {}).get("n_days"),
        }
        for mode in modes
        if mode in out
    }
    return out
