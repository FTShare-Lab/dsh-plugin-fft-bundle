import { FtShareError, callWithSubscriptionFallback, isFtSharePermissionError, permissionNotices } from './ftshare-client.js';
import { loadSnapshot, rows } from './ftshare-data.js';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function unique(items, key) {
    const seen = new Set();
    return items.filter(item => {
        const value = key(item);
        if (seen.has(value))
            return false;
        seen.add(value);
        return true;
    });
}
function date8(value) {
    return value.replaceAll('-', '').slice(0, 8);
}
function previousCalendarDay(value) {
    const date = new Date(`${value}T12:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}
function timestampForDate(value, endOfDay = false) {
    const suffix = endOfDay ? 'T23:59:59.999+08:00' : 'T00:00:00.000+08:00';
    const timestamp = Date.parse(`${value}${suffix}`);
    if (!Number.isFinite(timestamp))
        throw new Error(`无效日期：${value}`);
    return timestamp;
}
function dateRange(asOf, days) {
    const end = new Date(`${asOf}T23:59:59.999+08:00`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - Math.max(days, 60));
    return { since: start.toISOString().slice(0, 10), until: asOf };
}
function flattenRows(value) {
    if (!value)
        return [];
    const valueRows = rows(value);
    if (valueRows.length > 0) {
        // Batch endpoints may wrap facts in grouped rows, e.g.
        // `{ data: [{ symbol, items: [{ ...quote }] }] }`.  Expand the group and
        // inherit its identity fields so downstream joins (members, ETFs and
        // sector breadth) receive ordinary fact rows rather than opaque shells.
        const envelopeKeys = new Set(['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response', 'content', 'metadata', 'permission', 'permissions', 'status', 'message', 'error', 'code', 'success', 'request_id']);
        const identityKeys = ['symbol', 'stock_code', 'stockCode', 'ts_code', 'tsCode', 'code', 'con_code', 'conCode'];
        const expand = (row, inherited = {}, depth = 0) => {
            if (depth > 5)
                return [];
            const identity = { ...inherited };
            for (const key of identityKeys) {
                const candidate = row[key];
                if (typeof candidate === 'string' || typeof candidate === 'number')
                    identity[key] = candidate;
            }
            const nested = ['items', 'data', 'rows', 'records', 'list', 'result', 'payload', 'response', 'content']
                .flatMap(key => {
                const child = row[key];
                return Array.isArray(child) || isRecord(child) ? [child] : [];
            });
            if (nested.length > 0) {
                const nestedRows = nested.flatMap(child => {
                    if (Array.isArray(child))
                        return child.flatMap(item => isRecord(item) ? expand(item, identity, depth + 1) : []);
                    return expand(child, identity, depth + 1);
                });
                if (nestedRows.length > 0)
                    return nestedRows;
            }
            const output = { ...row };
            for (const key of identityKeys)
                if (output[key] === undefined && identity[key] !== undefined)
                    output[key] = identity[key];
            const hasFact = Object.keys(output).some(key => !envelopeKeys.has(key) && output[key] !== undefined && output[key] !== null);
            return hasFact ? [output] : [];
        };
        const expanded = valueRows.flatMap(row => expand(row));
        if (expanded.length > 0)
            return expanded;
        return valueRows;
    }
    // A successful MCP response can still be an empty envelope such as
    // `{ data: [], metadata: ... }`. Do not turn that envelope into a fake row;
    // downstream availability checks need to distinguish real facts from an
    // empty response.
    const envelopeKeys = new Set(['data', 'rows', 'items', 'records', 'list', 'metadata', 'permission', 'permissions', 'status', 'message', 'error', 'code', 'success', 'request_id']);
    return Object.keys(value).some(key => !envelopeKeys.has(key)) ? [value] : [];
}
function flattenKlineRows(value, assetType) {
    if (!value)
        return [];
    const groups = rows(value);
    const nested = groups.flatMap(group => {
        if (!Array.isArray(group.items))
            return [];
        return group.items.filter(isRecord).map(item => ({ ...item, symbol: item.symbol ?? group.symbol, asset_type: assetType }));
    });
    return nested.length > 0 ? nested : flattenRows(value).map(row => ({ ...row, asset_type: assetType }));
}
function addSource(provenance, tool, source) {
    if (!source)
        return;
    provenance.push({
        provider: 'ftshare',
        tool,
        retrievedAt: new Date().toISOString(),
        metadata: isRecord(source.metadata) ? source.metadata : undefined,
    });
}
function normalizeStockSymbol(value) {
    const symbol = value.trim();
    if (/\.[A-Za-z]+$/.test(symbol))
        return symbol.toUpperCase();
    if (/^5\d{5}$/.test(symbol))
        return `${symbol}.SH`;
    if (/^6\d{5}$/.test(symbol))
        return `${symbol}.SH`;
    if (/^(4|8|9)\d{5}$/.test(symbol))
        return `${symbol}.BJ`;
    return `${symbol}.SZ`;
}
function currentSymbol(value) {
    const candidate = value.symbol ?? value.stock_code ?? value.ts_code ?? value.code;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}
async function optionalCall(session, toolOrCandidates, arguments_, signal, state) {
    const candidates = typeof toolOrCandidates === 'string'
        ? [{ tool: toolOrCandidates, arguments_: arguments_ ?? {} }]
        : toolOrCandidates;
    try {
        const result = await (async () => {
            for (let attempt = 0;; attempt++) {
                try {
                    return await callWithSubscriptionFallback(session, candidates, signal);
                }
                catch (error) {
                    if (!(error instanceof FtShareError) || error.code !== 'UPSTREAM_UNAVAILABLE' || attempt >= 2 || signal.aborted)
                        throw error;
                    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                }
            }
        })();
        state.permissions.push(...result.permissions);
        state.blockedPermissions.push(...result.permissions);
        state.dataGaps.push(...result.permissions.map(item => item.message));
        state.warnings.push(...result.permissions.map(item => item.message));
        if (result.downgraded)
            state.warnings.push(`FTShare 数据已从 ${result.attemptedTools[0]} 降级使用 ${result.tool}`);
        if (flattenRows(result.value).length === 0) {
            const gap = `FTShare 数据为空：${result.tool}`;
            state.dataGaps.push(gap);
            state.warnings.push(gap);
            return null;
        }
        addSource(state.provenance, result.tool, result.value);
        return result.value;
    }
    catch (error) {
        if (isFtSharePermissionError(error)) {
            const notices = permissionNotices(error);
            state.permissions.push(...notices);
            state.blockedPermissions.push(...notices);
            state.dataGaps.push(...notices.map(item => item.message));
            state.warnings.push(...notices.map(item => item.message));
        }
        else {
            state.dataGaps.push(`FTShare 工具调用失败：${candidates.map(item => item.tool).join('、')}`);
            state.warnings.push(error instanceof Error ? error.message : String(error));
        }
        return null;
    }
}
async function loadStockSnapshots(session, symbols, asOf, config, signal, state) {
    const normalized = unique(symbols.map(value => value.trim()).filter(Boolean), value => value);
    const loaded = await Promise.all(normalized.slice(0, 30).map(async (symbol) => {
        try {
            const snapshot = await loadSnapshot(session, symbol, asOf, config.maxKlineDays, signal, config.announcementLookbackDays, { includeExtendedFacts: true });
            state.permissions.push(...snapshot.permissions);
            state.blockedPermissions.push(...(snapshot.blockedPermissions ?? []));
            state.dataGaps.push(...snapshot.dataGaps);
            state.warnings.push(...snapshot.warnings);
            state.provenance.push(...snapshot.provenance);
            return snapshot;
        }
        catch (error) {
            if (isFtSharePermissionError(error)) {
                const notices = permissionNotices(error);
                state.permissions.push(...notices);
                state.blockedPermissions.push(...notices);
                state.dataGaps.push(...notices.map(item => item.message));
                state.warnings.push(...notices.map(item => item.message));
            }
            else {
                state.dataGaps.push(`无法加载 ${symbol} 的 FTShare 数据`);
                state.warnings.push(error instanceof Error ? error.message : String(error));
            }
            return null;
        }
    }));
    return loaded.filter((value) => value !== null);
}
async function loadMarketFacts(session, asOf, phase, signal, state) {
    const day = date8(asOf);
    const range = dateRange(asOf, 30);
    const calls = [
        ['ft_v1_daec_stocks', { page: 1, page_size: 100, order_by: 'change_rate desc' }, 'market'],
        ['ft_v1_daec_market_snapshot', {}, 'market'],
        ['ft_v1_eastmoney_market_valuation', { trade_date: day, page: 1, page_size: 100 }, 'indices'],
        ['ft_v1_stock_capital_flows', { date: day, page: 1, page_size: 100 }, 'flows'],
        ['ft_v1_limit_list', { limit_type: 'up', trade_date: day }, 'limits'],
        ['ft_v3_announcements_stock_announcements', { type: 'stock', start_date: day, page: 1, page_size: 100 }, 'announcements'],
        ['ft_v2_eastmoney_dapan_flow', { start_date: date8(range.since), end_date: date8(range.until), page: 1, page_size: 100 }, 'flows'],
        ['ft_v2_ths_hot_list', { list_type: 'stock_day', trade_date: day, page: 1, page_size: 50 }, 'news'],
        // ETF descriptions commonly carry the latest day change and turnover;
        // the market commentary template uses these as an independently sourced
        // ETF observation list.
        ['ft_v2_etf_description_all', { page: 1, page_size: 50 }, 'market'],
    ];
    const results = await Promise.all(calls.map(async ([tool, args, bucket]) => ({
        tool,
        bucket,
        value: tool === 'ft_v3_announcements_stock_announcements'
            ? await optionalCall(session, [
                { tool: 'ft_v3_announcements_stock_announcements', plan: 'Basic', arguments_: args },
                { tool: 'ft_v1_report_announcements_list', plan: 'Free', arguments_: { date: day, page: 1, page_size: 100 } },
            ], undefined, signal, state)
            : await optionalCall(session, tool, args, signal, state),
    })));
    for (const result of results) {
        if (!result.value)
            continue;
        const valueRows = flattenRows(result.value);
        state.raw[result.tool] = result.value;
        state[result.bucket].push(...valueRows);
    }
    // Current-day endpoints may be published asynchronously (especially before
    // the close). Retry the empty buckets against the most recent prior day so
    // the report remains populated and explicitly records the freshness shift.
    const fallbackAsOf = previousCalendarDay(asOf);
    const fallbackDay = date8(fallbackAsOf);
    const clearEmpty = (tool) => {
        const marker = `FTShare 数据为空：${tool}`;
        state.dataGaps = state.dataGaps.filter(item => item !== marker);
        state.warnings = state.warnings.filter(item => item !== marker);
    };
    const hasAggregate = state.market.some(row => ['up_count', 'down_count', 'flat_count', 'limit_up_count', 'limit_down_count'].some(key => row[key] !== undefined));
    if (!hasAggregate) {
        const snapshot = await optionalCall(session, 'ft_v1_daec_market_snapshot', { trade_date: fallbackDay }, signal, state);
        if (snapshot) {
            state.market.push(...flattenRows(snapshot));
            clearEmpty('ft_v1_daec_market_snapshot');
        }
    }
    if (!state.indices.length) {
        const indices = await optionalCall(session, 'ft_v1_eastmoney_market_valuation', { trade_date: fallbackDay, page: 1, page_size: 100 }, signal, state);
        if (indices) {
            state.indices.push(...flattenRows(indices));
            clearEmpty('ft_v1_eastmoney_market_valuation');
        }
    }
    if (!state.flows.length) {
        const [stockFlows, marketFlows] = await Promise.all([
            optionalCall(session, 'ft_v1_stock_capital_flows', { date: fallbackDay, page: 1, page_size: 100 }, signal, state),
            optionalCall(session, 'ft_v2_eastmoney_dapan_flow', { start_date: fallbackDay, end_date: fallbackDay, page: 1, page_size: 100 }, signal, state),
        ]);
        if (stockFlows) {
            state.flows.push(...flattenRows(stockFlows));
            clearEmpty('ft_v1_stock_capital_flows');
        }
        if (marketFlows) {
            state.flows.push(...flattenRows(marketFlows));
            clearEmpty('ft_v2_eastmoney_dapan_flow');
        }
    }
    if (!state.limits.length) {
        const limits = await optionalCall(session, 'ft_v1_limit_list', { limit_type: 'up', trade_date: fallbackDay }, signal, state);
        if (limits) {
            state.limits.push(...flattenRows(limits));
            clearEmpty('ft_v1_limit_list');
        }
    }
    if (fallbackAsOf !== asOf && (state.market.length || state.indices.length || state.flows.length || state.limits.length)) {
        state.warnings.push(`FTShare ${day} 尚无完整市场快照，已使用 ${fallbackDay} 最近可用数据。`);
    }
    // ETF observation is part of the noon report, not an optional decoration.
    // Pull a bounded live universe from the ETF description endpoint and then
    // resolve today's quote/candle facts so the ETF section is populated from
    // FTShare instead of silently rendering an empty shell.
    if (phase === 'midday' || phase === 'after_close' || phase == null) {
        await loadMarketEtfFacts(session, asOf, signal, state);
    }
}
async function loadMarketEtfFacts(session, asOf, signal, state) {
    const descriptions = await optionalCall(session, 'ft_v2_etf_description_all', { page: 1, page_size: 80 }, signal, state);
    if (!descriptions)
        return;
    const descriptionRows = flattenRows(descriptions);
    state.raw.ft_v2_etf_description_all = descriptions;
    state.market.push(...descriptionRows.map(row => ({ ...row, asset_type: 'etf' })));
    const symbols = unique(descriptionRows
        .map(row => row.etf_code ?? row.symbol ?? row.code ?? row.fund_code)
        .filter(value => (typeof value === 'string' || typeof value === 'number') && /^\d{6}(?:\.(?:SH|SZ|BJ))?$/i.test(String(value).trim()))
        .map(value => normalizeStockSymbol(String(value)))
        .filter(Boolean), value => value).slice(0, 20);
    if (symbols.length === 0)
        return;
    const realtime = await optionalCall(session, 'ft_v4_etf_realtime_day_kline', { symbols }, signal, state);
    if (realtime) {
        state.raw.ft_v4_etf_realtime_day_kline = realtime;
        state.market.push(...flattenRows(realtime).map(row => ({ ...row, asset_type: 'etf' })));
        return;
    }
    // Keep the fallback bounded: older/free gateways may only expose one ETF
    // candle request at a time. Any unavailable symbol remains a disclosed gap.
    const range = dateRange(asOf, 30);
    const candleRows = await Promise.all(symbols.slice(0, 8).map(async (symbol) => {
        const value = await optionalCall(session, 'ft_v1_etf_candlesticks', {
            symbol,
            interval_unit: 'Day',
            interval_value: 1,
            since_ts_millis: timestampForDate(range.since),
            until_ts_millis: timestampForDate(range.until, true),
            adjust_kind: 'Forward',
            limit: 60,
        }, signal, state);
        return value ? flattenRows(value).map(row => ({ ...row, symbol, asset_type: 'etf' })) : [];
    }));
    state.market.push(...candleRows.flat());
}
async function loadSectorFacts(session, request, asOf, signal, state) {
    const day = date8(asOf);
    const sectorName = request.sectorName?.trim();
    const sectorCode = request.sectorCode?.trim();
    // Resolve the THS industry code first.  The report request uses an
    // Eastmoney BK code, while the historical board K-line endpoint uses a THS
    // numeric code (for example 电力 -> 881145).
    const boardList = await optionalCall(session, 'ft_v1_ths_board_list', {}, signal, state);
    const boardRows = flattenRows(boardList);
    const normalizeLabel = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    const requestedNames = new Set([sectorName, sectorCode].filter(Boolean).map(normalizeLabel));
    const labelsFor = (row) => [row.name, row.board_name, row.boardName, row.sector_name, row.industry_name, row.code, row.board_code]
        .map(normalizeLabel).filter(Boolean);
    // Prefer exact identity; a substring must not select 第三代半导体 for 半导体.
    const exactBoards = boardRows.filter(row => labelsFor(row).some(label => requestedNames.has(label)));
    const fuzzyBoards = boardRows.filter(row => labelsFor(row).some(label => [...requestedNames].some(target => label.includes(target) || target.includes(label))));
    const thsBoard = exactBoards.find(row => row.module === 'industry') ?? exactBoards[0]
        ?? (fuzzyBoards.length === 1 ? fuzzyBoards[0] : undefined);
    const thsBoardCode = thsBoard ? String(thsBoard.code ?? thsBoard.board_code ?? '').trim()
        : sectorCode && /^\d{6}$/.test(sectorCode) ? sectorCode : undefined;
    const historyStart = date8(dateRange(asOf, 120).since);
    const klineCandidates = thsBoardCode ? [{
            tool: 'ft_v1_ths_board_kline', plan: 'Free',
            arguments_: { board_code: thsBoardCode, page: 1, page_size: 200 },
        }] : [];
    if (!thsBoardCode)
        state.dataGaps.push('未能唯一匹配同花顺板块代码，未请求其他板块行情');
    const calls = [
        ['ft_v1_sw_industry_overview', { date: day, level: 2, page: 1, page_size: 200 }, 'sectors'],
        ...(klineCandidates.length ? [[klineCandidates[0].tool, klineCandidates[0].arguments_, 'sectors']] : []),
        ['ft_v1_ths_industry_daily_flow', { start_date: historyStart, end_date: day, sector_name: sectorName, page: 1, page_size: 200 }, 'flows'],
        ['ft_v1_eastmoney_sector_flow', { sector_code: sectorCode, sector_type: 'industry', start_date: historyStart, end_date: day, page: 1, page_size: 200 }, 'flows'],
        ['ft_v1_tdx_board_members', { idx_name: sectorName, page: 1, page_size: 500 }, 'sectors'],
        ['ft_v3_supply_chain_subindustry_supply_chain', { industry_name: sectorName ?? sectorCode ?? 'A股', direction: 'upstream' }, 'news'],
        ['ft_v3_supply_chain_subindustry_supply_chain', { industry_name: sectorName ?? sectorCode ?? 'A股', direction: 'downstream' }, 'news'],
    ];
    const results = await Promise.all(calls.map(async ([tool, args, bucket]) => ({
        tool,
        bucket,
        value: tool === klineCandidates[0]?.tool
            ? await optionalCall(session, klineCandidates, undefined, signal, state)
            : await optionalCall(session, tool, args, signal, state),
    })));
    for (const result of results) {
        if (!result.value)
            continue;
        state.raw[`${result.tool}:${result.bucket}`] = result.value;
        const valueRows = result.tool === klineCandidates[0]?.tool
            ? flattenKlineRows(result.value, 'sector').filter(row => {
                const date = String(row.date ?? row.trade_date ?? '').replaceAll('-', '').slice(0, 8);
                return date >= historyStart && date <= day;
            }).map(row => ({ ...row, board_code: thsBoardCode, board_name: sectorName, requested_sector_code: sectorCode }))
            : flattenRows(result.value);
        if (result.tool === 'ft_v1_tdx_board_members') {
            state.constituents.push(...valueRows.map(row => ({
                code: String(row.con_code ?? row.constituent_code ?? row.stock_code ?? row.symbol ?? row.code ?? '').trim(),
                name: String(row.con_name ?? row.constituent_name ?? row.stock_name ?? row.name ?? '').trim(),
            })).filter(row => row.code && row.name));
        }
        else {
            state[result.bucket].push(...valueRows.map(row => ({ ...row, source_tool: result.tool })));
        }
    }
    // FTShare may not have published the requested day's close yet (for
    // example, a morning request for the current trading day). Retry the daily
    // snapshots against the most recent prior calendar day instead of rendering
    // an entirely blank report.
    let fallbackAsOf = previousCalendarDay(asOf);
    while ([0, 6].includes(new Date(`${fallbackAsOf}T12:00:00+08:00`).getUTCDay()))
        fallbackAsOf = previousCalendarDay(fallbackAsOf);
    const fallbackDay = date8(fallbackAsOf);
    const clearEmptyNotice = (tool) => {
        const marker = `FTShare 数据为空：${tool}`;
        state.dataGaps = state.dataGaps.filter(item => item !== marker);
        state.warnings = state.warnings.filter(item => item !== marker);
    };
    if (!state.flows.some(row => row.sector_name || row.sector_code)) {
        const [thsFlow, eastmoneyFlow] = await Promise.all([
            optionalCall(session, 'ft_v1_ths_industry_daily_flow', { start_date: fallbackDay, end_date: fallbackDay, sector_name: sectorName, page: 1, page_size: 500 }, signal, state),
            optionalCall(session, 'ft_v1_eastmoney_sector_flow', { sector_code: sectorCode, sector_type: 'industry', trade_date: fallbackDay, page: 1, page_size: 200 }, signal, state),
        ]);
        if (thsFlow) {
            state.flows.push(...flattenRows(thsFlow));
            clearEmptyNotice('ft_v1_ths_industry_daily_flow');
        }
        if (eastmoneyFlow) {
            state.flows.push(...flattenRows(eastmoneyFlow));
            clearEmptyNotice('ft_v1_eastmoney_sector_flow');
        }
        if (thsFlow || eastmoneyFlow)
            state.warnings.push(`FTShare ${day} 尚无已发布板块资金快照，已使用 ${fallbackDay} 最近可用数据。`);
    }
    if (!state.sectors.some(row => row.industryName || row.industryCode || row.industry_name || row.industry_code || row.sector_name || row.sector_code)) {
        const overview = await optionalCall(session, 'ft_v1_sw_industry_overview', { date: fallbackDay, level: 2, page: 1, page_size: 200 }, signal, state);
        if (overview) {
            state.sectors.push(...flattenRows(overview));
            clearEmptyNotice('ft_v1_sw_industry_overview');
            state.warnings.push(`FTShare ${day} 尚无申万行业估值快照，已使用 ${fallbackDay} 最近可用数据。`);
        }
    }
    // Resolve actual child industries from dated SW membership, never from a
    // fuzzy name match or by placing the parent index into the child table.
    const parent = state.sectors.find(row => String(row.industryName ?? row.industry_name ?? '') === sectorName);
    const parentCode = parent?.industryCode ?? parent?.industry_code;
    const classifications = Array.isArray(state.raw.sector_classifications) ? [...state.raw.sector_classifications] : [];
    if (parentCode && state.raw.sector_classifications_complete !== true) {
        for (let page = Number(state.raw.sector_classifications_next_page ?? 1); page <= 50; page++) {
            const value = await optionalCall(session, 'ft_v1_sw_industry_constituent_history', { industry_code: parentCode, page, page_size: 100 }, signal, state);
            const found = flattenRows(value);
            classifications.push(...found);
            const metadata = value?.metadata;
            const pagination = metadata?.pagination;
            if (!value) {
                state.raw.sector_classifications_next_page = page;
                break;
            }
            state.raw.sector_classifications_next_page = page + 1;
            if (pagination?.has_more === false || found.length < 100) {
                state.raw.sector_classifications_complete = true;
                break;
            }
        }
    }
    state.raw.sector_classifications = classifications.filter(row => {
        const entered = String(row.inDate ?? '').replaceAll('-', '');
        const exited = String(row.outDate ?? '').replaceAll('-', '');
        return (!entered || entered <= day) && (!exited || exited > day);
    });
    const memberSymbols = unique(state.constituents.map(item => normalizeStockSymbol(item.code)).filter(Boolean), value => value);
    if (!memberSymbols.length)
        return;
    // Request the highest tier, but historical breadth always uses a common
    // closing date. Fetch every constituent with bounded concurrency.
    const realtime = await optionalCall(session, 'ft_v4_stock_realtime_day_kline', { symbols: memberSymbols }, signal, state);
    const historyRows = Array.isArray(state.raw.sector_member_history) ? [...state.raw.sector_member_history] : [];
    const loadedSymbols = new Set(historyRows.map(row => String(row.symbol)));
    const pendingSymbols = memberSymbols.filter(symbol => !loadedSymbols.has(symbol));
    const companyRows = [];
    let next = 0;
    const range = dateRange(asOf, 65);
    await Promise.all(Array.from({ length: Math.min(3, pendingSymbols.length) }, async () => {
        while (next < pendingSymbols.length) {
            const symbol = pendingSymbols[next++];
            const history = await optionalCall(session, 'ft_v1_stock_candlesticks', {
                symbol, interval_unit: 'Day', since_ts_millis: timestampForDate(range.since), until_ts_millis: timestampForDate(asOf, true), adjust_kind: 'Forward', limit: 65,
            }, signal, state);
            historyRows.push(...flattenKlineRows(history, 'stock').map(row => ({ ...row, symbol })));
            if (!history) {
                const company = await optionalCall(session, 'ft_v1_company_list', { stock_code: symbol.split('.')[0], page: 1, page_size: 1 }, signal, state);
                companyRows.push(...flattenRows(company));
            }
        }
    }));
    state.raw.sector_member_history = historyRows;
    state.raw.sector_member_quotes = realtime ?? { data: companyRows };
}
async function loadLimitFacts(session, asOf, signal, state) {
    const day = date8(asOf);
    const calls = [
        ['ft_v1_limit_list', { limit_type: 'up', trade_date: day }, 'limits'],
        ['ft_v1_limit_list', { limit_type: 'up_break', trade_date: day }, 'limits'],
        ['ft_v2_limit_event_timeline_3s', { trade_date: day, page: 1, page_size: 30 }, 'limits'],
        ['ft_v3_limit_up_reports_briefs', { date: day }, 'news'],
        ['ft_v3_announcements_stock_announcements', { type: 'stock', start_date: day, page: 1, page_size: 200 }, 'announcements'],
    ];
    const results = await Promise.all(calls.map(async ([tool, args, bucket]) => ({
        tool,
        bucket,
        value: tool === 'ft_v3_announcements_stock_announcements'
            ? await optionalCall(session, [
                { tool: 'ft_v3_announcements_stock_announcements', plan: 'Basic', arguments_: args },
                { tool: 'ft_v1_report_announcements_list', plan: 'Free', arguments_: { date: day, page: 1, page_size: 200 } },
            ], undefined, signal, state)
            : await optionalCall(session, tool, args, signal, state),
    })));
    for (const result of results) {
        if (!result.value)
            continue;
        state.raw[`${result.tool}:${result.bucket}`] = result.value;
        state[result.bucket].push(...flattenRows(result.value));
    }
}
async function loadEtfFacts(session, symbols, asOf, config, signal, state) {
    const range = dateRange(asOf, config.maxKlineDays);
    const normalized = unique(symbols.map(normalizeStockSymbol), value => value).slice(0, 30);
    const descriptions = await optionalCall(session, 'ft_v2_etf_description_all', { page: 1, page_size: 50 }, signal, state);
    if (descriptions) {
        state.raw.ft_v2_etf_description_all = descriptions;
        state.market.push(...flattenRows(descriptions).map(row => ({ ...row, asset_type: 'etf' })));
    }
    if (asOf === new Date().toISOString().slice(0, 10) && normalized.length > 0) {
        const realtime = await optionalCall(session, 'ft_v4_etf_realtime_day_kline', { symbols: normalized }, signal, state);
        if (realtime) {
            state.raw.ft_v4_etf_realtime_day_kline = realtime;
            state.indices.push(...flattenKlineRows(realtime, 'etf'));
        }
    }
    const results = await Promise.all(normalized.map(async (symbol) => ({
        symbol,
        value: await optionalCall(session, 'ft_v1_etf_candlesticks', {
            symbol,
            interval_unit: 'Day',
            interval_value: 1,
            since_ts_millis: timestampForDate(range.since),
            until_ts_millis: timestampForDate(range.until, true),
            adjust_kind: 'Forward',
            limit: 500,
        }, signal, state),
    })));
    for (const result of results) {
        if (!result.value)
            continue;
        state.raw[`ft_v1_etf_candlesticks:${result.symbol}`] = result.value;
        state.indices.push(...flattenRows(result.value).map(row => ({ ...row, symbol: result.symbol, asset_type: 'etf' })));
    }
}
export async function loadReportFacts(session, request, asOf, config, signal, previous) {
    const state = {
        reportType: request.reportType,
        asOf,
        request,
        snapshots: [],
        market: [],
        indices: [],
        sectors: previous?.sectors ? [...previous.sectors] : [],
        constituents: previous?.constituents ? [...previous.constituents] : [],
        flows: previous?.flows ? [...previous.flows] : [],
        limits: [],
        announcements: [],
        news: [],
        raw: previous?.raw ? { ...previous.raw } : {},
        provenance: [],
        permissions: [],
        blockedPermissions: [],
        dataGaps: [],
        warnings: [],
    };
    const symbols = unique([
        ...(request.symbol ? [request.symbol] : []),
        ...(request.symbols ?? []),
        ...(request.holdings ?? []).map(item => item.symbol),
    ].map(value => value.trim()).filter(Boolean), value => value);
    if (['deep_read', 'holding_analysis', 'portfolio_stocks', 'review'].includes(request.reportType)) {
        state.snapshots = await loadStockSnapshots(session, symbols, asOf, config, signal, state);
    }
    if (request.reportType === 'portfolio_etfs') {
        await loadEtfFacts(session, symbols, asOf, config, signal, state);
    }
    if (['market_commentary', 'review', 'limit_up_attribution'].includes(request.reportType)) {
        await loadMarketFacts(session, asOf, request.phase, signal, state);
    }
    if (request.reportType === 'sector_analysis') {
        await loadSectorFacts(session, request, asOf, signal, state);
    }
    if (request.reportType === 'limit_up_attribution') {
        await loadLimitFacts(session, asOf, signal, state);
    }
    state.permissions = unique(state.permissions, item => `${item.tool}:${item.requiredPlan}`);
    state.blockedPermissions = unique(state.blockedPermissions.map(notice => ({
        ...notice,
        partial: notice.partial === true || state.provenance.some(source => source.tool === notice.tool),
    })), item => `${item.tool}:${item.requiredPlan}`);
    state.dataGaps = [...new Set(state.dataGaps)];
    state.warnings = [...new Set(state.warnings)];
    state.provenance = unique(state.provenance, item => `${item.tool}:${item.retrievedAt.slice(0, 19)}`);
    state.constituents = unique(state.constituents, item => item.code);
    const rowKey = (row) => {
        const id = row.id ?? row.announcement_id ?? row.url_hash;
        if (id !== undefined && id !== null && String(id).trim())
            return `id:${String(id)}`;
        const symbol = row.symbol ?? row.stock_code ?? row.ts_code ?? row.code;
        const date = row.trade_date ?? row.tradeDate ?? row.date ?? row.datetime ?? row.ts_millis ?? row.tsMillis;
        // Time-series rows must retain one entry per symbol/date.  Using only the
        // symbol would silently collapse an entire K-line history to its latest
        // row during the final bucket de-duplication pass.
        if (symbol !== undefined && symbol !== null && date !== undefined && date !== null)
            return `series:${String(row.asset_type ?? '')}:${String(symbol)}:${String(date)}`;
        if (symbol !== undefined && symbol !== null && String(symbol).trim())
            return `symbol:${String(symbol)}`;
        if (row.title !== undefined && row.title !== null && String(row.title).trim())
            return `title:${String(row.title)}`;
        return JSON.stringify(row);
    };
    for (const bucket of ['market', 'indices', 'sectors', 'flows', 'limits', 'announcements', 'news'])
        state[bucket] = unique(state[bucket], rowKey);
    return state;
}
//# sourceMappingURL=report-data.js.map