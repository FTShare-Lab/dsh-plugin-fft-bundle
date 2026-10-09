#!/usr/bin/env python3
"""Standalone HTML research report. Matplotlib PNG if present, else SVG."""
from __future__ import annotations

import base64
import html
import io
import os
import socket
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import numpy as np


def _esc(x: Any) -> str:
    return html.escape("" if x is None else str(x))


def _fmt(x: Any, pct: bool = False, nd: int = 4) -> str:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "—"
    if pct:
        return f"{v * 100:.2f}%"
    return f"{v:.{nd}f}"


def _signed(x: Any, pct: bool = False, nd: int = 4) -> str:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "—"
    body = f"{v * 100:.2f}%" if pct else f"{v:.{nd}f}"
    if v > 0:
        return "+" + body
    return body


def _num_class(x: Any) -> str:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "na"
    if v > 0:
        return "pos"
    if v < 0:
        return "neg"
    return "zero"


def _td(x: Any, pct: bool = False, nd: int = 4, *, signed: bool = False) -> str:
    txt = _signed(x, pct=pct, nd=nd) if signed else _fmt(x, pct=pct, nd=nd)
    return f'<td class="{_num_class(x)}">{txt}</td>'


# matplotlib tab:* palette used by the original 十分组 / IC panels
TAB_COLORS = (
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
)


def _as_label(block: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(block, dict):
        return {}
    if isinstance(block.get("label_1d"), dict):
        return block
    # evaluate_local slim shape: modes.none already is a 1d KPI dict
    if "rank_ic" in block or "ls_sharpe" in block:
        return {"label_1d": block}
    return block


def summarize_factor(
    diag: dict[str, Any],
    *,
    neighbors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Plain-language verdict used at the top and bottom of the report."""
    none = diag.get("none") if isinstance(diag.get("none"), dict) else None
    if none is None and isinstance(diag.get("modes"), dict):
        none = diag["modes"].get("none")
    none = _as_label(none)
    l1 = none.get("label_1d") or {}
    l5 = none.get("label_5d") or {}
    l20 = none.get("label_20d") or {}
    vt = ((none.get("vwap_trade") or {}).get("t1_to_t2") or {})
    intake = diag.get("intake") or {}
    window = diag.get("window") or {}
    tb = diag.get("tradability") or {}
    market = diag.get("market") or {}
    notes = list(diag.get("notes") or [])
    status = str(intake.get("status") or "unrated")
    reasons = list(intake.get("reasons") or [])
    peak = l1.get("peak_q")
    q10q9 = l1.get("q10_q9")
    ic = l1.get("rank_ic")
    sr = l1.get("ls_sharpe")
    ann = l1.get("ls_ann_ret")
    icir = l1.get("icir")
    n_days = l1.get("n_days") or l1.get("n") or window.get("n_dates")
    has_limit = tb.get("has_limit")
    missing = list(market.get("missing_preferred") or [])
    headline_map = {
        "intake_ok": "可入库（watch 级以上仍要看分层与相关）",
        "watch": "可观察，未过全部门禁",
        "draft": "草稿：样本不足，不能当正式因子",
        "reject": "默认不入库",
        "duplicate": "与库内近复制，不双挂",
        "unrated": "未评级：方向或数据未齐",
    }
    bullets: list[str] = []
    bullets.append(
        f"{diag.get('name') or 'unnamed'} · universe={diag.get('universe') or '—'} · "
        f"orientation={diag.get('orientation') if diag.get('orientation') is not None else '未声明'} · "
        f"{window.get('start') or '—'}–{window.get('end') or '—'} · n_dates={window.get('n_dates') or '—'}"
    )
    bullets.append(
        f"主KPI（不中性化开盘 1 日 Q10−Q1）：RankIC={_signed(ic)} · ICIR={_fmt(icir)} · "
        f"Sharpe={_fmt(sr)} · AnnRet={_fmt(ann, True)} · peak_q={peak if peak is not None else '—'} · "
        f"Q10−Q9={_fmt(q10q9, True)} · n={n_days if n_days is not None else '—'}"
    )
    if peak is not None and int(peak) <= 7:
        bullets.append(f"分层失败：峰值在 Q{int(peak)}，不在 Q8–Q10。")
    elif q10q9 is not None and float(q10q9) < 0:
        bullets.append("分层偏弱：Q10 年化低于 Q9。")
    else:
        bullets.append(f"分层：峰值 Q{peak}，Q10−Q9 为 {_fmt(q10q9, True)}。")
    if ic is not None and sr is not None:
        try:
            if float(ic) * float(sr) < 0:
                bullets.append("RankIC 与 Q10−Q1 Sharpe 符号相反，不能只报 IC。")
            elif float(ic) > 0 and float(sr) > 0:
                bullets.append("RankIC 与多空 Sharpe 同为正。")
            elif float(ic) < 0 and float(sr) < 0:
                bullets.append("RankIC 与多空 Sharpe 同为负；若方向已冻结，这是反向证据，不是自动翻号的理由。")
        except (TypeError, ValueError):
            pass
    if l5.get("rank_ic") is not None or l20.get("rank_ic") is not None:
        bullets.append(
            f"更长窗口 RankIC：5d={_signed(l5.get('rank_ic'))} · 20d={_signed(l20.get('rank_ic'))}。"
        )
    if vt.get("ls_sharpe") is not None:
        bullets.append(
            f"VWAP 1 日对照：Sharpe={_fmt(vt.get('ls_sharpe'))} · AnnRet={_fmt(vt.get('ls_ann_ret'), True)} · "
            f"RankIC={_signed(vt.get('rank_ic'))}。"
        )
    open_ok = ((tb.get("open") or {}).get("h1") or {}).get("frac_either_ok")
    if open_ok is not None:
        bullets.append(f"开盘 1 日可交易（多空任一侧）={_fmt(open_ok)}；has_limit={has_limit}。")
    if has_limit is False:
        bullets.append("未提供涨跌停，只做停牌过滤，不得声称已做涨跌停过滤。")
    if missing:
        bullets.append("市场字段缺失：" + "、".join(str(x) for x in missing) + "。")
    if notes:
        bullets.append("备注：" + "；".join(str(x) for x in notes[:6]))
    neigh = neighbors if neighbors is not None else diag.get("neighbors")
    dup_line = "未与因子库比过相关。"
    if neigh:
        top = neigh[0] if isinstance(neigh[0], dict) else None
        if top:
            dec = top.get("decision") or "keep"
            dup_line = (
                f"库内最近邻 {top.get('factor_id') or top.get('name')}："
                f"RankCorr={_fmt(top.get('rank_corr'))} · Q10 Jaccard={_fmt(top.get('q10_jaccard'))} · {dec}。"
            )
            if dec == "duplicate":
                status = "duplicate"
    bullets.append(dup_line)
    if reasons:
        bullets.append("门禁原因：" + "、".join(str(x) for x in reasons) + "。")
    bullets.append(
        "主数字永远是分层 Q10−Q1，不是仿真账面 AnnRet。成本未计入；未声称样本外。"
    )
    headline = f"{headline_map.get(status, status)}（{intake.get('note') or status}）"
    lead = (
        f"{headline} 开盘1日 RankIC {_signed(ic)}，Q10−Q1 Sharpe {_fmt(sr)}，"
        f"峰值 Q{peak if peak is not None else '—'}。"
    )
    return {
        "status": status,
        "headline": headline,
        "lead": lead,
        "bullets": bullets,
        "kpis": {
            "rank_ic": ic,
            "icir": icir,
            "ls_sharpe": sr,
            "ls_ann_ret": ann,
            "peak_q": peak,
            "q10_q9": q10q9,
            "n_days": n_days,
            "vwap_ls_sharpe": vt.get("ls_sharpe"),
        },
    }


def summary_html(summary: dict[str, Any], *, heading: str) -> str:
    items = "".join(f"<li>{_esc(b)}</li>" for b in summary.get("bullets") or [])
    status = str(summary.get("status") or "")
    return f"""
<section class="summary status-{_esc(status)}">
  <h2>{_esc(heading)}</h2>
  <p class="lead">{_esc(summary.get('lead'))}</p>
  <ul>{items}</ul>
</section>
"""


def summary_text(summary: dict[str, Any]) -> str:
    lines = [str(summary.get("headline") or ""), str(summary.get("lead") or "")]
    for b in summary.get("bullets") or []:
        lines.append("- " + str(b))
    return "\n".join(lines).strip() + "\n"


def report_stamp(host: str | None = None) -> tuple[str, str, str]:
    raw = (host or os.getenv("OPENALPHA_DEV_HOST") or "").strip()
    if not raw:
        hn = (socket.gethostname() or "unknown").split(".")[0]
        raw = hn if hn.lower().startswith("ft") else "local"
    now = datetime.now()
    stamp = now.strftime("%Y%m%d%H%M%S") + f"{now.microsecond // 1000:03d}"
    host_s = raw.split(".")[0][:48] or "local"
    title = f"因子评价报告-{host_s}-Factor-{stamp}"
    return host_s, stamp, title


def default_report_dir() -> Path:
    env = os.getenv("FACTOR_REPORT_DIR") or os.getenv("OPENALPHA_REPORT_DIR") or ""
    if env.strip():
        return Path(env).expanduser()
    mac = Path.home() / "Documents" / "openalpha" / "reports"
    if mac.parent.exists():
        return mac
    return Path.cwd() / "reports"


def _setup_mpl():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.sans-serif"] = ["Arial Unicode MS", "PingFang SC", "SimHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    return plt


def _as_datetimes(dates: list[str] | None):
    if not dates:
        return None
    xs = []
    for d in dates:
        s = str(d).strip().replace("-", "")
        if len(s) >= 8 and s[:8].isdigit():
            try:
                xs.append(datetime(int(s[:4]), int(s[4:6]), int(s[6:8])))
            except ValueError:
                return None
        else:
            return None
    return xs or None


def _xvals(dates: list[str] | None, n: int):
    if dates:
        xs = _as_datetimes(list(dates)[:n])
        if xs and len(xs) == n:
            return xs, True
    return list(range(n)), False


def _style_date_axis(ax):
    import matplotlib.dates as mdates

    loc = mdates.AutoDateLocator()
    ax.xaxis.set_major_locator(loc)
    ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(loc))
    ax.set_xlabel("日期")


def _fig_to_b64(fig, plt) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _ma(x: np.ndarray, w: int = 21) -> np.ndarray:
    if len(x) == 0:
        return x
    k = np.ones(w) / w
    y = np.convolve(np.nan_to_num(x, nan=0.0), k, mode="same")
    y[: w - 1] = np.nan
    return y


def render_nav_panel(block: dict[str, Any]) -> str:
    try:
        plt = _setup_mpl()
    except Exception:
        return ""
    l1 = block.get("label_1d") or {}
    dec = l1.get("deciles") or {}
    excess = l1.get("excess") if isinstance(l1.get("excess"), dict) else {}
    qex = excess.get("deciles") or {}
    ls = np.array(l1.get("ls_daily") or [], dtype=float)
    ex_ls = np.array(excess.get("daily") or [], dtype=float)
    udates = l1.get("used_dates") or []
    colors = [
        "tab:blue",
        "tab:orange",
        "tab:green",
        "tab:red",
        "tab:purple",
        "tab:brown",
        "tab:pink",
        "tab:gray",
        "tab:olive",
        "tab:cyan",
    ]
    fig, axes = plt.subplots(2, 3, figsize=(16, 8.2))
    fig.suptitle(block.get("title") or "", fontsize=12)
    keys = [f"q{i}" for i in range(1, 11)]
    ax = axes[0, 0]
    ax.bar(range(1, 11), [float((dec.get(k) or {}).get("ann_ret") or 0) for k in keys], color=colors)
    ax.set_title("十分组 AnnRet")
    ax.grid(axis="y", linestyle="--", alpha=0.5)
    ax = axes[0, 1]
    q_n = 0
    for i in range(1, 11):
        daily = np.array((dec.get(f"q{i}") or {}).get("daily") or [], dtype=float)
        if daily.size > 2:
            x, is_date = _xvals(udates, len(daily))
            ax.plot(x, np.cumprod(1 + daily), lw=0.9, label=f"q{i}")
            q_n = len(daily)
    ax.set_title("十分组净值")
    ax.legend(fontsize=7, ncol=2, frameon=True)
    if q_n:
        x, is_date = _xvals(udates, q_n)
        if is_date:
            _style_date_axis(ax)
    ax = axes[0, 2]
    if ls.size > 2:
        x, is_date = _xvals(udates, len(ls))
        ax.plot(x, np.cumprod(1 + ls), color="tab:blue", lw=1.4, label="L-S Q10-Q1")
        if is_date:
            _style_date_axis(ax)
    ax.set_title("L-S 净值（Q10−Q1）")
    ax.legend(frameon=True)
    ax = axes[1, 0]
    ax.bar(range(1, 11), [float((dec.get(k) or {}).get("excess_ann_ret") or 0) for k in keys], color=colors)
    ax.set_title("十分组超额 AnnRet")
    ax.grid(axis="y", linestyle="--", alpha=0.5)
    ax = axes[1, 1]
    q_n = 0
    for i in range(1, 11):
        daily = np.array(qex.get(f"q{i}") or (dec.get(f"q{i}") or {}).get("excess_daily") or [], dtype=float)
        if daily.size > 2:
            x, is_date = _xvals(udates, len(daily))
            ax.plot(x, np.cumprod(1 + daily), lw=0.9, label=f"q{i}-B")
            q_n = len(daily)
    ax.set_title("相对基准超额净值")
    if q_n:
        x, is_date = _xvals(udates, q_n)
        if is_date:
            _style_date_axis(ax)
    ax.legend(fontsize=7, ncol=2, frameon=True)
    ax = axes[1, 2]
    series = ex_ls if ex_ls.size > 2 else ls
    if series.size > 2:
        x, is_date = _xvals(udates, len(series))
        ax.plot(x, np.cumprod(1 + series), color="tab:orange", lw=1.4, label="L-S excess")
        if is_date:
            _style_date_axis(ax)
    ax.set_title("超额 L-S 净值")
    ax.legend(frameon=True)
    fig.tight_layout()
    return _fig_to_b64(fig, plt)


def render_eight_panel(block: dict[str, Any]) -> str:
    try:
        plt = _setup_mpl()
    except Exception:
        return ""
    ic = np.array(block.get("ic_series") or [], dtype=float)
    if ic.size == 0:
        return ""
    n = len(ic)
    dts = list((block.get("dates") or [])[:n])
    if len(dts) < n:
        dts = dts + [str(i) for i in range(len(dts), n)]
    l1 = block.get("label_1d") or {}
    dec = l1.get("deciles") or {}
    q10 = np.array((dec.get("q10") or {}).get("daily") or [], dtype=float)
    q1 = np.array((dec.get("q1") or {}).get("daily") or [], dtype=float)
    ls = np.array(l1.get("ls_daily") or [], dtype=float)
    fig, axes = plt.subplots(4, 2, figsize=(14, 16))
    if block.get("title"):
        fig.suptitle(block["title"], fontsize=14)
    x_ic, ic_is_date = _xvals(dts, n)
    ax = axes[0, 0]
    ax.plot(x_ic, ic, color="tab:blue", lw=0.8, label="rank_ic")
    ax.plot(x_ic, _ma(ic, 21), color="tab:orange", lw=1.2, label="rank_ic_21mean")
    ax.set_title("IC")
    ax.legend(loc="lower right", frameon=True)
    if ic_is_date:
        _style_date_axis(ax)
    ax = axes[0, 1]
    ax.plot(x_ic, np.cumsum(np.nan_to_num(ic)), color="tab:blue", lw=1.0, label="max_cumsum")
    ax.plot(x_ic, np.cumsum(np.nan_to_num(-ic)), color="tab:orange", lw=1.0, label="min_cumsum")
    ax.set_title("IC累加")
    ax.legend(frameon=True)
    if ic_is_date:
        _style_date_axis(ax)
    years = np.array([int(d[:4]) if str(d)[:4].isdigit() else 0 for d in dts[:n]])
    months = np.array([int(str(d)[4:6]) if len(str(d)) >= 6 and str(d)[4:6].isdigit() else 0 for d in dts[:n]])
    uniq_years = sorted({y for y in years.tolist() if y >= 2000})
    month_ir = {y: np.full(12, np.nan) for y in uniq_years}
    month_mean = {y: np.full(12, np.nan) for y in uniq_years}
    year_ir, year_mean = [], []
    for y in uniq_years:
        ym = ic[years == y]
        year_mean.append(float(np.nanmean(ym)) if ym.size else np.nan)
        std = float(np.nanstd(ym, ddof=1)) if ym.size > 1 else np.nan
        year_ir.append(float(np.nanmean(ym) / std) if std and std > 0 else np.nan)
        for mth in range(1, 13):
            sel = ic[(years == y) & (months == mth)]
            if sel.size < 3:
                continue
            mu = float(np.nanmean(sel))
            sd = float(np.nanstd(sel, ddof=1)) if sel.size > 1 else np.nan
            month_mean[y][mth - 1] = mu
            month_ir[y][mth - 1] = mu / sd if sd and sd > 0 else np.nan
    colors = ["tab:blue", "tab:orange", "tab:green", "tab:red", "tab:purple", "tab:brown", "tab:pink"]

    def grouped_bars(ax, data_map, title):
        x = np.arange(1, 13)
        k = max(len(uniq_years), 1)
        width = 0.8 / k
        for i, y in enumerate(uniq_years):
            ax.bar(x + (i - k / 2) * width + width / 2, data_map[y], width=width, label=str(y), color=colors[i % len(colors)])
        ax.set_title(title)
        ax.set_xticks(x)
        ax.legend(loc="lower right", frameon=True, fontsize=7)

    grouped_bars(axes[1, 0], month_ir, "month_ic_ir")
    grouped_bars(axes[1, 1], month_mean, "month_ic_mean")
    ax = axes[2, 0]
    ax.bar(np.arange(len(uniq_years)), year_ir, color="tab:blue")
    ax.set_title("year_ic_ir")
    ax.set_xticks(np.arange(len(uniq_years)))
    ax.set_xticklabels([str(y) for y in uniq_years], rotation=90)
    ax = axes[2, 1]
    ax.bar(np.arange(len(uniq_years)), year_mean, color="tab:blue")
    ax.set_title("year_ic_mean")
    ax.set_xticks(np.arange(len(uniq_years)))
    ax.set_xticklabels([str(y) for y in uniq_years], rotation=90)
    ax = axes[3, 0]
    udates = l1.get("used_dates") or dts
    if ls.size:
        x_ls, ls_is_date = _xvals(udates, len(ls))
        ax.plot(x_ls, ls, color="tab:blue", lw=0.8)
        ax.plot(x_ls, _ma(ls, 21), color="tab:orange", lw=1.2)
        if ls_is_date:
            _style_date_axis(ax)
    ax.set_title("factor_return")
    ax = axes[3, 1]
    m = min(len(q10), len(q1)) if len(q10) and len(q1) else 0
    if m > 2:
        x_nav, nav_is_date = _xvals(udates, m)
        ax.plot(x_nav, np.cumprod(1 + q10[:m]), color="tab:blue", lw=1.0, label="q10")
        ax.plot(x_nav, np.cumprod(1 + q1[:m]), color="tab:orange", lw=1.0, label="q1")
        if nav_is_date:
            _style_date_axis(ax)
    ax.set_title("端点组累计")
    ax.legend(frameon=True)
    fig.tight_layout()
    return _fig_to_b64(fig, plt)


def _svg_nav(values: list[float] | None, w: int = 640, h: int = 160) -> str:
    if not values or len(values) < 2:
        return ""
    nav = [1.0]
    for r in values:
        try:
            nav.append(nav[-1] * (1.0 + float(r)))
        except (TypeError, ValueError):
            nav.append(nav[-1])
    lo, hi = min(nav), max(nav)
    span = (hi - lo) or 1e-9
    pad_x, pad_y = 8.0, 10.0
    inner_w, inner_h = w - 2 * pad_x, h - 2 * pad_y
    pts = []
    for i, v in enumerate(nav):
        x = pad_x + i / (len(nav) - 1) * inner_w
        y = pad_y + inner_h - (v - lo) / span * inner_h
        pts.append((x, y))
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    last_x, last_y = pts[-1]
    first_x = pts[0][0]
    base = pad_y + inner_h
    area = f"{first_x:.1f},{base:.1f} " + line + f" {last_x:.1f},{base:.1f}"
    up = nav[-1] >= nav[0]
    stroke = "#5eead4" if up else "#fb7185"
    uid = abs(hash((round(nav[0], 6), round(nav[-1], 6), len(nav)))) % 10_000_000
    return (
        f'<svg class="chart" width="{w}" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none">'
        f"<defs>"
        f'<linearGradient id="navUp{uid}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="#5eead4" stop-opacity="0.35"/>'
        f'<stop offset="100%" stop-color="#5eead4" stop-opacity="0"/>'
        f"</linearGradient>"
        f'<linearGradient id="navDn{uid}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="#fb7185" stop-opacity="0.28"/>'
        f'<stop offset="100%" stop-color="#fb7185" stop-opacity="0"/>'
        f"</linearGradient>"
        f"</defs>"
        f'<polygon fill="url(#{"navUp" if up else "navDn"}{uid})" points="{area}"/>'
        f'<polyline fill="none" stroke="{stroke}" stroke-width="1.8" stroke-linejoin="round" '
        f'stroke-linecap="round" points="{line}"/>'
        f"</svg>"
    )


def _svg_bars(deciles: dict[str, Any] | None, key: str = "ann_ret", w: int = 640, h: int = 160) -> str:
    if not deciles:
        return ""
    vals = []
    for i in range(1, 11):
        try:
            vals.append(float((deciles.get(f"q{i}") or {}).get(key) or 0))
        except (TypeError, ValueError):
            vals.append(0.0)
    m = max((abs(v) for v in vals), default=1e-9) or 1e-9
    top, bot, left = 12.0, 22.0, 6.0
    inner_h = h - top - bot
    bw = (w - 2 * left) / 10
    mid = top + inner_h / 2
    rects = []
    labels = []
    for i, v in enumerate(vals):
        bh = abs(v) / m * (inner_h / 2 - 4)
        x = left + i * bw + 6
        y = mid - bh if v >= 0 else mid
        color = TAB_COLORS[i % len(TAB_COLORS)]
        rects.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw - 12:.1f}" height="{max(bh, 0.8):.1f}" '
            f'rx="3" fill="{color}" fill-opacity="0.92"/>'
        )
        labels.append(
            f'<text x="{x + (bw - 12) / 2:.1f}" y="{h - 7:.1f}" text-anchor="middle" '
            f'fill="#8b9bb4" font-size="10">Q{i + 1}</text>'
        )
    legend = "".join(
        f'<rect x="{left + i * 58:.1f}" y="2" width="8" height="8" fill="{TAB_COLORS[i]}"/>'
        f'<text x="{left + i * 58 + 11:.1f}" y="10" fill="#8b9bb4" font-size="9">Q{i + 1}</text>'
        for i in range(10)
    )
    return (
        f'<svg class="chart" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        + legend
        + f'<line x1="{left}" y1="{mid:.1f}" x2="{w - left}" y2="{mid:.1f}" stroke="#2a3545" stroke-width="1"/>'
        + "".join(rects)
        + "".join(labels)
        + "</svg>"
    )


def _svg_lines(
    series: list[tuple[str, list[float] | None]],
    *,
    w: int = 640,
    h: int = 180,
    colors: tuple[str, ...] | None = None,
    cumprod: bool = True,
) -> str:
    pal = colors or TAB_COLORS
    cleaned: list[tuple[str, list[float], str]] = []
    for i, (name, vals) in enumerate(series):
        if not vals or len(vals) < 2:
            continue
        y = [1.0]
        if cumprod:
            for r in vals:
                try:
                    y.append(y[-1] * (1.0 + float(r)))
                except (TypeError, ValueError):
                    y.append(y[-1])
        else:
            y = []
            for r in vals:
                try:
                    y.append(float(r))
                except (TypeError, ValueError):
                    y.append(float("nan"))
        finite = [v for v in y if v == v]
        if len(finite) < 2:
            continue
        cleaned.append((name, y, pal[i % len(pal)]))
    if not cleaned:
        return ""
    lo = min(min(v for v in y if v == v) for _, y, _ in cleaned)
    hi = max(max(v for v in y if v == v) for _, y, _ in cleaned)
    span = (hi - lo) or 1e-9
    pad_x, pad_top, pad_bot = 8.0, 16.0, 8.0
    inner_w, inner_h = w - 2 * pad_x, h - pad_top - pad_bot
    paths = []
    legend = []
    for i, (name, y, color) in enumerate(cleaned):
        n = max(len(y) - 1, 1)
        pts = []
        for j, v in enumerate(y):
            if v != v:
                continue
            x = pad_x + j / n * inner_w
            yy = pad_top + inner_h - (v - lo) / span * inner_h
            pts.append(f"{x:.1f},{yy:.1f}")
        paths.append(
            f'<polyline fill="none" stroke="{color}" stroke-width="1.5" stroke-linejoin="round" points="{" ".join(pts)}"/>'
        )
        legend.append(
            f'<rect x="{pad_x + (i % 5) * 120:.1f}" y="{2 + (i // 5) * 10:.1f}" width="8" height="8" fill="{color}"/>'
            f'<text x="{pad_x + (i % 5) * 120 + 11:.1f}" y="{10 + (i // 5) * 10:.1f}" fill="#8b9bb4" font-size="9">{_esc(name)}</text>'
        )
    return (
        f'<svg class="chart tall" width="{w}" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none">'
        + "".join(legend)
        + "".join(paths)
        + "</svg>"
    )


def _ma_list(vals: list[float], w: int = 21) -> list[float]:
    out: list[float] = []
    buf: list[float] = []
    for v in vals:
        buf.append(v if v == v else 0.0)
        if len(buf) < w:
            out.append(float("nan"))
        else:
            out.append(sum(buf[-w:]) / w)
    return out


def _svg_ic(ic: list[float] | None, w: int = 640, h: int = 180) -> str:
    if not ic or len(ic) < 5:
        return ""
    vals = []
    for x in ic:
        try:
            vals.append(float(x))
        except (TypeError, ValueError):
            vals.append(float("nan"))
    ma = _ma_list(vals, 21)
    return _svg_lines(
        [("rank_ic", vals), ("rank_ic_21mean", ma)],
        w=w,
        h=h,
        colors=("#1f77b4", "#ff7f0e"),
        cumprod=False,
    )


def _svg_ic_cumsum(ic: list[float] | None, w: int = 640, h: int = 180) -> str:
    if not ic or len(ic) < 5:
        return ""
    pos, neg, acc_p, acc_n = [], [], 0.0, 0.0
    for x in ic:
        try:
            v = float(x)
        except (TypeError, ValueError):
            v = 0.0
        if v != v:
            v = 0.0
        acc_p += v
        acc_n += -v
        pos.append(acc_p)
        neg.append(acc_n)
    return _svg_lines(
        [("max_cumsum", pos), ("min_cumsum", neg)],
        w=w,
        h=h,
        colors=("#1f77b4", "#ff7f0e"),
        cumprod=False,
    )


def render_report(
    diag: dict[str, Any],
    *,
    host: str | None = None,
    neighbors: list[dict[str, Any]] | None = None,
    extra_notes: list[str] | None = None,
) -> str:
    from report_tabs import render_tabbed_report

    return render_tabbed_report(diag, host=host, neighbors=neighbors, extra_notes=extra_notes)


def _legacy_render_report(
    diag: dict[str, Any],
    *,
    host: str | None = None,
    neighbors: list[dict[str, Any]] | None = None,
    extra_notes: list[str] | None = None,
) -> str:
    host_s, stamp, title = report_stamp(host)
    mode_order = (
        ("none", "不中性化"),
        ("industry", "申万一级中性化"),
        ("size", "市值 lncap 中性化"),
        ("size_industry", "行业且 lncap 中性化"),
    )
    l1_top = ((diag.get("none") or {}).get("label_1d") or {})
    intake = diag.get("intake") or {}
    market = diag.get("market") or {}
    notes = list(diag.get("notes") or []) + list(extra_notes or [])
    window = diag.get("window") or {}
    tb = diag.get("tradability") or {}
    to = (tb.get("open") or {}).get("h1") or {}
    tv = (tb.get("vwap") or {}).get("t1_to_t2") or {}

    peer_rows = ""
    for p in (neighbors or [])[:8]:
        peer_rows += (
            f"<tr><td>{_esc(p.get('factor_id') or p.get('name'))}</td>"
            f"<td>{_fmt(p.get('rank_corr') if p.get('rank_corr') is not None else p.get('corr'))}</td>"
            f"<td>{_fmt(p.get('q10_jaccard'))}</td>"
            f"<td>{_esc(p.get('decision'))}</td></tr>"
        )
    if not peer_rows:
        peer_rows = "<tr><td colspan=4>库为空或未计算相关</td></tr>"

    blocks = ""
    vwap_blocks = ""
    for neut, heading in mode_order:
        b = diag.get(neut)
        if not isinstance(b, dict):
            continue
        l1 = b.get("label_1d") or {}
        l5 = b.get("label_5d") or {}
        l20 = b.get("label_20d") or {}
        ex = l1.get("excess") or {}
        nav_png = render_nav_panel(b)
        eight_png = render_eight_panel(b)
        if nav_png:
            img_nav = f'<p><img alt="nav" src="data:image/png;base64,{nav_png}" style="max-width:100%"/></p>'
        else:
            img_nav = (
                "<p class='muted'>matplotlib 不可用，SVG 回退</p>"
                + _svg_bars(l1.get("deciles"))
                + _svg_nav(l1.get("ls_daily"))
            )
        img_eight = (
            f'<p><img alt="ic8" src="data:image/png;base64,{eight_png}" style="max-width:100%"/></p>'
            if eight_png
            else _svg_nav(b.get("ic_series"))
        )
        blocks += f"""
        <section>
          <h3>{heading}</h3>
          <p class="muted">基准：{_esc(diag.get('benchmark'))}（路径={_esc(diag.get('benchmark_kind'))}）</p>
          <table>
            <tr><th>label</th><th>RankIC</th><th>ICIR</th><th>t</th><th>n</th><th>正IC占比</th><th>Q10-Q1 AnnRet</th><th>Q10-Q1 Sharpe</th><th>Q10-Q1 Turnover</th><th>超额L-S AnnRet</th><th>超额L-S Sharpe</th></tr>
            <tr><td>1d</td><td>{_fmt(l1.get('rank_ic'))}</td><td>{_fmt(l1.get('icir'))}</td><td>{_fmt(l1.get('t_stat'))}</td><td>{_esc(l1.get('n'))}</td><td>{_fmt(l1.get('ic_positive_rate'))}</td><td>{_fmt(l1.get('ls_ann_ret'), True)}</td><td>{_fmt(l1.get('ls_sharpe'))}</td><td>{_fmt(l1.get('ls_tvr_avg'))}</td><td>{_fmt(ex.get('ann_ret'), True)}</td><td>{_fmt(ex.get('sharpe'))}</td></tr>
            <tr><td>5d</td><td>{_fmt(l5.get('rank_ic'))}</td><td>{_fmt(l5.get('icir'))}</td><td>{_fmt(l5.get('t_stat'))}</td><td>{_esc(l5.get('n'))}</td><td>{_fmt(l5.get('ic_positive_rate'))}</td><td>{_fmt(l5.get('ls_ann_ret'), True)}</td><td>{_fmt(l5.get('ls_sharpe'))}</td><td>{_fmt(l5.get('ls_tvr_avg'))}</td><td>—</td><td>—</td></tr>
            <tr><td>20d</td><td>{_fmt(l20.get('rank_ic'))}</td><td>{_fmt(l20.get('icir'))}</td><td>{_fmt(l20.get('t_stat'))}</td><td>{_esc(l20.get('n'))}</td><td>{_fmt(l20.get('ic_positive_rate'))}</td><td>{_fmt(l20.get('ls_ann_ret'), True)}</td><td>{_fmt(l20.get('ls_sharpe'))}</td><td>{_fmt(l20.get('ls_tvr_avg'))}</td><td>—</td><td>—</td></tr>
          </table>
          <p class="muted">十分组换手 tvr_avg（单边成员更换；L-S=(Q1+Q10)/2） peak_q={_esc(l1.get('peak_q'))} Q10-Q9={_fmt(l1.get('q10_q9'), True)}</p>
          <table>
            <tr>{''.join(f'<th>q{i}</th>' for i in range(1,11))}<th>L-S</th></tr>
            <tr>{''.join(f"<td>{_fmt(((l1.get('deciles') or {}).get(f'q{i}') or {}).get('tvr_avg'))}</td>" for i in range(1,11))}<td>{_fmt(l1.get('ls_tvr_avg'))}</td></tr>
          </table>
          {img_nav}
          {img_eight}
        </section>
        """
        vt = b.get("vwap_trade") if isinstance(b.get("vwap_trade"), dict) else None
        if vt:
            rows = ""
            for key, lab in (("t1_to_t2", "t+1→t+2 VWAP (H=1)"), ("t1_to_t6", "t+1→t+6 VWAP (H=5)"), ("t1_to_t21", "t+1→t+21 VWAP (H=20)")):
                d = vt.get(key) or {}
                rows += (
                    f"<tr><td>{lab}</td><td>{_fmt(d.get('ls_sharpe'))}</td>"
                    f"<td>{_fmt(d.get('ls_ann_ret'), True)}</td><td>{_fmt(d.get('ls_ann_vol'), True)}</td>"
                    f"<td>{_fmt(d.get('ls_max_dd'))}</td><td>{_fmt(d.get('ls_tvr_avg'))}</td>"
                    f"<td>{_fmt(d.get('ls_tvr_ann'))}</td><td>{_fmt(d.get('rank_ic'))}</td>"
                    f"<td>{_fmt(d.get('icir'))}</td><td>{_esc(d.get('n'))}</td></tr>"
                )
            vwap_blocks += f"""
            <section>
              <h3>{heading} · VWAP 执行</h3>
              <table>
                <tr><th>路径</th><th>SR</th><th>AnnRet</th><th>AnnVol</th><th>DD</th><th>Turnover/日</th><th>Turnover/年</th><th>RankIC</th><th>ICIR</th><th>n</th></tr>
                {rows}
              </table>
            </section>
            """

    trad_note = (
        f"<p class='muted'>可交易覆盖（h=1）：开盘 long_ok={_fmt(to.get('frac_long_ok'))} "
        f"short_ok={_fmt(to.get('frac_short_ok'))} either={_fmt(to.get('frac_either_ok'))}；"
        f"VWAP t+1→t+2 long_ok={_fmt(tv.get('frac_long_ok'))} short_ok={_fmt(tv.get('frac_short_ok'))} "
        f"either={_fmt(tv.get('frac_either_ok'))}。has_limit={_esc(tb.get('has_limit'))}</p>"
    )
    if not vwap_blocks:
        vwap_blocks = "<p class='muted'>无 VWAP 字段，未计算 t+1 VWAP 路径。</p>"

    missing = market.get("missing_preferred") or []
    source = (market.get("source") or {})
    summary = summarize_factor(diag, neighbors=neighbors)
    head_sum = summary_html(summary, heading="因子总结")
    tail_sum = summary_html(summary, heading="结论")
    return f"""<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/>
<title>{_esc(title)}</title>
<style>
  body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 28px; color: #111; max-width: 1100px; }}
  h1,h2,h3 {{ margin: 0.6em 0 0.3em; }}
  code, pre {{ background: #f4f4f4; padding: 2px 6px; }}
  pre {{ white-space: pre-wrap; }}
  table {{ border-collapse: collapse; margin: 8px 0 16px; }}
  td, th {{ border: 1px solid #ddd; padding: 4px 8px; font-size: 13px; }}
  .muted {{ color: #666; font-size: 13px; }}
  .kpi td {{ font-variant-numeric: tabular-nums; }}
  svg {{ background: #fafafa; border: 1px solid #eee; }}
  .summary {{ background: #f7f8fa; border: 1px solid #e3e6eb; padding: 12px 16px 8px; margin: 12px 0 20px; }}
  .summary .lead {{ font-size: 15px; margin: 0.3em 0 0.6em; }}
  .summary ul {{ margin: 0.2em 0 0.6em 1.2em; }}
  .summary li {{ margin: 0.15em 0; }}
</style>
</head><body>
<h1>{_esc(title)}</h1>
<p class="muted">dev={_esc(host_s)} · Factor · {_esc(stamp)} · intake={_esc(intake.get('status'))} ({_esc(intake.get('note'))})
· universe={_esc(diag.get('universe'))} · orientation={_esc(diag.get('orientation'))}
· { _esc(window.get('start')) }–{ _esc(window.get('end')) } · n={_esc(window.get('n_dates'))}
· 市场源={_esc(source.get('kind') or source.get('path'))}</p>
{head_sum}
<p class="muted">信号：t 日收盘后（因子只用 t 及以前）。本页顶部/十分组：t 收盘信号后 t+1 开盘买、t+2/t+6/t+21 开盘卖。
可交易性：开盘涨停不可买、开盘跌停不可卖、volume=0 停牌剔除；VWAP 路径剔除一字涨停/跌停。多空任一侧可成交才计入该日收益。缺字段则未过滤，不得假装已过滤。</p>
<h2>研究回测（与十分组统一，不中性化 Q10−Q1 1日）</h2>
<table class="kpi">
<tr><th>SR</th><th>AnnRet</th><th>AnnVol</th><th>DD</th><th>Turnover/日</th><th>Turnover/年</th><th>RankIC</th><th>ICIR</th><th>t</th><th>peak_q</th></tr>
<tr>
  <td>{_fmt(l1_top.get('ls_sharpe'))}</td>
  <td>{_fmt(l1_top.get('ls_ann_ret'), True)}</td>
  <td>{_fmt(l1_top.get('ls_ann_vol'), True)}</td>
  <td>{_fmt(l1_top.get('ls_max_dd'))}</td>
  <td>{_fmt(l1_top.get('ls_tvr_avg'))}</td>
  <td>{_fmt(l1_top.get('ls_tvr_ann'))}</td>
  <td>{_fmt(l1_top.get('rank_ic'))}</td>
  <td>{_fmt(l1_top.get('icir'))}</td>
  <td>{_fmt(l1_top.get('t_stat'))}</td>
  <td>{_esc(l1_top.get('peak_q'))}</td>
</tr>
</table>
<p class="muted">市场字段缺失：{_esc(', '.join(missing) if missing else '无')}。notes: {_esc(' | '.join(notes) if notes else '—')}</p>
<h2>与已有因子相关（截面 RankCorr / Q10 Jaccard）</h2>
<table><tr><th>factor_id</th><th>RankCorr</th><th>Q10 Jaccard</th><th>decision</th></tr>{peer_rows}</table>
<h2>十分组 / RankIC / 中性化（t+1 开盘买）</h2>
{blocks}
<h2>可交易路径：t 收盘信号 → t+1 VWAP 买 → t+2 / t+6 / t+21 VWAP 卖</h2>
{trad_note}
{vwap_blocks}
{tail_sum}
<p class="muted">本报告由本地 factor-intake-standard 生成。行情优先读本机 OpenAlpha data_dir；缺字段才走 FTShare 按标的补洞。不把仿真账面 AnnRet 当主数字。</p>
</body></html>
"""


def save_report(html_doc: str, *, directory: Path | None = None, title: str | None = None) -> Path:
    host_s, stamp, default_title = report_stamp()
    title = title or default_title
    d = Path(directory) if directory else default_report_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{title}.html"
    path.write_text(html_doc, encoding="utf-8")
    return path


def report_http_base() -> str:
    return (os.environ.get("FACTOR_REPORT_HTTP") or "http://127.0.0.1:18768").rstrip("/")


def file_url(path: Path | str) -> str:
    """Clickable URL for chat: HTTP if the file sits in the report dir, else file://."""
    p = Path(path).expanduser().resolve()
    try:
        rel = p.relative_to(default_report_dir().resolve()).as_posix()
        return f"{report_http_base()}/{quote(rel, safe='/')}"
    except ValueError:
        extra = Path.home() / "Documents" / "openalpha" / "factor-intake-work" / "reports"
        try:
            rel = p.relative_to(extra.resolve()).as_posix()
            return f"{report_http_base()}/{quote(rel, safe='/')}"
        except ValueError:
            return "file://" + quote(p.as_posix(), safe="/")


def report_open_lines(html_path: Path | str | None, md_path: Path | str | None = None) -> str:
    """Markdown links for session replies. Empty string if no files."""
    lines: list[str] = []
    if html_path:
        hp = Path(html_path)
        url = file_url(hp)
        lines.append(f"[打开 HTML 报告]({url})")
        lines.append(f"open_html={url}")
    if md_path:
        mp = Path(md_path)
        if mp.exists():
            url = file_url(mp)
            lines.append(f"[打开 Markdown 摘要]({url})")
            lines.append(f"open_md={url}")
    return ("\n".join(lines) + "\n") if lines else ""
