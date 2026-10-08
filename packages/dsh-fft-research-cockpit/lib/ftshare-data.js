import { callWithSubscriptionFallback, isFtSharePermissionError, permissionNotices, permissionNoticesFromPayload } from './ftshare-client.js';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const ENVELOPE_KEYS = new Set(['data', 'rows', 'items', 'records', 'list', 'metadata', 'status', 'message', 'error', 'code', 'success', 'request_id']);
function isFactRecord(value) {
    return Object.keys(value).some(key => !ENVELOPE_KEYS.has(key));
}
function normalizeStockSymbol(value) {
    const symbol = value.trim();
    if (/\.[A-Za-z]+$/.test(symbol))
        return symbol.toUpperCase();
    if (/^(5|6)\d{5}$/.test(symbol))
        return `${symbol}.SH`;
    if (/^(4|8|9)\d{5}$/.test(symbol))
        return `${symbol}.BJ`;
    return `${symbol}.SZ`;
}
function bareStockSymbol(value) {
    return value.split('.', 1)[0];
}
export function rows(value, depth = 0) {
    if (depth > 3)
        return [];
    // Different FTShare gateway versions wrap the same payload in `result`,
    // `payload` or `response`. Walk only known envelope keys and never treat an
    // empty envelope as a data row.
    for (const key of ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response', 'content']) {
        const data = value[key];
        if (Array.isArray(data))
            return data.filter(isRecord).filter(isFactRecord);
        if (isRecord(data)) {
            const nested = rows(data, depth + 1);
            if (nested.length > 0)
                return nested;
            if (isFactRecord(data))
                return [data];
        }
    }
    return [];
}
/** Flatten v4 batch-K-line groups while retaining the parent symbol. */
function klineRows(value) {
    const top = rows(value);
    const nested = top.flatMap(group => {
        const items = group.items;
        if (!Array.isArray(items))
            return [];
        return items.filter(isRecord).map(item => ({
            ...item,
            symbol: item.symbol ?? group.symbol,
        }));
    });
    return nested.length > 0 ? nested : top;
}
function text(row, ...keys) {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
        if (typeof value === 'number' && Number.isFinite(value))
            return String(value);
    }
    return null;
}
function number(row, ...keys) {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
            return Number(value);
    }
    return null;
}
function dateText(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value >= 19_000_101 && value <= 29_991_231)
            return dateText(String(Math.trunc(value)));
        const millis = value > 10_000_000_000 ? value : value * 1000;
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    if (typeof value !== 'string' || !value.trim())
        return null;
    const trimmed = value.trim();
    if (/^\d{13}$/.test(trimmed))
        return dateText(Number(trimmed));
    if (/^\d{10}$/.test(trimmed))
        return dateText(Number(trimmed));
    if (/^\d{8}$/.test(trimmed))
        return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    return trimmed.slice(0, 10);
}
function timestampForDate(value, endOfDay = false) {
    const normalized = /^\d{8}$/.test(value)
        ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
        : value;
    const suffix = endOfDay ? 'T23:59:59.999+08:00' : 'T00:00:00.000+08:00';
    const timestamp = Date.parse(`${normalized}${suffix}`);
    if (!Number.isFinite(timestamp))
        throw new Error(`无效日期：${value}`);
    return timestamp;
}
function provenance(tool, source) {
    return {
        provider: 'ftshare',
        tool,
        retrievedAt: new Date().toISOString(),
        metadata: isRecord(source.metadata) ? source.metadata : undefined,
    };
}
function compactDate(value) {
    return value.replaceAll('-', '').slice(0, 8);
}
function dateRange(asOf, days) {
    const end = new Date(`${asOf}T23:59:59.999+08:00`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - Math.max(days * 2, 180));
    return {
        since: start.toISOString().slice(0, 10).replaceAll('-', ''),
        until: compactDate(asOf),
    };
}
function parseOhlcv(source) {
    return rows(source)
        .map(row => ({
        date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.datetime ?? row.ts_millis ?? row.tsMillis ?? row.close_ts_ms ?? row.closeTsMs) ?? '',
        open: number(row, 'open', 'open_price', 'openPrice'),
        high: number(row, 'high', 'high_price', 'highPrice'),
        low: number(row, 'low', 'low_price', 'lowPrice'),
        close: number(row, 'close', 'close_price', 'closePrice', 'last', 'last_price', 'lastPrice'),
        volume: number(row, 'volume', 'vol', '成交量', 'total_volume', 'totalVolume', 'amount'),
    }))
        .filter(point => point.date && point.close !== null)
        .sort((left, right) => left.date.localeCompare(right.date));
}
/**
 * A fallback call can resolve successfully while still returning an empty
 * envelope. Treat that as unavailable for permission accounting; otherwise a
 * denied higher-tier endpoint followed by an empty lower-tier response would
 * look like a successful downgrade and the report would miss the module mask.
 */
function hasSnapshotCallData(index, source) {
    switch (index) {
        case 0:
            return klineRows(source).some(row => number(row, 'close', 'close_price', 'price', 'last', 'last_price') !== null);
        case 1:
            return parseOhlcv(source).length > 0;
        default:
            return rows(source).length > 0;
    }
}
function sourceWarning(source, tool) {
    if (!isRecord(source.metadata))
        return null;
    if (source.metadata.truncated === true)
        return `${tool} 返回结果被截断`;
    if (source.metadata.fallback === true)
        return `${tool} 使用了上游降级结果`;
    if (Array.isArray(source.metadata.warnings) && source.metadata.warnings.length > 0) {
        return `${tool}：${source.metadata.warnings.map(String).join('；')}`;
    }
    return null;
}
function normalizeQuote(row) {
    const close = number(row, 'close', 'close_price', 'closePrice', 'price', 'last', 'last_price', 'lastPrice');
    const pctChange = number(row, 'pct_change', 'pctChange', 'change_percent', 'changePercent', '涨跌幅')
        ?? (() => {
            const rate = number(row, 'change_rate');
            return rate === null ? null : Math.abs(rate) <= 1 ? rate * 100 : rate;
        })();
    return {
        ...row,
        close,
        price: close,
        open: number(row, 'open', 'open_price', 'openPrice'),
        high: number(row, 'high', 'high_price', 'highPrice'),
        low: number(row, 'low', 'low_price', 'lowPrice'),
        prev_close: number(row, 'prev_close', 'pre_close', 'previous_close', 'prevClose', 'preClose'),
        volume: number(row, 'volume', 'total_volume', 'vol', '成交量', 'totalVolume'),
        turnover: number(row, 'turnover', 'amount', 'total_amount', '成交额', 'totalAmount'),
        pct_change: pctChange,
        trade_date: dateText(row.trade_date ?? row.date ?? row.ts_millis) ?? text(row, 'trade_date', 'date'),
    };
}
function normalizeValuation(row) {
    return {
        ...row,
        trade_date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.ts_millis ?? row.tsMillis) ?? text(row, 'trade_date', 'tradeDate', 'date'),
        close: number(row, 'close_price', 'closePrice', 'close'),
        pe_ttm: number(row, 'pe_ttm', 'peTtm', 'pe'),
        pb_mrq: number(row, 'pb_mrq', 'pbMrq', 'pb'),
        ps_ttm: number(row, 'ps_ttm', 'psTtm', 'ps'),
        pcf_ocf_ttm: number(row, 'pcf_ocf_ttm', 'pcfOcfTtm', 'pcf'),
        peg: number(row, 'peg_car', 'pegCar', 'peg'),
        total_market_cap: number(row, 'total_market_cap', 'totalMarketCap', 'market_cap', 'marketCap'),
    };
}
async function loadRecentAnnouncements(session, symbol, asOf, lookbackDays, signal) {
    const days = Math.max(1, Math.min(90, Math.trunc(lookbackDays)));
    const end = new Date(`${asOf}T12:00:00Z`);
    const dates = Array.from({ length: days }, (_, offset) => {
        const date = new Date(end);
        date.setUTCDate(date.getUTCDate() - offset);
        return date.toISOString().slice(0, 10).replaceAll('-', '');
    });
    const items = [];
    const warnings = [];
    const permissions = [];
    let downgraded = false;
    let selectedTool = TOOLS.announcementsPreferred;
    let truncated = false;
    for (const date of dates) {
        try {
            const result = await callWithSubscriptionFallback(session, [
                {
                    tool: TOOLS.announcementsPreferred,
                    plan: 'Basic',
                    arguments_: { type: 'stock', stock_code: normalizeStockSymbol(symbol), page: 1, page_size: 30 },
                },
                {
                    tool: TOOLS.announcements,
                    plan: 'Free',
                    arguments_: { date, sec_code: bareStockSymbol(symbol), page: 1, page_size: 30 },
                },
            ], signal);
            permissions.push(...result.permissions);
            downgraded ||= result.downgraded;
            selectedTool = result.tool;
            items.push(...rows(result.value));
            const metadata = isRecord(result.value.metadata) ? result.value.metadata : {};
            truncated ||= metadata.truncated === true;
            if (Array.isArray(metadata.warnings))
                warnings.push(...metadata.warnings.map(String));
            // The Basic stock_code mode already returns the latest history; avoid
            // repeating the same full-history request for every lookback day.
            if (result.tool === TOOLS.announcementsPreferred)
                break;
            if (items.length >= 100)
                break;
        }
        catch (error) {
            if (isFtSharePermissionError(error)) {
                permissions.push(...permissionNotices(error));
                throw error;
            }
            warnings.push(`${date}：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const seen = new Set();
    const unique = items
        .filter(item => {
        const key = String(item.announcement_id ?? item.id ?? item.url_hash ?? item.announcement_title ?? JSON.stringify(item));
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .sort((left, right) => String(right.announcement_time ?? right.updated_at ?? '').localeCompare(String(left.announcement_time ?? left.updated_at ?? '')));
    return {
        data: unique.slice(0, 100),
        metadata: {
            source: 'ftshare',
            tool: selectedTool,
            operation: `recent_${days}d`,
            returned: Math.min(unique.length, 100),
            total: unique.length,
            truncated: truncated || unique.length > 100,
            downgraded,
            permissions: [...new Map(permissions.map(item => [`${item.tool}:${item.requiredPlan}`, item])).values()],
            warnings: [...new Set(warnings)],
        },
    };
}
const TOOLS = {
    security: 'ft_v1_company_list',
    securityPreferred: 'ft_v4_stock_realtime_day_kline',
    kline: 'ft_v1_stock_candlesticks',
    income: 'ft_v1_finance_income',
    cashflow: 'ft_v1_finance_cashflow',
    valuation: 'ft_v1_eastmoney_stock_valuation',
    capitalFlow: 'ft_v1_stock_capital_flows',
    capitalFlowPreferred: 'ft_v1_eastmoney_stock_flow',
    beta: 'ft_v1_beta_snapshot',
    betaPreferred: 'ft_v2_risk_beta',
    announcements: 'ft_v1_report_announcement_list',
    announcementsPreferred: 'ft_v3_announcements_stock_announcements',
    research: 'ft_v3_report_stock_reports',
};
export async function loadSnapshot(session, symbol, asOf, maxKlineDays, signal, announcementLookbackDays = 30, options = {}) {
    const range = dateRange(asOf, maxKlineDays);
    const includeAnnouncements = options.includeAnnouncements ?? true;
    const includeResearch = options.includeResearch ?? true;
    const includeExtendedFacts = options.includeExtendedFacts ?? false;
    const includeRiskFacts = options.includeRiskFacts ?? includeExtendedFacts;
    const currentDate = new Date().toISOString().slice(0, 10);
    const securityCandidates = asOf === currentDate
        ? [
            { tool: TOOLS.securityPreferred, plan: 'Pro', arguments_: { symbols: [normalizeStockSymbol(symbol)] } },
            { tool: TOOLS.security, plan: 'Free', arguments_: { stock_code: bareStockSymbol(symbol), page: 1, page_size: 5 } },
        ]
        : [{ tool: TOOLS.security, plan: 'Free', arguments_: { stock_code: bareStockSymbol(symbol), page: 1, page_size: 5 } }];
    const callSpecs = [
        { label: '证券行情', candidates: securityCandidates },
        {
            label: '日线行情',
            candidates: [{ tool: TOOLS.kline, plan: 'Free', arguments_: {
                        symbol: normalizeStockSymbol(symbol),
                        interval_unit: 'Day',
                        interval_value: 1,
                        since_ts_millis: timestampForDate(range.since),
                        until_ts_millis: timestampForDate(range.until, true),
                        adjust_kind: 'Forward',
                        limit: 500,
                    } }],
        },
        { label: '利润表', candidates: [{ tool: TOOLS.income, plan: 'Free', arguments_: { stock_code: bareStockSymbol(symbol) } }] },
        { label: '现金流量表', candidates: [{ tool: TOOLS.cashflow, plan: 'Free', arguments_: { stock_code: bareStockSymbol(symbol) } }] },
        {
            label: '估值',
            candidates: [{ tool: TOOLS.valuation, plan: 'Free', arguments_: {
                        symbol: normalizeStockSymbol(symbol),
                        start_date: range.since,
                        end_date: range.until,
                        page: 1,
                        page_size: 30,
                    } }],
        },
        {
            label: '公告',
            invoke: includeAnnouncements
                ? () => loadRecentAnnouncements(session, symbol, asOf, announcementLookbackDays, signal)
                : () => Promise.resolve({ data: [], metadata: { source: 'ftshare', skipped: true } }),
        },
        {
            label: '研报',
            candidates: includeResearch
                ? [{ tool: TOOLS.research, plan: 'Basic', arguments_: { type: 'StockReport', stock_code: normalizeStockSymbol(symbol), page: 1, page_size: 30 } }]
                : undefined,
            invoke: includeResearch ? undefined : () => Promise.resolve({ data: [], metadata: { source: 'ftshare', skipped: true } }),
        },
        ...(includeExtendedFacts ? [{
                label: '个股资金流',
                candidates: [{ tool: TOOLS.capitalFlowPreferred, plan: 'Free', arguments_: { symbol: normalizeStockSymbol(symbol), start_date: range.since, end_date: range.until, page: 1, page_size: 200 } }],
            }, {
                label: '风险暴露',
                invoke: includeRiskFacts ? undefined : () => Promise.resolve({ data: [], metadata: { skipped: true } }),
                candidates: [{ tool: TOOLS.betaPreferred, plan: 'Basic', arguments_: { symbol: normalizeStockSymbol(symbol), trade_date: compactDate(asOf) } }, { tool: TOOLS.beta, plan: 'Free', arguments_: { stock_code: bareStockSymbol(symbol), trade_date: compactDate(asOf) } }],
            }] : []),
        { label: '资产负债表', candidates: [{ tool: 'ft_v1_finance_balance', plan: 'Free', arguments_: { stock_code: bareStockSymbol(symbol) } }] },
    ];
    const calls = await Promise.allSettled(callSpecs.map(spec => spec.invoke
        ? spec.invoke().then(value => ({
            value,
            tool: isRecord(value.metadata) && typeof value.metadata.tool === 'string' ? value.metadata.tool : spec.label,
            plan: 'Free',
            attemptedTools: [TOOLS.announcementsPreferred, TOOLS.announcements],
            permissions: isRecord(value.metadata) && Array.isArray(value.metadata.permissions)
                ? value.metadata.permissions.filter(isRecord)
                : [],
            downgraded: isRecord(value.metadata) && value.metadata.downgraded === true,
        }))
        : callWithSubscriptionFallback(session, spec.candidates ?? [], signal)));
    const dataGaps = [];
    const warnings = [];
    const permissions = [];
    const blockedPermissions = [];
    const successful = new Map();
    const selectedTools = new Map();
    calls.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            successful.set(index, result.value.value);
            selectedTools.set(index, result.value.tool);
            const payloadPermissions = permissionNoticesFromPayload(result.value.tool, result.value.value);
            const effectivePermissions = [...result.value.permissions, ...payloadPermissions];
            permissions.push(...effectivePermissions);
            if (effectivePermissions.length > 0) {
                blockedPermissions.push(...effectivePermissions.map(notice => ({ ...notice, partial: hasSnapshotCallData(index, result.value.value) })));
            }
            dataGaps.push(...effectivePermissions.map(item => item.message));
            warnings.push(...effectivePermissions.map(item => item.message));
            if (result.value.downgraded)
                warnings.push(`FTShare ${callSpecs[index].label} 已从 ${result.value.attemptedTools[0]} 降级使用 ${result.value.tool}`);
            const warning = sourceWarning(result.value.value, result.value.tool);
            if (warning)
                warnings.push(warning);
        }
        else {
            dataGaps.push(`FTShare 工具调用失败：${callSpecs[index].label}`);
            if (isFtSharePermissionError(result.reason)) {
                const notices = permissionNotices(result.reason);
                permissions.push(...notices);
                blockedPermissions.push(...notices);
                dataGaps.push(...notices.map(item => item.message));
                warnings.push(...notices.map(item => item.message));
            }
            else {
                warnings.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
            }
        }
    });
    let securitySource = successful.get(0);
    // A Pro real-time endpoint can legitimately return an empty `items` array
    // outside a trading session. Treat that as unavailable and use the free
    // snapshot endpoint rather than exposing an empty quote as valid data.
    if (securitySource && selectedTools.get(0) === TOOLS.securityPreferred
        && !klineRows(securitySource).some(row => number(row, 'close', 'close_price', 'price', 'last', 'last_price') !== null)) {
        try {
            securitySource = await session.call(TOOLS.security, { stock_code: bareStockSymbol(symbol), page: 1, page_size: 5 }, signal);
            successful.set(0, securitySource);
            selectedTools.set(0, TOOLS.security);
            warnings.push(`FTShare ${TOOLS.securityPreferred} 返回空实时数据，已降级使用 ${TOOLS.security}`);
        }
        catch (error) {
            if (isFtSharePermissionError(error)) {
                const notices = permissionNotices(error);
                permissions.push(...notices);
                blockedPermissions.push(...notices);
                dataGaps.push(...notices.map(item => item.message));
                warnings.push(...notices.map(item => item.message));
            }
            else {
                warnings.push(error instanceof Error ? error.message : String(error));
            }
        }
    }
    const securityRows = securitySource ? klineRows(securitySource) : [];
    // An empty envelope (for example `{ data: [], metadata: ... }`) must not be
    // converted into a truthy quote object containing only null fields.  That
    // phantom quote would make downstream core-availability checks think the
    // report had usable market data and would suppress the correct module mask.
    const rawSecurityRow = securityRows[0] ?? rows(securitySource ?? {})[0];
    const securityRow = rawSecurityRow ? normalizeQuote(rawSecurityRow) : null;
    const ohlcvSource = successful.get(1);
    const incomeSource = successful.get(2);
    const cashflowSource = successful.get(3);
    const valuationSource = successful.get(4);
    const announcementSource = successful.get(5);
    const researchSource = successful.get(6);
    const capitalFlowSource = includeExtendedFacts ? successful.get(7) : undefined;
    const betaSource = includeExtendedFacts ? successful.get(8) : undefined;
    const balanceSource = successful.get(includeExtendedFacts ? 9 : 7);
    const name = text(securityRow ?? {}, 'name', 'stock_name', 'company_name')
        ?? text(rows(incomeSource ?? {})[0] ?? {}, 'stock_name', 'company_name', 'name')
        ?? text(rows(valuationSource ?? {})[0] ?? {}, 'stock_name', 'company_name', 'name')
        ?? symbol;
    const ohlcv = ohlcvSource ? parseOhlcv(ohlcvSource) : [];
    const valuationRows = valuationSource
        ? rows(valuationSource)
            .map(normalizeValuation)
            .sort((left, right) => String(right.trade_date ?? '').localeCompare(String(left.trade_date ?? '')))
        : [];
    const latestRow = (source) => {
        const sourceRows = source ? rows(source) : [];
        return sourceRows
            .slice()
            .sort((left, right) => String(right.trade_date ?? right.tradeDate ?? right.date ?? '').localeCompare(String(left.trade_date ?? left.tradeDate ?? left.date ?? '')))[0] ?? null;
    };
    const normalizeCapitalFlow = (row) => {
        if (!row)
            return null;
        return {
            ...row,
            trade_date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.ts_millis ?? row.tsMillis) ?? text(row, 'trade_date', 'tradeDate', 'date'),
            main_net_val: number(row, 'main_net_val', 'main_net', 'mainNet', 'main_net_inflow', 'mainNetInflow'),
            huge_net_val: number(row, 'huge_net_val', 'super_large_net', 'superLargeNet', 'huge_net', 'super_large_net_inflow'),
            large_net_val: number(row, 'large_net_val', 'large_net', 'largeNet', 'large_net_inflow'),
            medium_net_val: number(row, 'medium_net_val', 'medium_net', 'mediumNet', 'medium_net_inflow'),
            small_net_val: number(row, 'small_net_val', 'small_net', 'smallNet', 'small_net_inflow'),
        };
    };
    const normalizeBeta = (row) => {
        if (!row)
            return null;
        const generic = number(row, 'beta', 'beta_value');
        return {
            ...row,
            trade_date: dateText(row.trade_date ?? row.tradeDate ?? row.date ?? row.ts_millis ?? row.tsMillis) ?? text(row, 'trade_date', 'tradeDate', 'date'),
            beta_1y: number(row, 'beta_1y', 'beta1y', 'beta_1_year', 'one_year_beta') ?? generic,
            beta_2y: number(row, 'beta_2y', 'beta2y', 'beta_2_year', 'two_year_beta'),
            beta_100w: number(row, 'beta_100w', 'beta100w', 'beta_100_week', 'hundred_week_beta'),
        };
    };
    const capitalFlow = includeExtendedFacts ? normalizeCapitalFlow(latestRow(capitalFlowSource)) : null;
    const beta = includeExtendedFacts ? normalizeBeta(latestRow(betaSource)) : null;
    if (!securityRow)
        dataGaps.push('缺少 FTShare 实时行情数据');
    if (ohlcv.length === 0)
        dataGaps.push('缺少可用于技术分析的日线 OHLCV 数据');
    if (!incomeSource || rows(incomeSource).length === 0)
        dataGaps.push('缺少 FTShare 财务收入数据');
    if (!cashflowSource || rows(cashflowSource).length === 0)
        dataGaps.push('缺少 FTShare 现金流数据');
    if (valuationRows.length === 0)
        dataGaps.push('缺少 FTShare 估值数据');
    if (includeExtendedFacts && !capitalFlow)
        dataGaps.push('缺少 FTShare 个股资金流数据');
    if (includeRiskFacts && !beta)
        dataGaps.push('缺少 FTShare 风险暴露数据');
    if (includeAnnouncements && (!announcementSource || rows(announcementSource).length === 0))
        dataGaps.push('缺少 FTShare 公告数据');
    if (includeResearch && (!researchSource || rows(researchSource).length === 0))
        dataGaps.push('缺少 FTShare 研报数据');
    let marginDetail = null;
    let marginSource;
    const marginDate = ohlcv.filter(point => point.date <= asOf).at(-1)?.date;
    if (includeExtendedFacts && marginDate) {
        try {
            marginSource = await session.call('ft_v1_margin_trading_details', { stock: normalizeStockSymbol(symbol), date: compactDate(marginDate) }, signal);
            const row = rows(marginSource).find(row => bareStockSymbol(String(row.symbol ?? '')) === bareStockSymbol(symbol) && dateText(row.date) === marginDate);
            if (row) {
                const financing = number(row, 'margin_trading_balance');
                const total = number(row, 'total_balance');
                marginDetail = { trade_date: marginDate, fin_bal: financing, fin_buy_bal: number(row, 'margin_trading_buying_amount'),
                    sloan_bal: total !== null && financing !== null && total >= financing ? total - financing : null,
                    sloan_sell_vol: number(row, 'securities_lending_selling_volume'), mtss_bal: total };
            }
            if (!marginDetail)
                dataGaps.push(`FTShare ${marginDate} 未返回该标的两融记录`);
        }
        catch (error) {
            if (isFtSharePermissionError(error)) {
                const notices = permissionNotices(error);
                permissions.push(...notices);
                blockedPermissions.push(...notices);
                dataGaps.push(...notices.map(item => item.message));
            }
            else
                dataGaps.push('FTShare 两融接口调用失败');
            warnings.push(error instanceof Error ? error.message : String(error));
        }
    }
    const sources = [];
    [
        [selectedTools.get(0) ?? TOOLS.security, securitySource],
        [TOOLS.kline, ohlcvSource],
        [TOOLS.income, incomeSource],
        ['ft_v1_finance_balance', balanceSource],
        ['ft_v1_margin_trading_details', marginSource],
        [TOOLS.cashflow, cashflowSource],
        [TOOLS.valuation, valuationSource],
        ...(includeExtendedFacts ? [[selectedTools.get(7) ?? TOOLS.capitalFlow, capitalFlowSource], [selectedTools.get(8) ?? TOOLS.beta, betaSource]] : []),
        ...(includeAnnouncements ? [[selectedTools.get(5) ?? TOOLS.announcements, announcementSource]] : []),
        ...(includeResearch ? [[TOOLS.research, researchSource]] : []),
    ].forEach(([tool, source]) => {
        if (source)
            sources.push(provenance(tool, source));
    });
    const disclosedRows = (source) => source ? rows(source)
        .filter(row => !row.publish_date || String(row.publish_date).slice(0, 10) <= asOf)
        .sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0)
        || ({ annual: 4, q3: 3, q2: 2, q1: 1 }[String(b.report_type)] ?? 0) - ({ annual: 4, q3: 3, q2: 2, q1: 1 }[String(a.report_type)] ?? 0))
        .slice(0, 12) : [];
    return {
        symbol,
        name,
        asOf,
        quote: securityRow,
        ohlcv,
        financial: incomeSource || cashflowSource
            ? { income: disclosedRows(incomeSource), cashflow: disclosedRows(cashflowSource), balance: disclosedRows(balanceSource) }
            : null,
        valuation: valuationRows[0] ?? null,
        capitalFlow,
        marginDetail,
        beta,
        announcements: announcementSource ? rows(announcementSource).slice(0, 30) : [],
        research: researchSource ? rows(researchSource).slice(0, 30) : [],
        provenance: sources,
        dataGaps: [...new Set(dataGaps)],
        warnings: [...new Set(warnings)],
        permissions: [...new Map(permissions.map(item => [`${item.tool}:${item.requiredPlan}`, item])).values()],
        blockedPermissions: [...new Map(blockedPermissions.map(item => [`${item.tool}:${item.requiredPlan}`, item])).values()],
    };
}
//# sourceMappingURL=ftshare-data.js.map