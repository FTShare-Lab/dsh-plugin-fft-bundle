#!/usr/bin/env python3
"""Discover and load local OpenAlpha-style market matrices. Never vendors data."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

_DATE_RE = re.compile(r"^(\d{4})-?(\d{2})-?(\d{2})")

MATRIX_FIELDS = (
    "open",
    "high",
    "low",
    "close",
    "volume",
    "amount",
    "vwap",
    "ex_factor",
    "adjfactor",
    "adj_factor",
    "limit_up",
    "limit_down",
    "prev_close",
    "industry",
    "log_size",
    "log_market_cap",
    "csi_300_close",
    "csi_300_open",
    "csi_300_weight",
    "csi_500_close",
    "csi_500_open",
    "csi_500_weight",
    "csi_1000_close",
    "csi_1000_open",
    "csi_1000_weight",
    "datestr",
    "stock_list",
)

INDEX_OPEN_CANDIDATES = {
    "csi_300_uni": ("csi_300_open", "csi_300_close", "000300.SH"),
    "csi_500_uni": ("csi_500_open", "csi_500_close", "000905.SH"),
    "csi_1000_uni": ("csi_1000_open", "csi_1000_close", "000852.SH"),
    "market": ("csi_1000_open", "csi_1000_close", "000852.SH"),
    "csi_300": ("csi_300_open", "csi_300_close", "000300.SH"),
    "csi_500": ("csi_500_open", "csi_500_close", "000905.SH"),
    "csi_1000": ("csi_1000_open", "csi_1000_close", "000852.SH"),
}

INDEX_SYMBOL = {
    "csi_300_uni": "000300.SH",
    "csi_300": "000300.SH",
    "csi_500_uni": "000905.SH",
    "csi_500": "000905.SH",
    "csi_1000_uni": "000852.SH",
    "csi_1000": "000852.SH",
    "market": "000852.SH",
}

ENV_DATA_DIR_KEYS = ("OPENALPHA_DATA_DIR", "OA_DATA_DIR", "FACTOR_MARKET_DIR", "MARKET_DATA_DIR")


def norm_date_int(raw: object) -> int | None:
    s = str(raw or "").strip().replace("-", "").replace("/", "")[:8]
    if len(s) == 8 and s.isdigit():
        y = int(s[:4])
        if 1990 <= y <= 2100:
            return int(s)
    return None


def norm_stock(raw: object) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        return ""
    s = s.replace("XSHE", "SZ").replace("XSHG", "SH")
    if s.endswith(".SZ") or s.endswith(".SH") or s.endswith(".BJ"):
        return s
    m = re.match(r"^(\d{6})", s)
    if not m:
        return s
    code = m.group(1)
    if code.startswith(("6", "9")):
        return code + ".SH"
    if code.startswith(("0", "3")):
        return code + ".SZ"
    if code.startswith(("4", "8")):
        return code + ".BJ"
    return code


def _looks_like_date(raw: object) -> bool:
    return norm_date_int(raw) is not None


def _maybe_transpose(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    idx_sample = [str(x) for x in list(df.index[:8])]
    col_sample = [str(x) for x in list(df.columns[:8])]
    idx_dates = sum(_looks_like_date(x) for x in idx_sample)
    col_dates = sum(_looks_like_date(x) for x in col_sample)
    if idx_dates >= 3 and col_dates < 3:
        return df.T
    return df


def _normalize_matrix(df: pd.DataFrame) -> pd.DataFrame:
    df = _maybe_transpose(df.copy())
    df.index = [norm_stock(i) for i in df.index]
    cols = []
    keep = []
    for c in df.columns:
        d = norm_date_int(c)
        if d is None:
            continue
        cols.append(d)
        keep.append(c)
    df = df.loc[:, keep]
    df.columns = cols
    df = df[~pd.Index(df.index).duplicated(keep="last")]
    df = df.loc[:, ~pd.Index(df.columns).duplicated(keep="last")]
    return df.sort_index().sort_index(axis=1)


def resolve_field_path(root: Path, name: str) -> Path | None:
    candidates = [
        root / name,
        root / f"{name}.parquet",
        root / f"{name}.pq",
        root / f"{name}.csv",
        root / f"{name}.CSV",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _pivot_long_csv(path: Path) -> pd.DataFrame | None:
    import csv
    from io import StringIO

    text = path.read_text(encoding="utf-8")
    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames or len(reader.fieldnames) < 3:
        return None
    fields = {(c or "").strip().lower(): c for c in reader.fieldnames}
    dcol = next((fields[a] for a in ("date", "signal_date", "trade_dt") if a in fields), None)
    scol = next((fields[a] for a in ("stock_code", "stock", "code", "s_info_windcode") if a in fields), None)
    vcol = next(
        (fields[a] for a in ("factor_value", "factor", "value", "score", "open", "close", "px") if a in fields),
        None,
    )
    if not (dcol and scol and vcol):
        return None
    rows: list[tuple[int, str, float]] = []
    for rec in reader:
        ds = norm_date_int(rec.get(dcol) or "")
        if ds is None:
            continue
        try:
            val = float(rec.get(vcol))
        except (TypeError, ValueError):
            continue
        code = norm_stock(rec.get(scol) or "")
        if not code:
            continue
        rows.append((int(ds), code, val))
    if not rows:
        return None
    long_df = pd.DataFrame(rows, columns=["date", "stock_code", "factor_value"])
    wide = long_df.pivot_table(index="stock_code", columns="date", values="factor_value", aggfunc="last")
    return wide.sort_index().sort_index(axis=1)


def read_matrix(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".csv", ".txt"}:
        pivoted = _pivot_long_csv(path)
        if pivoted is not None:
            return pivoted
        df = pd.read_csv(path)
        df = df.set_index(df.columns[0])
        return _normalize_matrix(df)
    df = pd.read_parquet(path)
    return _normalize_matrix(df)


def _read_datestr(path: Path) -> np.ndarray | None:
    try:
        if path.suffix.lower() == ".csv":
            df = pd.read_csv(path, header=None)
        else:
            df = pd.read_parquet(path)
    except Exception:
        return None
    vals = df.to_numpy().reshape(-1)
    days = [norm_date_int(v) for v in vals]
    days = [d for d in days if d is not None]
    if not days:
        return None
    return np.unique(np.array(days, dtype=np.int64))


def dir_fields(root: Path) -> dict[str, str]:
    found: dict[str, str] = {}
    if not root.exists() or not root.is_dir():
        return found
    for name in MATRIX_FIELDS:
        p = resolve_field_path(root, name)
        if p is not None:
            found[name] = str(p)
    return found


def looks_like_data_dir(root: Path) -> bool:
    names = dir_fields(root)
    return "close" in names or "open" in names


def default_search_roots() -> list[Path]:
    roots: list[Path] = []
    for key in ENV_DATA_DIR_KEYS:
        raw = (os.environ.get(key) or "").strip()
        if raw:
            roots.append(Path(raw).expanduser())
    cwd = Path.cwd()
    home = Path.home()
    roots.extend(
        [
            cwd / "data",
            cwd / "market",
            cwd / "openalpha-data",
            home / "openalpha-data",
            home / "Documents" / "openalpha-data",
            home / "Documents" / "openalpha" / "data",
            Path("/home/nolan/openalpha-data"),
            Path("/home/nolan/openalpha-data/rq/D1/20260820"),
        ]
    )
    # one extra level under *openalpha-data*/rq/D1/*
    extra: list[Path] = []
    for r in list(roots):
        if r.is_dir() and r.name != "D1":
            extra.append(r)
            d1 = r / "rq" / "D1"
            if d1.is_dir():
                extra.append(d1)
                extra.extend(sorted(p for p in d1.iterdir() if p.is_dir())[-4:])
            tus = r / "tus_bak" / "D1"
            if tus.is_dir():
                extra.extend(sorted(p for p in tus.iterdir() if p.is_dir())[-2:])
    out: list[Path] = []
    seen: set[str] = set()
    for p in roots + extra:
        key = str(p.resolve()) if p.exists() else str(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def inspect_data_dir(root: Path) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "path": str(root),
        "exists": root.exists() and root.is_dir(),
        "fields": {},
        "n_stocks": None,
        "n_dates": None,
        "date_start": None,
        "date_end": None,
        "usable": False,
        "notes": [],
    }
    if not rec["exists"]:
        rec["notes"].append("path_missing")
        return rec
    fields = dir_fields(root)
    rec["fields"] = {k: True for k in fields}
    rec["field_paths"] = fields
    probe = None
    for name in ("close", "open", "vwap"):
        if name in fields:
            try:
                probe = read_matrix(Path(fields[name]))
                break
            except Exception as exc:
                rec["notes"].append(f"read_{name}_failed:{exc}")
    if probe is not None and probe.size:
        rec["n_stocks"] = int(probe.shape[0])
        rec["n_dates"] = int(probe.shape[1])
        rec["date_start"] = int(probe.columns.min())
        rec["date_end"] = int(probe.columns.max())
    need_open = "open" in fields
    need_adj = "adjfactor" in fields or "ex_factor" in fields or "adj_factor" in fields
    rec["usable"] = bool(need_open and (need_adj or "close" in fields))
    missing = [n for n in ("open", "volume", "limit_up", "limit_down", "vwap") if n not in fields]
    if missing:
        rec["missing_preferred"] = missing
    if not need_adj:
        rec["notes"].append("no_adjfactor_unadjusted_fallback")
    return rec


def discover_data_dirs(extra: Iterable[Path | str] | None = None) -> list[dict[str, Any]]:
    roots = default_search_roots()
    if extra:
        roots = [Path(p).expanduser() for p in extra] + roots
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        candidates = [root]
        if root.is_dir() and not looks_like_data_dir(root):
            try:
                children = [p for p in root.iterdir() if p.is_dir()]
            except OSError:
                children = []
            for child in children:
                if looks_like_data_dir(child):
                    candidates.append(child)
                d1 = child / "D1"
                if d1.is_dir():
                    for leaf in sorted(p for p in d1.iterdir() if p.is_dir())[-6:]:
                        candidates.append(leaf)
        for cand in candidates:
            key = str(cand.resolve()) if cand.exists() else str(cand)
            if key in seen:
                continue
            if not looks_like_data_dir(cand) and cand != root:
                continue
            seen.add(key)
            rec = inspect_data_dir(cand)
            if rec["exists"]:
                out.append(rec)
    out.sort(key=lambda r: (not r.get("usable"), -(r.get("n_dates") or 0)))
    return out


def pick_data_dir(explicit: str | Path | None = None) -> dict[str, Any] | None:
    if explicit:
        rec = inspect_data_dir(Path(explicit).expanduser())
        return rec if rec["exists"] else rec
    found = discover_data_dirs()
    for rec in found:
        if rec.get("usable"):
            return rec
    return found[0] if found else None


@dataclass
class MarketBundle:
    root: Path | None
    source: dict[str, Any] = field(default_factory=dict)
    frames: dict[str, pd.DataFrame] = field(default_factory=dict)
    index_px: dict[str, pd.Series] = field(default_factory=dict)
    index_kind: dict[str, str] = field(default_factory=dict)
    calendar: np.ndarray | None = None
    notes: list[str] = field(default_factory=list)

    def get(self, name: str) -> pd.DataFrame | None:
        return self.frames.get(name)

    def dates(self) -> np.ndarray:
        if self.calendar is not None and self.calendar.size:
            return np.asarray(self.calendar, dtype=np.int64)
        for name in ("open", "close", "vwap"):
            fr = self.frames.get(name)
            if fr is not None and fr.shape[1]:
                return np.array([int(c) for c in fr.columns], dtype=np.int64)
        return np.array([], dtype=np.int64)


def _series_from_index_frame(df: pd.DataFrame) -> pd.Series:
    if df.shape[0] == 1:
        s = df.iloc[0]
    else:
        s = df.median(axis=0, skipna=True)
    s.index = [int(c) for c in s.index]
    return s.astype(float).sort_index()


def load_data_dir(root: Path | str) -> MarketBundle:
    root = Path(root).expanduser()
    rec = inspect_data_dir(root)
    bundle = MarketBundle(root=root, source={"kind": "local_data_dir", "path": str(root), "inspect": rec})
    if not rec["exists"]:
        bundle.notes.append("path_missing")
        return bundle
    fields: dict[str, str] = rec.get("field_paths") or {}
    for name, path_s in fields.items():
        path = Path(path_s)
        if name == "datestr":
            bundle.calendar = _read_datestr(path)
            continue
        if name == "stock_list":
            continue
        try:
            bundle.frames[name] = read_matrix(path)
        except Exception as exc:
            bundle.notes.append(f"skip_{name}:{exc}")
    if "log_size" not in bundle.frames and "log_market_cap" in bundle.frames:
        bundle.frames["log_size"] = bundle.frames["log_market_cap"]
    if "adjfactor" not in bundle.frames:
        if "adj_factor" in bundle.frames:
            bundle.frames["adjfactor"] = bundle.frames["adj_factor"]
        elif "ex_factor" in bundle.frames:
            ex = bundle.frames["ex_factor"].to_numpy(dtype=np.float64)
            ex = np.where(np.isfinite(ex), ex, 1.0)
            bundle.frames["adjfactor"] = pd.DataFrame(
                np.cumprod(ex, axis=1),
                index=bundle.frames["ex_factor"].index,
                columns=bundle.frames["ex_factor"].columns,
            )
            bundle.notes.append("adjfactor=cumprod(ex_factor)")
        else:
            bundle.notes.append("no_adjfactor")
    if bundle.calendar is None:
        bundle.calendar = bundle.dates()
    for uni, (open_name, close_name, symbol) in INDEX_OPEN_CANDIDATES.items():
        kind = None
        series = None
        if open_name in bundle.frames:
            series = _series_from_index_frame(bundle.frames[open_name])
            kind = "open"
        elif close_name in bundle.frames:
            series = _series_from_index_frame(bundle.frames[close_name])
            kind = "close"
        if series is not None and series.notna().any():
            bundle.index_px[symbol] = series
            bundle.index_kind[symbol] = kind or "close"
            bundle.index_px[uni] = series
            bundle.index_kind[uni] = kind or "close"
    return bundle


def adj_price(raw: pd.DataFrame | None, adj: pd.DataFrame | None) -> pd.DataFrame | None:
    if raw is None:
        return None
    if adj is None:
        return raw
    r = raw.copy()
    r.columns = [int(c) for c in r.columns]
    a = adj.copy()
    a.columns = [int(c) for c in a.columns]
    a = a.reindex(index=r.index, columns=r.columns)
    arr_a = a.to_numpy(dtype=np.float64)
    arr_a = np.where(np.isfinite(arr_a) & (arr_a > 0), arr_a, 1.0)
    out = r.to_numpy(dtype=np.float64) * arr_a
    return pd.DataFrame(out, index=r.index, columns=r.columns)


def universe_mask(bundle: MarketBundle, universe: str) -> pd.DataFrame | None:
    key = {
        "csi_300": "csi_300_weight",
        "csi_300_uni": "csi_300_weight",
        "csi_500": "csi_500_weight",
        "csi_500_uni": "csi_500_weight",
        "csi_1000": "csi_1000_weight",
        "csi_1000_uni": "csi_1000_weight",
    }.get(universe)
    if not key:
        return None
    w = bundle.frames.get(key)
    if w is None:
        return None
    arr = w.to_numpy(dtype=np.float64)
    return pd.DataFrame((arr > 0) & np.isfinite(arr), index=w.index, columns=w.columns)


def apply_universe(factor: pd.DataFrame, bundle: MarketBundle, universe: str) -> pd.DataFrame:
    mask = universe_mask(bundle, universe)
    if mask is None:
        return factor
    f = factor.copy()
    f.columns = [int(c) for c in f.columns]
    mask = mask.copy()
    mask.columns = [int(c) for c in mask.columns]
    mask = mask.reindex(index=f.index, columns=f.columns)
    ok = mask.fillna(False).to_numpy(dtype=bool)
    arr = np.where(ok, f.to_numpy(dtype=np.float64), np.nan)
    return pd.DataFrame(arr, index=f.index, columns=f.columns)


def coverage_report(bundle: MarketBundle) -> dict[str, Any]:
    present = sorted(bundle.frames)
    preferred = ["open", "high", "low", "close", "volume", "vwap", "adjfactor", "limit_up", "limit_down", "industry", "log_size"]
    return {
        "root": str(bundle.root) if bundle.root else None,
        "present": present,
        "missing_preferred": [n for n in preferred if n not in bundle.frames],
        "has_limit": "limit_up" in bundle.frames and "limit_down" in bundle.frames,
        "has_vwap": "vwap" in bundle.frames or ("amount" in bundle.frames and "volume" in bundle.frames),
        "index_symbols": sorted({k for k in bundle.index_px if str(k).endswith(".SH")}),
        "index_kind": {k: bundle.index_kind.get(k) for k in bundle.index_kind if str(k).endswith(".SH")},
        "n_dates": int(bundle.dates().size),
        "notes": list(bundle.notes),
        "source": bundle.source,
    }
