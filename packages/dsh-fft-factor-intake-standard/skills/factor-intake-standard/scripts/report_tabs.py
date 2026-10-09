#!/usr/bin/env python3
"""Tabbed neutralization pages + compact diagnostics markdown for chat."""
from __future__ import annotations

from typing import Any

from report_html import (
    TAB_COLORS,
    _esc,
    _fmt,
    _num_class,
    _signed,
    _svg_bars,
    _svg_ic,
    _svg_ic_cumsum,
    _svg_lines,
    _svg_nav,
    _td,
    report_stamp,
    summarize_factor,
    summary_html,
)

MODE_ORDER = (
    ("none", "不中性化"),
    ("industry", "申万一级中性化"),
    ("size", "市值 lncap 中性化"),
    ("size_industry", "行业且 lncap 中性化"),
)


def _n(lab: dict[str, Any]) -> Any:
    return lab.get("n") if lab.get("n") is not None else lab.get("n_days")


def _label_row(lab: dict[str, Any] | None, name: str, *, ls: bool, extra: bool = False) -> str:
    lab = lab or {}
    ex = lab.get("excess") if isinstance(lab.get("excess"), dict) else {}
    if ls:
        row = (
            f"<tr><td class='row-lab'>{_esc(name)}</td>{_td(lab.get('rank_ic'), signed=True)}"
            f"{_td(lab.get('icir'))}{_td(lab.get('t_stat'))}{_td(lab.get('ic_positive_rate'))}"
            f"<td class='na'>{_esc(_n(lab))}</td>{_td(lab.get('ls_ann_ret'), True, signed=True)}"
            f"{_td(lab.get('ls_sharpe'), signed=True)}{_td(lab.get('ls_max_dd'))}"
            f"{_td(lab.get('ls_tvr_avg'))}"
        )
        if extra:
            row += f"{_td(ex.get('ann_ret'), True, signed=True)}{_td(ex.get('sharpe'), signed=True)}"
        return row + "</tr>"
    dashes = "<td class='na'>—</td>" * (4 + (2 if extra else 0))
    return (
        f"<tr><td class='row-lab'>{_esc(name)}</td>{_td(lab.get('rank_ic'), signed=True)}"
        f"{_td(lab.get('icir'))}{_td(lab.get('t_stat'))}{_td(lab.get('ic_positive_rate'))}"
        f"<td class='na'>{_esc(_n(lab))}</td>{dashes}</tr>"
    )


def _ic_table(
    title: str,
    note: str,
    l1: dict,
    l5: dict,
    l20: dict,
    *,
    ls5: bool,
    ls20: bool,
    extra: bool = False,
) -> str:
    extra_h = "<th>超额L-S AnnRet</th><th>超额L-S Sharpe</th>" if extra else ""
    return f"""
      <article class="card">
        <header class="card-h"><h4>{_esc(title)}</h4><p class="muted">{_esc(note)}</p></header>
        <div class="table-wrap">
        <table class="kpi">
          <tr><th>label</th><th>RankIC</th><th>ICIR</th><th>t</th><th>正IC占比</th><th>n</th><th>Q10-Q1 AnnRet</th><th>Q10-Q1 Sharpe</th><th>MaxDD</th><th>Q10-Q1 Turnover</th>{extra_h}</tr>
          {_label_row(l1, "1d", ls=True, extra=extra)}
          {_label_row(l5, "5d", ls=ls5, extra=extra)}
          {_label_row(l20, "20d", ls=ls20, extra=extra)}
        </table>
        </div>
      </article>
    """


def _close_fwd_table(block: dict[str, Any]) -> str:
    cf = block.get("close_fwd") if isinstance(block.get("close_fwd"), dict) else {}
    return _ic_table(
        "RankIC / 多空（复权 close 前向收益）",
        "官方 diagnostics_summary：adj_close[t+H]/adj_close[t]-1。1d 报 Q10−Q1；5d/20d 只报 RankIC。",
        cf.get("label_1d") or {},
        cf.get("label_5d") or {},
        cf.get("label_20d") or {},
        ls5=False,
        ls20=False,
    )


def _open_table(block: dict[str, Any]) -> str:
    return _ic_table(
        "开盘路径（入库主口径，t+1 开盘买）",
        "t 收盘信号 → t+1 开盘买 → t+2/t+6/t+21 开盘卖。1d 含指数超额 L-S。",
        block.get("label_1d") or {},
        block.get("label_5d") or {},
        block.get("label_20d") or {},
        ls5=True,
        ls20=True,
        extra=True,
    )


def _decile_detail(block: dict[str, Any]) -> str:
    l1 = block.get("label_1d") or {}
    dec = l1.get("deciles") or {}
    rows = ""
    for i in range(1, 11):
        q = dec.get(f"q{i}") or {}
        rows += (
            f"<tr><td class='row-lab'>q{i}</td>{_td(q.get('ann_ret'), True, signed=True)}"
            f"{_td(q.get('sharpe'), signed=True)}{_td(q.get('tvr_avg'))}{_td(q.get('max_dd'))}"
            f"{_td(q.get('excess_ann_ret'), True, signed=True)}</tr>"
        )
    q10 = dec.get("q10") or {}
    q9 = dec.get("q9") or {}
    q8 = dec.get("q8") or {}
    return f"""
      <article class="card">
        <header class="card-h"><h4>十分组明细（开盘 1 日）</h4>
        <p class="muted">至少报 Q8/Q9/Q10 与峰值。peak_q={_esc(l1.get('peak_q'))}
        · Q10−Q9={_fmt(l1.get('q10_q9'), True)} · Q9−Q8={_fmt(l1.get('q9_q8'), True)}
        · Q10={_fmt(q10.get('ann_ret'), True)} · Q9={_fmt(q9.get('ann_ret'), True)} · Q8={_fmt(q8.get('ann_ret'), True)}</p></header>
        <div class="table-wrap">
        <table class="kpi">
          <tr><th>分位</th><th>AnnRet</th><th>Sharpe</th><th>Turnover/日</th><th>MaxDD</th><th>超额 AnnRet</th></tr>
          {rows}
        </table>
        </div>
      </article>
    """


def _turnover_table(block: dict[str, Any]) -> str:
    l1 = block.get("label_1d") or {}
    cells = "".join(
        _td(((l1.get("deciles") or {}).get(f"q{i}") or {}).get("tvr_avg"))
        for i in range(1, 11)
    )
    return f"""
      <article class="card">
        <header class="card-h"><h4>换手（官方 diagnostics_summary：单边成员更换 tvr_avg）</h4>
        <p class="muted">首日=1；L-S=(Q1+Q10)/2。peak_q={_esc(l1.get('peak_q'))} · Q10−Q9={_fmt(l1.get('q10_q9'), True)}</p></header>
        <div class="table-wrap">
        <table class="kpi">
          <tr>{''.join(f'<th>q{i}</th>' for i in range(1,11))}<th>L-S</th></tr>
          <tr>{cells}{_td(l1.get('ls_tvr_avg'))}</tr>
        </table>
        </div>
      </article>
    """


def _vwap_table(block: dict[str, Any]) -> str:
    vt = block.get("vwap_trade") if isinstance(block.get("vwap_trade"), dict) else None
    if not vt:
        return "<p class='muted'>无 VWAP 字段，未计算 t+1 VWAP 路径。</p>"
    rows = ""
    for key, lab in (
        ("t1_to_t2", "t+1→t+2 VWAP (H=1)"),
        ("t1_to_t6", "t+1→t+6 VWAP (H=5)"),
        ("t1_to_t21", "t+1→t+21 VWAP (H=20)"),
    ):
        d = vt.get(key) or {}
        n = d.get("n") if d.get("n") is not None else d.get("n_days")
        rows += (
            f"<tr><td class='row-lab'>{lab}</td>{_td(d.get('ls_sharpe'), signed=True)}"
            f"{_td(d.get('ls_ann_ret'), True, signed=True)}{_td(d.get('ls_ann_vol'), True)}"
            f"{_td(d.get('ls_max_dd'))}{_td(d.get('ls_tvr_avg'))}"
            f"{_td(d.get('ls_tvr_ann'))}{_td(d.get('rank_ic'), signed=True)}"
            f"{_td(d.get('icir'))}<td class='na'>{_esc(n)}</td></tr>"
        )
    return f"""
      <article class="card">
        <header class="card-h"><h4>VWAP 执行（官方 diagnostics_summary）</h4></header>
        <div class="table-wrap">
        <table class="kpi">
          <tr><th>路径</th><th>SR</th><th>AnnRet</th><th>AnnVol</th><th>DD</th><th>Turnover/日</th><th>Turnover/年</th><th>RankIC</th><th>ICIR</th><th>n</th></tr>
          {rows}
        </table>
        </div>
      </article>
    """


def _tradability_html(tb: dict[str, Any]) -> str:
    rows = ""
    specs = [
        ("开盘 h=1", (tb.get("open") or {}).get("h1") or {}),
        ("开盘 h=5", (tb.get("open") or {}).get("h5") or {}),
        ("开盘 h=20", (tb.get("open") or {}).get("h20") or {}),
        ("VWAP t+1→t+2", (tb.get("vwap") or {}).get("t1_to_t2") or {}),
        ("VWAP t+1→t+6", (tb.get("vwap") or {}).get("t1_to_t6") or {}),
        ("VWAP t+1→t+21", (tb.get("vwap") or {}).get("t1_to_t21") or {}),
        ("close h=1", (tb.get("close") or {}).get("h1") or {}),
        ("close h=5", (tb.get("close") or {}).get("h5") or {}),
        ("close h=20", (tb.get("close") or {}).get("h20") or {}),
    ]
    chips = []
    for name, rec in specs:
        rows += (
            f"<tr><td class='row-lab'>{_esc(name)}</td>"
            f"{_td(rec.get('frac_long_ok'))}{_td(rec.get('frac_short_ok'))}{_td(rec.get('frac_either_ok'))}</tr>"
        )
        chips.append(f'<div class="chip"><span>{_esc(name)} either</span><b>{_fmt(rec.get("frac_either_ok"))}</b></div>')
    limit = "has_limit=True" if tb.get("has_limit") else "has_limit=False"
    return f"""
      <article class="card">
        <header class="card-h"><h4>可交易（官方 diagnostics_summary）</h4>
        <p class="muted">{_esc(limit)}。开盘涨停不可买、开盘跌停不可卖、volume=0 停牌剔除；VWAP 剔一字板。多空任一侧可成交才计入该日收益。缺字段则未过滤。</p></header>
        <div class="chips">{''.join(chips)}</div>
        <div class="table-wrap" style="margin-top:10px">
        <table class="kpi">
          <tr><th>路径</th><th>long_ok</th><th>short_ok</th><th>either</th></tr>
          {rows}
        </table>
        </div>
      </article>
    """


def _layer_ic_charts(block: dict[str, Any]) -> str:
    l1 = block.get("label_1d") or {}
    cf = (block.get("close_fwd") or {}).get("label_1d") or {}
    dec = l1.get("deciles") or {}
    qex = ((l1.get("excess") or {}).get("deciles") if isinstance(l1.get("excess"), dict) else None) or {}
    q_nav = [(f"q{i}", (dec.get(f"q{i}") or {}).get("daily")) for i in range(1, 11)]
    q_ex_nav = [(f"q{i}-B", qex.get(f"q{i}") or (dec.get(f"q{i}") or {}).get("excess_daily")) for i in range(1, 11)]
    ic = block.get("ic_series") or []
    return f"""
      <div class="viz-stack">
        <section class="viz-block">
          <h4 class="viz-title">分层净值</h4>
          <p class="muted">Q1–Q10 沿用原 tab:blue/orange/green/red/purple 分色；L-S 单独一条。</p>
          <div class="charts charts-3">
            <article class="card chart-card"><header class="card-h"><h4>十分组 AnnRet</h4></header>{_svg_bars(dec)}</article>
            <article class="card chart-card"><header class="card-h"><h4>十分组净值</h4></header>{_svg_lines(q_nav, colors=TAB_COLORS)}</article>
            <article class="card chart-card"><header class="card-h"><h4>L-S 净值（Q10−Q1）</h4></header>{_svg_nav(l1.get("ls_daily"))}</article>
          </div>
        </section>
        <section class="viz-block">
          <h4 class="viz-title">IC 图</h4>
          <p class="muted">rank_ic 蓝、21 日均值橙；累加同样蓝/橙。</p>
          <div class="charts charts-3">
            <article class="card chart-card"><header class="card-h"><h4>IC</h4></header>{_svg_ic(ic)}</article>
            <article class="card chart-card"><header class="card-h"><h4>IC累加</h4></header>{_svg_ic_cumsum(ic)}</article>
            <article class="card chart-card"><header class="card-h"><h4>超额净值</h4></header>{_svg_lines(q_ex_nav, colors=TAB_COLORS) or _svg_nav(cf.get("ls_daily"))}</article>
          </div>
        </section>
      </div>
    """


def _hero_page(neut: str, heading: str, block: dict[str, Any] | None) -> str:
    if not isinstance(block, dict):
        return f'<section class="hero-page" id="hero-{_esc(neut)}"><p class="muted">{_esc(heading)}未计算。</p></section>'
    l1 = block.get("label_1d") or {}
    cf = (block.get("close_fwd") or {}).get("label_1d") or {}
    tiles = [
        ("RankIC", l1.get("rank_ic"), False, True),
        ("ICIR", l1.get("icir"), False, False),
        ("Q10−Q1", l1.get("ls_ann_ret"), True, True),
        ("Sharpe", l1.get("ls_sharpe"), False, True),
        ("close RankIC", cf.get("rank_ic"), False, True),
        ("peak_q", l1.get("peak_q"), False, False),
    ]
    kpi = "".join(
        f'<div class="kpi-tile"><span>{_esc(n)}</span><b class="{_num_class(v) if s else "na"}">'
        f'{_esc(_signed(v, p) if s else (_fmt(v, p) if n != "peak_q" else (str(int(v)) if v is not None else "—")))}</b></div>'
        for n, v, p, s in tiles
    )
    return f"""
      <section class="hero-page" id="hero-{_esc(neut)}">
        <div class="page-head"><h3>{_esc(heading)}</h3>
        <p class="muted">该中性化下的开盘业绩 / 分层 / IC</p></div>
        <div class="kpis">{kpi}</div>
        {_layer_ic_charts(block)}
      </section>
    """


def _neut_page(neut: str, heading: str, block: dict[str, Any] | None, diag: dict[str, Any]) -> str:
    if not isinstance(block, dict):
        return f"""
        <section class="neut-page" id="page-{_esc(neut)}">
          <div class="page-head"><h3>{_esc(heading)}</h3>
          <p class="muted">缺行业或市值，本中性化未计算。报告不得假装已中性化。</p></div>
        </section>
        """
    l1 = block.get("label_1d") or {}
    return f"""
      <section class="neut-page" id="page-{_esc(neut)}">
        <div class="page-head">
          <h3>{_esc(heading)}</h3>
          <p class="muted">基准 {_esc(diag.get('benchmark'))} · {_esc(diag.get('benchmark_kind'))} · peak_q={_esc(l1.get('peak_q'))}</p>
        </div>
        {_close_fwd_table(block)}
        {_open_table(block)}
        {_decile_detail(block)}
        {_turnover_table(block)}
        {_vwap_table(block)}
        {_tradability_html(diag.get("tradability") or {})}
      </section>
    """


def diagnostics_markdown(diag: dict[str, Any]) -> str:
    lines = [
        f"# {diag.get('name') or 'factor'} · diagnostics_summary",
        f"universe={diag.get('universe')} orientation={diag.get('orientation')} "
        f"{(diag.get('window') or {}).get('start')}–{(diag.get('window') or {}).get('end')}",
        "",
    ]
    intake = diag.get("intake") or {}
    lines.append(f"入库：{intake.get('status')}（{intake.get('note')}）")
    tb = diag.get("tradability") or {}
    to = (tb.get("open") or {}).get("h1") or {}
    tv = (tb.get("vwap") or {}).get("t1_to_t2") or {}
    lines.append(
        f"可交易 has_limit={tb.get('has_limit')} 开盘 either={_fmt(to.get('frac_either_ok'))} "
        f"VWAP either={_fmt(tv.get('frac_either_ok'))}"
    )
    for neut, heading in MODE_ORDER:
        b = diag.get(neut)
        lines += ["", f"## {heading}"]
        if not isinstance(b, dict):
            lines.append("未计算（缺行业/市值）。")
            continue
        cf = b.get("close_fwd") if isinstance(b.get("close_fwd"), dict) else {}
        lines.append("RankIC / 多空（复权 close 前向收益）")
        lines.append("| label | RankIC | ICIR | t | 正IC占比 | n | Q10-Q1 AnnRet | Q10-Q1 Sharpe | MaxDD |")
        lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
        for name, ls in (("1d", True), ("5d", False), ("20d", False)):
            lab = cf.get(f"label_{name}") or {}
            n = lab.get("n") if lab.get("n") is not None else lab.get("n_days")
            if ls:
                lines.append(
                    f"| {name} | {_fmt(lab.get('rank_ic'))} | {_fmt(lab.get('icir'))} | {_fmt(lab.get('t_stat'))} | "
                    f"{_fmt(lab.get('ic_positive_rate'))} | {n if n is not None else '—'} | "
                    f"{_fmt(lab.get('ls_ann_ret'), True)} | {_fmt(lab.get('ls_sharpe'))} | {_fmt(lab.get('ls_max_dd'))} |"
                )
            else:
                lines.append(
                    f"| {name} | {_fmt(lab.get('rank_ic'))} | {_fmt(lab.get('icir'))} | {_fmt(lab.get('t_stat'))} | "
                    f"{_fmt(lab.get('ic_positive_rate'))} | {n if n is not None else '—'} | — | — | — |"
                )
        l1 = b.get("label_1d") or {}
        tvr = " ".join(
            f"q{i}={_fmt(((l1.get('deciles') or {}).get(f'q{i}') or {}).get('tvr_avg'))}"
            for i in range(1, 11)
        )
        lines.append(f"换手 {tvr} L-S={_fmt(l1.get('ls_tvr_avg'))}")
        vt = b.get("vwap_trade") or {}
        d = (vt.get("t1_to_t2") or {}) if isinstance(vt, dict) else {}
        if d:
            lines.append(
                f"VWAP t+1→t+2 RankIC={_fmt(d.get('rank_ic'))} SR={_fmt(d.get('ls_sharpe'))} "
                f"AnnRet={_fmt(d.get('ls_ann_ret'), True)} TVR={_fmt(d.get('ls_tvr_avg'))}"
            )
    return "\n".join(lines) + "\n"


def render_tabbed_report(
    diag: dict[str, Any],
    *,
    host: str | None = None,
    neighbors: list[dict[str, Any]] | None = None,
    extra_notes: list[str] | None = None,
) -> str:
    host_s, stamp, title = report_stamp(host)
    l1_top = ((diag.get("none") or {}).get("label_1d") or {})
    cf_top = (((diag.get("none") or {}).get("close_fwd") or {}).get("label_1d") or {})
    intake = diag.get("intake") or {}
    market = diag.get("market") or {}
    notes = list(diag.get("notes") or []) + list(extra_notes or [])
    window = diag.get("window") or {}
    source = market.get("source") or {}
    missing = market.get("missing_preferred") or []

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

    present = [n for n, _ in MODE_ORDER if isinstance(diag.get(n), dict)]
    first_id = present[0] if present else "none"
    radios: list[str] = []
    labels: list[str] = []
    pages: list[str] = []
    hero_pages: list[str] = []
    radio_css: list[str] = []
    for neut, heading in MODE_ORDER:
        checked = " checked" if neut == first_id else ""
        missing = "" if isinstance(diag.get(neut), dict) else " missing"
        radios.append(f'<input type="radio" name="neut" id="tab-{_esc(neut)}" value="{_esc(neut)}"{checked}/>')
        labels.append(f'<label class="tab-btn{missing}" for="tab-{_esc(neut)}">{_esc(heading)}</label>')
        pages.append(_neut_page(neut, heading, diag.get(neut) if isinstance(diag.get(neut), dict) else None, diag))
        radio_css.append(f"#tab-{neut}:checked ~ .hero .hero-pages #hero-{neut} {{ display: block; }}")
        radio_css.append(
            f"#tab-{neut}:checked ~ .hero .tabs label[for='tab-{neut}'] {{ background: var(--act); color: #042f2e; }}"
        )
        radio_css.append(f"#tab-{neut}:checked ~ .neut-pages #page-{neut} {{ display: block; }}")
        radio_css.append(
            f"#tab-{neut}:checked ~ .tabs label[for='tab-{neut}'] {{ background: var(--act); color: #042f2e; }}"
        )
        hero_pages.append(_hero_page(neut, heading, diag.get(neut) if isinstance(diag.get(neut), dict) else None))

    summary = summarize_factor(diag, neighbors=neighbors)
    head_sum = summary_html(summary, heading="因子总结")
    tail_sum = summary_html(summary, heading="结论")
    status = str(intake.get("status") or "unrated")
    kpis = [
        ("开盘 RankIC", l1_top.get("rank_ic"), False, True),
        ("开盘 Q10−Q1", l1_top.get("ls_ann_ret"), True, True),
        ("开盘 Sharpe", l1_top.get("ls_sharpe"), False, True),
        ("开盘 Turnover", l1_top.get("ls_tvr_avg"), False, False),
        ("close RankIC", cf_top.get("rank_ic"), False, True),
        ("close Q10−Q1", cf_top.get("ls_ann_ret"), True, True),
        ("peak_q", l1_top.get("peak_q"), False, False),
        ("coverage", diag.get("coverage"), False, False),
    ]
    def _kpi_txt(name: str, val: Any, pct: bool, signed: bool) -> str:
        if name == "peak_q":
            if val is None:
                return "—"
            try:
                fv = float(val)
                if fv == int(fv):
                    return str(int(fv))
            except (TypeError, ValueError):
                return str(val)
        return _signed(val, pct) if signed else _fmt(val, pct)

    kpi_html = "".join(
        f'<div class="kpi-tile"><span>{_esc(name)}</span>'
        f'<b class="{_num_class(val) if signed else "na"}">{_esc(_kpi_txt(name, val, pct, signed))}</b></div>'
        for name, val, pct, signed in kpis
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(title)}</title>
<style>
  :root {{
    --bg:#0b1220; --panel:#121a2a; --panel2:#172033; --line:#243044;
    --text:#e8eef7; --muted:#8b9bb4; --act:#5eead4; --act2:#38bdf8;
    --pos:#34d399; --neg:#fb7185; --warn:#fbbf24;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ background: var(--bg); color: var(--text); }}
  body {{
    font-family: "SF Pro Display", "PingFang SC", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
    margin: 0 auto; padding: 28px 22px 48px; max-width: 1180px; line-height: 1.45;
  }}
  h1 {{ font-size: 26px; letter-spacing: .02em; margin: 0 0 8px; font-weight: 620; }}
  h2 {{ font-size: 15px; text-transform: uppercase; letter-spacing: .14em; color: var(--muted); margin: 28px 0 12px; font-weight: 600; }}
  h3 {{ font-size: 20px; margin: 0; font-weight: 620; }}
  h4 {{ font-size: 14px; margin: 0; font-weight: 600; }}
  .hero {{
    background: linear-gradient(135deg, #142033 0%, #0e1726 55%, #12303a 100%);
    border: 1px solid var(--line); border-radius: 18px; padding: 22px 24px 18px;
    box-shadow: 0 20px 50px rgba(0,0,0,.28);
  }}
  .meta {{ color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px 14px; }}
  .pill {{ border: 1px solid var(--line); background: rgba(255,255,255,.03); border-radius: 999px; padding: 2px 10px; }}
  .pill.st-reject, .status-reject {{ --tone: var(--neg); }}
  .pill.st-intake_ok {{ --tone: var(--pos); }}
  .pill.st-watch, .pill.st-draft {{ --tone: var(--warn); }}
  .kpis {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 16px 0 4px; }}
  .kpi-tile {{ background: rgba(8,12,20,.45); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }}
  .kpi-tile span {{ display: block; color: var(--muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }}
  .kpi-tile b {{ display: block; margin-top: 6px; font-size: 22px; font-variant-numeric: tabular-nums; font-weight: 650; }}
  .summary, .card {{
    background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px 18px; margin: 14px 0;
  }}
  .summary .lead {{ font-size: 15px; margin: .35em 0 .7em; color: #d5deea; }}
  .summary ul {{ margin: .2em 0 .2em 1.15em; color: #c5d0de; }}
  .summary li {{ margin: .18em 0; }}
  .status-reject {{ border-color: rgba(251,113,133,.35); }}
  .status-intake_ok {{ border-color: rgba(52,211,153,.35); }}
  .muted {{ color: var(--muted); font-size: 12.5px; }}
  .card-h {{ display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }}
  .table-wrap {{ overflow-x: auto; }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ padding: 8px 9px; font-size: 12.5px; text-align: right; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }}
  th {{ color: var(--muted); font-weight: 550; text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }}
  td.row-lab, th:first-child, td:first-child {{ text-align: left; }}
  tr:hover td {{ background: rgba(255,255,255,.025); }}
  .pos {{ color: var(--pos); }} .neg {{ color: var(--neg); }} .na, .zero {{ color: var(--muted); }}
  .tabs {{
    display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; padding: 6px;
    background: var(--panel2); border: 1px solid var(--line); border-radius: 999px; width: fit-content; max-width: 100%;
  }}
  .tab-btn {{
    border: 0; background: transparent; color: var(--muted); padding: 8px 14px;
    cursor: pointer; border-radius: 999px; font-size: 13px;
  }}
  .tab-btn.missing {{ opacity: .45; }}
  input[name="neut"] {{ position: absolute; left: -9999px; }}
  .neut-page, .hero-page {{ display: none; }}
  .hero .tabs {{ margin: 14px 0 10px; }}
  .viz-stack {{ display: flex; flex-direction: column; gap: 14px; margin-top: 8px; }}
  .viz-block {{ background: rgba(8,12,20,.28); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px 8px; }}
  .viz-title {{ margin: 0 0 4px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-size: 12px; }}
  .charts-3 {{ grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
  svg.chart.tall {{ height: 180px; }}
  {"".join(radio_css)}
  .page-head {{ display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin: 4px 0 8px; }}
  .charts {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }}
  .charts.charts-3 {{ grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
  .chart-card {{ padding-bottom: 8px; }}
  svg.chart {{ width: 100%; height: 150px; display: block; background: transparent; }}
  .chips {{ display: flex; flex-wrap: wrap; gap: 8px; }}
  .chip {{ background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; min-width: 110px; }}
  .chip span {{ display: block; color: var(--muted); font-size: 11px; }}
  .chip b {{ font-variant-numeric: tabular-nums; font-size: 15px; }}
  .note {{ color: var(--muted); font-size: 12px; margin-top: 18px; }}
</style>
</head><body>
{''.join(radios)}
<header class="hero">
  <h1>{_esc(diag.get('name') or title)}</h1>
  <div class="tabs" role="tablist">{''.join(labels)}</div>
  <div class="hero-pages">{''.join(hero_pages)}</div>
  <div class="meta">
    <span class="pill st-{_esc(status)}">intake={_esc(status)} · {_esc(intake.get('note'))}</span>
    <span class="pill">universe={_esc(diag.get('universe'))}</span>
    <span class="pill">orientation={_esc(diag.get('orientation'))}</span>
    <span class="pill">{_esc(window.get('start'))}–{_esc(window.get('end'))} · n={_esc(window.get('n_dates'))} · stocks={_esc(window.get('n_stocks'))}</span>
    <span class="pill">coverage={_fmt(diag.get('coverage'))}</span>
    <span class="pill">dev={_esc(host_s)} · {_esc(stamp)}</span>
    <span class="pill">{_esc(source.get('kind') or source.get('path'))}</span>
  </div>
  <div class="kpis">{kpi_html}</div>
</header>
{head_sum}
<p class="muted">信号：t 日收盘后（因子只用 t 及以前）。开盘路径：t 收盘信号后 t+1 开盘买、t+2/t+6/t+21 开盘卖。
  可交易性：开盘涨停不可买、开盘跌停不可卖、volume=0 停牌剔除；VWAP 路径剔除一字涨停/跌停。多空任一侧可成交才计入该日收益。缺字段则未过滤，不得假装已过滤。
  按钮切换中性化子页。主表是<strong>复权 close 前向收益</strong>的 RankIC/多空（官方 diagnostics_summary）；开盘路径仍是入库主口径。5d/20d close 多空按官方口径记为 —。</p>
<h2>研究回测 KPI（不中性化）</h2>
<article class="card">
<div class="table-wrap">
<table class="kpi">
<tr><th>路径</th><th>SR</th><th>AnnRet</th><th>AnnVol</th><th>DD</th><th>Turnover/日</th><th>Turnover/年</th><th>RankIC</th><th>ICIR</th><th>t</th><th>peak_q</th></tr>
<tr><td class="row-lab">开盘 1d Q10−Q1</td>{_td(l1_top.get('ls_sharpe'), signed=True)}{_td(l1_top.get('ls_ann_ret'), True, signed=True)}
{_td(l1_top.get('ls_ann_vol'), True)}{_td(l1_top.get('ls_max_dd'))}{_td(l1_top.get('ls_tvr_avg'))}{_td(l1_top.get('ls_tvr_ann'))}
{_td(l1_top.get('rank_ic'), signed=True)}{_td(l1_top.get('icir'))}
{_td(l1_top.get('t_stat'))}<td class="na">{_esc(l1_top.get('peak_q'))}</td></tr>
<tr><td class="row-lab">复权 close 1d Q10−Q1</td>{_td(cf_top.get('ls_sharpe'), signed=True)}{_td(cf_top.get('ls_ann_ret'), True, signed=True)}
{_td(cf_top.get('ls_ann_vol'), True)}{_td(cf_top.get('ls_max_dd'))}{_td(cf_top.get('ls_tvr_avg'))}{_td(cf_top.get('ls_tvr_ann'))}
{_td(cf_top.get('rank_ic'), signed=True)}{_td(cf_top.get('icir'))}
{_td(cf_top.get('t_stat'))}<td class="na">{_esc(cf_top.get('peak_q'))}</td></tr>
</table>
</div>
<p class="muted">市场字段缺失：{_esc(', '.join(str(x) for x in missing) if missing else '无')}。notes: {_esc(' | '.join(str(x) for x in notes) if notes else '—')}</p>
</article>
<h2>与已有因子相关（截面 RankCorr / Q10 Jaccard）</h2>
<article class="card"><div class="table-wrap"><table><tr><th>factor_id</th><th>RankCorr</th><th>Q10 Jaccard</th><th>decision</th></tr>{peer_rows}</table></div></article>
<h2>中性化子页 · 明细表</h2>
<div class="neut-pages">{''.join(pages)}</div>
{tail_sum}
<p class="note">本报告由本地 factor-intake-standard 生成。行情优先读本机 OpenAlpha data_dir；缺字段才走 FTShare 按标的补洞。无 JS 也可切换中性化。不把仿真账面 AnnRet 当主数字。成本未计入；未声称样本外。</p>
</body></html>
"""
