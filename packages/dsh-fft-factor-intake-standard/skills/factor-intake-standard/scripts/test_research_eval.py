#!/usr/bin/env python3
"""Synthetic-market tests. No vendored OHLC, no network required."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from market_data import MarketBundle, inspect_data_dir, load_data_dir
from research_eval import evaluate_research, limit_ok
from report_html import render_report


def _synth(n_stocks=60, n_days=80, seed=1) -> tuple[pd.DataFrame, MarketBundle]:
    rng = np.random.default_rng(seed)
    stocks = [f"{600000 + i:06d}.SH" for i in range(n_stocks)]
    dates = [20240102 + i for i in range(n_days)]  # fake calendar ints, monotonic
    # keep valid YYYYMMDD-ish by using business-day-like sequence from a real start
    base = pd.bdate_range("2024-01-02", periods=n_days)
    dates = [int(d.strftime("%Y%m%d")) for d in base]
    close = 10 + np.cumsum(rng.normal(0, 0.2, size=(n_stocks, n_days)), axis=1)
    open_ = close * (1 + rng.normal(0, 0.002, size=close.shape))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.004, size=close.shape)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.004, size=close.shape)))
    volume = rng.uniform(1e5, 5e6, size=close.shape)
    amount = ((open_ + close) / 2) * volume
    vwap = amount / volume
    adj = np.ones_like(close)
    prev = np.concatenate([open_[:, :1], close[:, :-1]], axis=1)
    limit_up = prev * 1.10
    limit_down = prev * 0.90
    # lock a few names at t so tradability is not 100%
    open_[0, 10] = limit_up[0, 10]
    volume[1, 11] = 0
    idx = pd.Index(stocks, name="stock")
    cols = dates
    industry = np.tile(np.arange(n_stocks) % 8, (n_days, 1)).T.astype(float)
    log_size = np.log10(1e9 + np.abs(rng.normal(0, 2e8, size=close.shape)))
    frames = {
        "open": pd.DataFrame(open_, index=idx, columns=cols),
        "high": pd.DataFrame(high, index=idx, columns=cols),
        "low": pd.DataFrame(low, index=idx, columns=cols),
        "close": pd.DataFrame(close, index=idx, columns=cols),
        "volume": pd.DataFrame(volume, index=idx, columns=cols),
        "amount": pd.DataFrame(amount, index=idx, columns=cols),
        "vwap": pd.DataFrame(vwap, index=idx, columns=cols),
        "adjfactor": pd.DataFrame(adj, index=idx, columns=cols),
        "limit_up": pd.DataFrame(limit_up, index=idx, columns=cols),
        "limit_down": pd.DataFrame(limit_down, index=idx, columns=cols),
        "industry": pd.DataFrame(industry, index=idx, columns=cols),
        "log_size": pd.DataFrame(log_size, index=idx, columns=cols),
    }
    bench = pd.Series(np.cumprod(1 + rng.normal(0.0003, 0.01, n_days)) * 4000, index=cols)
    factor = pd.DataFrame(-open_, index=idx, columns=cols)  # cheap reversal
    bundle = MarketBundle(
        root=None,
        source={"kind": "synthetic"},
        frames=frames,
        index_px={"000852.SH": bench, "market": bench},
        index_kind={"000852.SH": "open", "market": "open"},
        calendar=np.array(cols, dtype=np.int64),
        notes=["synthetic"],
    )
    return factor, bundle


def test_limit_ok_open_lock():
    open_px = np.array([[10.0, 11.0]])
    high = np.array([[10.1, 11.0]])
    low = np.array([[9.9, 11.0]])
    vol = np.array([[100.0, 100.0]])
    up = np.array([[10.5, 11.0]])
    dn = np.array([[9.0, 9.5]])
    buy, sell = limit_ok(open_px, high, low, vol, up, dn, kind="open")
    assert buy[0, 1] == False  # open at limit-up
    assert buy[0, 0] == True


def test_research_eval_and_html(tmp_path: Path | None = None):
    factor, market = _synth()
    out = evaluate_research(factor, market, orientation=1, universe="market", name="rev")
    assert out["tradability"]["has_limit"] is True
    assert out["none"]["label_1d"]["n_days"] >= 50
    assert out["none"]["label_1d"]["ls_sharpe"] is not None
    assert out["none"]["vwap_trade"]["t1_to_t2"]["rank_ic"] is not None
    assert out["none"]["close_fwd"]["label_1d"]["rank_ic"] is not None
    assert "industry" in out and "size" in out and "size_industry" in out
    assert out["benchmark"] == "000852.SH"
    html = render_report(out)
    assert "Q10-Q1" in html
    assert "has_limit" in html
    assert 'type="radio"' in html
    assert "tab-btn" in html
    assert "neut-pages" in html
    assert "复权 close" in html
    assert "十分组明细" in html
    assert "Q10-Q1 Turnover" in html
    assert "超额L-S" in html
    assert "long_ok" in html
    assert "hero-pages" in html
    assert "viz-block" in html
    assert "分层净值" in html
    assert "IC 图" in html
    assert "十分组净值" in html
    assert "data:image/png" not in html
    assert html.count("因子总结") >= 1
    assert html.count(">结论<") >= 1
    from report_html import summarize_factor
    s = summarize_factor(out)
    assert s["lead"]
    assert s["bullets"]
    dest = Path(tmp_path or tempfile.mkdtemp()) / "t.html"
    dest.write_text(html, encoding="utf-8")
    assert dest.stat().st_size > 1000
    return out, dest


def test_discover_local_dir(tmp_path: Path):
    factor, market = _synth(n_stocks=12, n_days=15)
    root = Path(tmp_path) / "data_dir"
    root.mkdir(parents=True, exist_ok=True)
    market.frames["open"].astype("float32").to_parquet(root / "open.parquet")
    rec = inspect_data_dir(root)
    assert rec["exists"]
    loaded = load_data_dir(root)
    assert "open" in loaded.frames
    assert loaded.frames["open"].shape[0] == 12


if __name__ == "__main__":
    test_limit_ok_open_lock()
    with tempfile.TemporaryDirectory() as td:
        out, path = test_research_eval_and_html(Path(td))
        test_discover_local_dir(Path(td) / "d")
        slim = {
            "intake": out["intake"],
            "ic": out["none"]["label_1d"]["rank_ic"],
            "sr": out["none"]["label_1d"]["ls_sharpe"],
            "html": str(path),
            "has_limit": out["tradability"]["has_limit"],
        }
        print(json.dumps(slim, ensure_ascii=False, indent=2, default=str))
    print("ok")
