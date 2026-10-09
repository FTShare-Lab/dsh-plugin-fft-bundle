#!/usr/bin/env python3
"""FTShare MCP client: fill missing OHLC / limit / adj / index. Does not vendor data."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import ft_credentials
from market_data import (
    INDEX_SYMBOL,
    MarketBundle,
    load_data_dir,
    norm_date_int,
    norm_stock,
)

DEFAULT_URL = os.environ.get("FTSHARE_MCP_URL", "https://market.ft.tech/gateway/mcp")
CST = timezone(timedelta(hours=8))
API_KEY_HEADER = ft_credentials.API_KEY_NAME
# Last-resort local store. The real source is the DSH credentials document the
# FTShare settings page writes; this file only exists for a machine that keeps a
# key without DSH managing it.
FALLBACK_KEY_FILE = Path.home() / ".factor-intake" / "ftshare_api_key"


class FtshareError(RuntimeError):
    pass


def mask_api_key(key: str) -> str:
    s = (key or "").strip()
    if not s:
        return ""
    if len(s) <= 8:
        return s[:2] + "…"
    return f"{s[:4]}…{s[-4:]}（长度 {len(s)}）"


def load_api_key(explicit: str | None = None) -> str:
    """Resolve the key from the DSH credentials document or the environment.

    Precedence matches DSH: the process environment wins, then the managed
    credentials document, then `FTSHARE_API_KEY_FILE`, then
    `~/.factor-intake/ftshare_api_key`.
    """
    key, _source = ft_credentials.resolve_api_key(explicit=explicit)
    if key:
        return key
    try:
        text = FALLBACK_KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return text.splitlines()[0].strip() if text else ""


def save_api_key(key: str, path: Path | None = None) -> Path:
    text = (key or "").strip()
    if not text:
        raise FtshareError("empty api key")
    dest = Path(path) if path else FALLBACK_KEY_FILE
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text + "\n", encoding="utf-8")
    try:
        os.chmod(dest, 0o600)
    except OSError:
        pass
    return dest


def clear_api_key(path: Path | None = None) -> bool:
    dest = Path(path) if path else FALLBACK_KEY_FILE
    if dest.is_file():
        dest.unlink()
        return True
    return False


def api_key_status() -> dict[str, Any]:
    """Report where the key comes from, without exposing it.

    A credentials document that exists but cannot be trusted is reported as an
    error rather than as "not configured": the two need different fixes.
    """
    try:
        status = ft_credentials.describe_api_key()
    except ft_credentials.CredentialError as exc:
        return {
            "configured": False,
            "source": "error",
            "file": None,
            "masked": "",
            "length": 0,
            "error": str(exc),
        }
    key = load_api_key()
    return {
        "configured": bool(key),
        "source": status["source"],
        "file": status["credentials_file"] if status["credentials_file_present"] else None,
        "masked": mask_api_key(key),
        "length": len(key),
    }


def ymd_to_millis(ymd: int | str, *, hour: int, minute: int = 0) -> int:
    s = str(int(ymd))
    dt = datetime(int(s[:4]), int(s[4:6]), int(s[6:8]), hour, minute, tzinfo=CST)
    return int(dt.timestamp() * 1000)


def millis_to_ymd(ms: int) -> int:
    dt = datetime.fromtimestamp(ms / 1000.0, tz=CST)
    return int(dt.strftime("%Y%m%d"))


class FtshareClient:
    def __init__(self, url: str | None = None, timeout: float = 40.0, api_key: str | None = None):
        self.url = (url or DEFAULT_URL).rstrip("/")
        self.timeout = timeout
        self.session_id: str | None = None
        self.api_key = load_api_key(api_key)

    def _post(self, payload: dict[str, Any]) -> tuple[dict[str, str], str]:
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers[API_KEY_HEADER] = self.api_key
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                hdrs = {k.lower(): v for k, v in resp.headers.items()}
                return hdrs, body
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise FtshareError(f"HTTP {exc.code}: {body[:800]}") from None
        except urllib.error.URLError as exc:
            raise FtshareError(f"network: {exc.reason}") from None

    @staticmethod
    def _events(body: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for raw in body.splitlines():
            line = raw.strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data:
                continue
            try:
                out.append(json.loads(data))
            except json.JSONDecodeError:
                continue
        if not out:
            try:
                obj = json.loads(body)
                if isinstance(obj, dict):
                    out.append(obj)
            except json.JSONDecodeError:
                pass
        return out

    def initialize(self) -> None:
        hdrs, _body = self._post(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "factor-intake-standard", "version": "1"},
                },
            }
        )
        sid = hdrs.get("mcp-session-id")
        if not sid:
            raise FtshareError("initialize did not return Mcp-Session-Id")
        self.session_id = sid
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def call(self, name: str, arguments: dict[str, Any], *, retries: int = 3) -> Any:
        if not self.session_id:
            self.initialize()
        last: Any = None
        for attempt in range(retries):
            _, body = self._post(
                {
                    "jsonrpc": "2.0",
                    "id": 10 + attempt,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": arguments},
                }
            )
            payload = None
            for ev in self._events(body):
                if "error" in ev and ev.get("id") is not None:
                    last = ev["error"]
                    payload = ev["error"]
                    break
                res = ev.get("result")
                if not isinstance(res, dict):
                    continue
                if res.get("isError"):
                    texts = [c.get("text") for c in (res.get("content") or []) if isinstance(c, dict)]
                    last = {"isError": True, "text": texts}
                    payload = last
                    break
                if res.get("structuredContent") is not None:
                    payload = res["structuredContent"]
                    break
                texts = [c.get("text") for c in (res.get("content") or []) if isinstance(c, dict) and c.get("text")]
                if texts:
                    raw = "\n".join(texts)
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError:
                        payload = raw
                    break
            if isinstance(payload, dict) and (
                payload.get("code") == "UPSTREAM_UNAVAILABLE"
                or (isinstance(payload.get("error"), dict) and payload["error"].get("code") == "UPSTREAM_UNAVAILABLE")
            ):
                last = payload
                time.sleep(0.4 * (attempt + 1))
                continue
            if payload is None:
                last = body[:500]
                time.sleep(0.2 * (attempt + 1))
                continue
            return payload
        raise FtshareError(f"{name} failed after retries: {last}")


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            return [x for x in payload["data"] if isinstance(x, dict)]
        if isinstance(payload.get("items"), list):
            return [x for x in payload["items"] if isinstance(x, dict)]
        if isinstance(payload.get("error"), dict):
            raise FtshareError(json.dumps(payload["error"], ensure_ascii=False))
        if payload.get("code") and payload.get("message"):
            raise FtshareError(json.dumps(payload, ensure_ascii=False))
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    raise FtshareError(f"unexpected payload: {str(payload)[:400]}")


def _f(v: Any) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return float("nan")
    return x


def fetch_stock_ohlc(client: FtshareClient, symbol: str, start: int, end: int) -> pd.DataFrame:
    payload = client.call(
        "ft_v1_stock_candlesticks",
        {
            "symbol": symbol,
            "interval_unit": "day",
            "since_ts_millis": ymd_to_millis(start, hour=9, minute=15),
            "until_ts_millis": ymd_to_millis(end, hour=16, minute=0),
            "adjust_kind": "none",
        },
    )
    rows = []
    for rec in _rows(payload):
        ts = rec.get("ts_millis") or rec.get("ts_millis_open")
        d = millis_to_ymd(int(ts)) if ts is not None else norm_date_int(rec.get("trade_date") or rec.get("date"))
        if d is None:
            continue
        vol = _f(rec.get("volume"))
        turnover = _f(rec.get("turnover") if rec.get("turnover") is not None else rec.get("amount"))
        vwap = turnover / vol if vol > 0 and np.isfinite(turnover) else float("nan")
        rows.append(
            {
                "date": int(d),
                "open": _f(rec.get("open")),
                "high": _f(rec.get("high")),
                "low": _f(rec.get("low")),
                "close": _f(rec.get("close")),
                "volume": vol,
                "amount": turnover,
                "vwap": vwap,
            }
        )
    return pd.DataFrame(rows).drop_duplicates("date").sort_values("date")


def fetch_stock_limits(client: FtshareClient, symbol: str, start: int, end: int) -> pd.DataFrame:
    page, page_size, rows = 1, 200, []
    while True:
        payload = client.call(
            "ft_v1_stk_limit",
            {
                "symbol": symbol,
                "start_date": int(start),
                "end_date": int(end),
                "page": page,
                "page_size": page_size,
            },
        )
        chunk = _rows(payload)
        rows.extend(chunk)
        meta = payload.get("metadata") if isinstance(payload, dict) else {}
        pag = (meta or {}).get("pagination") or {}
        if not pag.get("has_more"):
            break
        page += 1
        if page > 50:
            break
    out = []
    for rec in rows:
        d = norm_date_int(rec.get("trade_date"))
        if d is None:
            continue
        out.append(
            {
                "date": int(d),
                "limit_up": _f(rec.get("up_limit") if rec.get("up_limit") is not None else rec.get("limit_up")),
                "limit_down": _f(rec.get("down_limit") if rec.get("down_limit") is not None else rec.get("limit_down")),
                "prev_close": _f(rec.get("pre_close") if rec.get("pre_close") is not None else rec.get("prev_close")),
            }
        )
    return pd.DataFrame(out).drop_duplicates("date").sort_values("date")


def fetch_adj_factor(client: FtshareClient, symbol: str, start: int, end: int) -> pd.DataFrame:
    payload = client.call(
        "ft_v1_stock_adjust_factor",
        {"symbol": symbol, "start_date": str(int(start)), "end_date": str(int(end)), "limit": 5000},
    )
    out = []
    for rec in _rows(payload):
        d = norm_date_int(rec.get("trade_date"))
        if d is None:
            continue
        cum = rec.get("ex_adj_factor")
        daily = rec.get("adj_factor")
        val = _f(cum) if cum is not None else _f(daily)
        if not np.isfinite(val) or val <= 0:
            val = 1.0
        out.append({"date": int(d), "adjfactor": float(val)})
    return pd.DataFrame(out).drop_duplicates("date").sort_values("date")


def fetch_index_ohlc(client: FtshareClient, symbol: str, start: int, end: int) -> pd.DataFrame:
    payload = client.call(
        "ft_v1_index_candlesticks",
        {
            "symbol": symbol,
            "interval_unit": "day",
            "since_ts_millis": ymd_to_millis(start, hour=9, minute=15),
            "until_ts_millis": ymd_to_millis(end, hour=16, minute=0),
        },
    )
    rows = []
    for rec in _rows(payload):
        ts = rec.get("ts_millis") or rec.get("ts_millis_open")
        d = millis_to_ymd(int(ts)) if ts is not None else norm_date_int(rec.get("trade_date"))
        if d is None:
            continue
        rows.append({"date": int(d), "open": _f(rec.get("open")), "close": _f(rec.get("close"))})
    return pd.DataFrame(rows).drop_duplicates("date").sort_values("date")


def probe(url: str | None = None, api_key: str | None = None) -> dict[str, Any]:
    client = FtshareClient(url=url, api_key=api_key)
    status = api_key_status() if not api_key else {
        "configured": bool(client.api_key),
        "source": "explicit",
        "masked": mask_api_key(client.api_key),
        "length": len(client.api_key),
    }
    try:
        client.initialize()
        sample = fetch_stock_ohlc(client, "600000.SH", 20260601, 20260610)
        return {
            "ok": True,
            "url": client.url,
            "n_ohlc": int(len(sample)),
            "session": True,
            "auth": status,
        }
    except Exception as exc:
        return {
            "ok": False,
            "url": url or DEFAULT_URL,
            "error": str(exc),
            "auth": status,
        }


def _long_to_wide(rows: list[tuple[str, int, float]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["stock", "date", "value"])
    wide = df.pivot_table(index="stock", columns="date", values="value", aggfunc="last")
    return wide.sort_index().sort_index(axis=1)


def _merge_frame(base: pd.DataFrame | None, extra: pd.DataFrame) -> pd.DataFrame:
    if extra is None or extra.empty:
        return base if base is not None else pd.DataFrame()
    if base is None or base.empty:
        return extra
    both = base.copy()
    for col in extra.columns:
        if col not in both.columns:
            both[col] = np.nan
    both = both.sort_index(axis=1)
    extra = extra.reindex(columns=both.columns)
    for idx in extra.index:
        if idx not in both.index:
            both.loc[idx] = np.nan
        src = extra.loc[idx]
        dst = both.loc[idx]
        take = ~np.isfinite(dst.to_numpy(dtype=float)) & np.isfinite(src.to_numpy(dtype=float))
        if np.any(take):
            dst = dst.copy()
            dst.iloc[np.flatnonzero(take)] = src.iloc[np.flatnonzero(take)]
            both.loc[idx] = dst
    return both.sort_index().sort_index(axis=1)


def default_cache_dir() -> Path:
    env = (os.environ.get("FACTOR_MARKET_CACHE") or "").strip()
    if env:
        return Path(env).expanduser()
    return Path.home() / ".factor-intake" / "market_cache"


def _load_symbol_cache(cache_dir: Path, kind: str, symbol: str, start: int, end: int) -> pd.DataFrame | None:
    p = cache_dir / "symbols" / kind / f"{symbol}.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    if "date" not in df.columns:
        return None
    df["date"] = df["date"].map(lambda x: int(norm_date_int(x) or 0))
    df = df[(df["date"] >= start) & (df["date"] <= end)]
    return df if len(df) else None


def _save_symbol_cache(cache_dir: Path, kind: str, symbol: str, df: pd.DataFrame) -> None:
    d = cache_dir / "symbols" / kind
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{symbol}.csv"
    if p.exists() and not df.empty:
        old = pd.read_csv(p)
        both = pd.concat([old, df], ignore_index=True)
        both = both.drop_duplicates("date", keep="last").sort_values("date")
        both.to_csv(p, index=False)
    else:
        df.to_csv(p, index=False)


def fill_from_ftshare(
    stocks: list[str],
    start: int,
    end: int,
    *,
    cache_dir: Path | None = None,
    existing: MarketBundle | None = None,
    universe: str = "market",
    url: str | None = None,
    max_stocks: int = 400,
    fetch_index: bool = True,
) -> MarketBundle:
    """Fetch missing names via FTShare and merge onto any local matrices.

    Writes a user-local cache (default ~/.factor-intake/market_cache). Does not
    ship market data inside the skill.
    """
    stocks = [norm_stock(s) for s in stocks if norm_stock(s)]
    stocks = sorted(set(stocks))
    if len(stocks) > max_stocks:
        raise FtshareError(
            f"FTShare fill refused: {len(stocks)} names > --ftshare-max-stocks={max_stocks}. "
            "Point --data-dir at a local OpenAlpha matrix instead."
        )
    cache_dir = Path(cache_dir or default_cache_dir())
    cache_dir.mkdir(parents=True, exist_ok=True)
    frames: dict[str, pd.DataFrame] = {}
    if existing is not None:
        for k, fr in existing.frames.items():
            frames[k] = fr.copy()

    def missing(stock: str, field: str) -> bool:
        fr = frames.get(field)
        if fr is None or fr.empty or stock not in fr.index:
            return True
        cols = [c for c in fr.columns if int(start) <= int(c) <= int(end)]
        if not cols:
            return True
        return not np.isfinite(fr.loc[stock, cols].to_numpy(dtype=float)).any()

    todo_ohlc = [s for s in stocks if any(missing(s, f) for f in ("open", "high", "low", "close", "volume"))]
    todo_lim = [s for s in stocks if any(missing(s, f) for f in ("limit_up", "limit_down"))]
    todo_adj = [s for s in stocks if missing(s, "adjfactor")]
    notes = [
        f"ftshare_fill stocks={len(stocks)} ohlc={len(todo_ohlc)} limit={len(todo_lim)} adj={len(todo_adj)} window={start}-{end}"
    ]
    client = FtshareClient(url=url)
    if todo_ohlc or todo_lim or todo_adj or fetch_index:
        client.initialize()
        notes.append("ftshare_session=ok")

    ohlc_rows: dict[str, list[tuple[str, int, float]]] = {
        k: [] for k in ("open", "high", "low", "close", "volume", "amount", "vwap")
    }
    lim_up: list[tuple[str, int, float]] = []
    lim_dn: list[tuple[str, int, float]] = []
    prev_c: list[tuple[str, int, float]] = []
    adj_rows: list[tuple[str, int, float]] = []

    def ingest_ohlc(symbol: str, df: pd.DataFrame) -> None:
        for rec in df.itertuples(index=False):
            d = int(rec.date)
            for fld in ohlc_rows:
                ohlc_rows[fld].append((symbol, d, float(getattr(rec, fld))))

    for i, symbol in enumerate(todo_ohlc):
        cached = _load_symbol_cache(cache_dir, "ohlc", symbol, start, end)
        if cached is not None and len(cached) >= 3:
            ingest_ohlc(symbol, cached)
            continue
        try:
            df = fetch_stock_ohlc(client, symbol, start, end)
            if not df.empty:
                _save_symbol_cache(cache_dir, "ohlc", symbol, df)
                ingest_ohlc(symbol, df)
        except Exception as exc:
            notes.append(f"ohlc_fail {symbol}: {exc}")
        if i and i % 20 == 0:
            time.sleep(0.05)

    for symbol in todo_lim:
        cached = _load_symbol_cache(cache_dir, "limit", symbol, start, end)
        df = cached
        if df is None:
            try:
                df = fetch_stock_limits(client, symbol, start, end)
                if not df.empty:
                    _save_symbol_cache(cache_dir, "limit", symbol, df)
            except Exception as exc:
                notes.append(f"limit_fail {symbol}: {exc}")
                df = None
        if df is None or df.empty:
            continue
        for rec in df.itertuples(index=False):
            d = int(rec.date)
            lim_up.append((symbol, d, float(rec.limit_up)))
            lim_dn.append((symbol, d, float(rec.limit_down)))
            if hasattr(rec, "prev_close"):
                prev_c.append((symbol, d, float(rec.prev_close)))

    for symbol in todo_adj:
        cached = _load_symbol_cache(cache_dir, "adj", symbol, start, end)
        df = cached
        if df is None:
            try:
                df = fetch_adj_factor(client, symbol, start, end)
                if not df.empty:
                    _save_symbol_cache(cache_dir, "adj", symbol, df)
            except Exception as exc:
                notes.append(f"adj_fail {symbol}: {exc}")
                df = None
        if df is None or df.empty:
            continue
        for rec in df.itertuples(index=False):
            adj_rows.append((symbol, int(rec.date), float(rec.adjfactor)))

    for fld, rows in ohlc_rows.items():
        frames[fld] = _merge_frame(frames.get(fld), _long_to_wide(rows))
    frames["limit_up"] = _merge_frame(frames.get("limit_up"), _long_to_wide(lim_up))
    frames["limit_down"] = _merge_frame(frames.get("limit_down"), _long_to_wide(lim_dn))
    frames["prev_close"] = _merge_frame(frames.get("prev_close"), _long_to_wide(prev_c))
    frames["adjfactor"] = _merge_frame(frames.get("adjfactor"), _long_to_wide(adj_rows))

    index_px: dict[str, pd.Series] = dict(existing.index_px) if existing else {}
    index_kind: dict[str, str] = dict(existing.index_kind) if existing else {}
    idx_symbol = INDEX_SYMBOL.get(universe, "000852.SH")
    if fetch_index and idx_symbol not in index_px:
        try:
            idf = fetch_index_ohlc(client, idx_symbol, start, end)
            if not idf.empty:
                s = pd.Series(idf["open"].to_numpy(dtype=float), index=idf["date"].astype(int))
                index_px[idx_symbol] = s
                index_kind[idx_symbol] = "open"
                notes.append(f"index {idx_symbol} from ftshare open, n={len(s)}")
        except Exception as exc:
            notes.append(f"index_fail {idx_symbol}: {exc}")

    # persist merged matrices for reuse
    matrix_dir = cache_dir / "matrix"
    matrix_dir.mkdir(parents=True, exist_ok=True)
    frames = {k: v.sort_index().sort_index(axis=1) for k, v in frames.items() if v is not None and not v.empty}
    for name, fr in frames.items():
        try:
            fr.astype("float32").to_parquet(matrix_dir / f"{name}.parquet")
        except Exception:
            fr.to_csv(matrix_dir / f"{name}.csv")
    (cache_dir / "ftshare_meta.json").write_text(
        json.dumps({"start": start, "end": end, "n_stocks": len(stocks), "notes": notes}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    cal = None
    open_fr = frames.get("open")
    if open_fr is not None and open_fr.shape[1]:
        cal = np.array([int(c) for c in open_fr.columns], dtype=np.int64)
    bundle = MarketBundle(
        root=matrix_dir,
        source={"kind": "ftshare_fill", "url": url or DEFAULT_URL, "cache": str(cache_dir)},
        frames=frames,
        index_px=index_px,
        index_kind=index_kind,
        calendar=cal,
        notes=notes,
    )
    return bundle


def resolve_market(
    *,
    data_dir: str | None,
    ftshare: bool,
    stocks: list[str],
    start: int | None,
    end: int | None,
    universe: str,
    cache_dir: str | None = None,
    ftshare_url: str | None = None,
    max_stocks: int = 400,
) -> MarketBundle:
    existing = None
    if data_dir:
        existing = load_data_dir(data_dir)
    if not ftshare:
        if existing is None:
            raise FtshareError(
                "no --data-dir and --ftshare not set. Run `factor_lib.py discover` "
                "or pass --ftshare to fill missing names from FTShare."
            )
        return existing
    if start is None or end is None:
        raise FtshareError("FTShare fill needs a date window (from the factor panel)")
    return fill_from_ftshare(
        stocks,
        int(start),
        int(end),
        cache_dir=Path(cache_dir) if cache_dir else None,
        existing=existing,
        universe=universe,
        url=ftshare_url,
        max_stocks=max_stocks,
    )



