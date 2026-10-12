import { FtShareClient, isFtSharePermissionError } from './ftshare-client.js';
import { loadSnapshot, rows } from './ftshare-data.js';
import { generateInvestmentReport } from './report-service.js';
const CSI1000_CODE = '000852';
const DEFAULT_PORTFOLIO_SIZE = 5;
const DEFAULT_PORTFOLIO_COUNT = 1;
const DEFAULT_MAX_CANDIDATES = 60;
const DEFAULT_MAX_SINGLE_WEIGHT = 0.30;
const DEFAULT_MAX_INDUSTRY_WEIGHT = 0.50;
const MAX_INDEX_PAGES = 20;
const INDEX_CONSTITUENT_TOOLS = [
    // The first name is the governed Finpowers/FTShare capability name. Older
    // FTShare gateways used one of the ft_v* aliases, so retain compatibility.
    'ft_v1_index_index_weight',
    'ft_v1_index_constituents',
    'ft_v2_index_constituents',
    'ft_v1_index_components',
    'ft_v2_index_components',
];
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function number(row, ...keys) {
    if (!row)
        return null;
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
            return Number(value);
    }
    return null;
}
function text(row, ...keys) {
    if (!row)
        return null;
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
        if (typeof value === 'number' && Number.isFinite(value))
            return String(value);
    }
    return null;
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
function canonicalSymbol(value) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed)
        return '';
    if (/\.[A-Z]+$/.test(trimmed))
        return trimmed;
    if (/^6\d{5}$/.test(trimmed))
        return `${trimmed}.SH`;
    if (/^(4|8|9)\d{5}$/.test(trimmed))
        return `${trimmed}.BJ`;
    return `${trimmed}.SZ`;
}
function normalizeIndexCode(value) {
    return bareSymbol(value).replace(/[^0-9A-Z_-]/gi, '').toUpperCase();
}
function bareSymbol(value) {
    return value.replace(/\.(XSHG|XSHE|SH|SZ|BJ)$/i, '').trim().toUpperCase();
}
function dateValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value >= 19_000_101 && value <= 29_991_231)
            return dateValue(String(Math.trunc(value)));
        const millis = value > 10_000_000_000 ? value : value * 1000;
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    if (typeof value !== 'string' || !value.trim())
        return null;
    const trimmed = value.trim();
    if (/^\d{8}$/.test(trimmed))
        return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    return trimmed.slice(0, 10);
}
function validAsOf(value) {
    const result = value ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result))
        throw new Error('asOf 必须是 YYYY-MM-DD');
    return result;
}
function clamp(value, lower = 0, upper = 1) {
    return Math.min(upper, Math.max(lower, Number.isFinite(value) ? value : lower));
}
function mean(values) {
    const valid = values.filter(value => Number.isFinite(value));
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}
function stdev(values) {
    const valid = values.filter(value => Number.isFinite(value));
    if (valid.length < 2)
        return null;
    const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
    return Math.sqrt(valid.reduce((sum, value) => sum + (value - average) ** 2, 0) / (valid.length - 1));
}
function percentile(values, value, higherIsBetter = true) {
    if (value === null || !Number.isFinite(value))
        return 0.5;
    const valid = values.filter((item) => item !== null && Number.isFinite(item));
    if (valid.length < 2)
        return 0.5;
    const sorted = [...valid].sort((left, right) => left - right);
    let rank = sorted.findIndex(item => item >= value);
    if (rank < 0)
        rank = sorted.length - 1;
    const raw = rank / (sorted.length - 1);
    return higherIsBetter ? raw : 1 - raw;
}
function sourceWarning(source, tool) {
    if (!isRecord(source.metadata))
        return null;
    const pagination = isRecord(source.metadata.pagination) ? source.metadata.pagination : {};
    if (source.metadata.truncated === true && pagination.has_more !== true)
        return `${tool} 返回结果被截断`;
    if (source.metadata.fallback === true)
        return `${tool} 使用了上游降级结果`;
    if (Array.isArray(source.metadata.warnings) && source.metadata.warnings.length > 0) {
        const warnings = source.metadata.warnings
            .map(String)
            .filter(message => !(pagination.has_more === true && /截断|大小限制/.test(message)));
        return warnings.length ? `${tool}：${warnings.join('；')}` : null;
    }
    return null;
}
function addSource(state, tool, source) {
    state.provenance.push({
        provider: 'ftshare',
        tool,
        retrievedAt: new Date().toISOString(),
        metadata: isRecord(source.metadata) ? source.metadata : undefined,
    });
    const warning = sourceWarning(source, tool);
    if (warning)
        state.warnings.push(warning);
}
function addPermission(state, permission) {
    state.permissions.push(permission);
    state.dataGaps.push(permission.message);
    state.warnings.push(permission.message);
}
async function callOptional(session, tool, args, signal, state, logger) {
    try {
        const result = await session.call(tool, args, signal);
        addSource(state, tool, result);
        return result;
    }
    catch (error) {
        if (isFtSharePermissionError(error)) {
            addPermission(state, error.permission);
            logger?.warn('ftshare.permission_denied', {
                step: tool,
                code: error.permission.code,
                requiredPlan: error.permission.requiredPlan,
                errorType: 'permission_denied',
            });
        }
        return null;
    }
}
function constituentRows(source) {
    const valueRows = rows(source);
    if (valueRows.length)
        return valueRows;
    const nested = source.data;
    if (isRecord(nested))
        return rows(nested);
    return [];
}
function constituentCode(row) {
    return text(row, 'constituent_code', 'component_code', 'stock_code', 'symbol', 'ts_code', 'code', 'security_code');
}
async function collectIndexRows(session, tool, indexCode, date, asOf, signal, state, logger) {
    let cursor;
    const collected = [];
    let succeeded = false;
    const isWeightTool = tool === 'ft_v1_index_index_weight';
    for (let page = 0; page < MAX_INDEX_PAGES; page += 1) {
        const args = isWeightTool
            ? { index_code: indexCode, ...(date ? { date } : {}), page: page + 1, page_size: 100 }
            : { index_code: indexCode, included_date_to: asOf, limit: 200, page: page + 1, page_size: 200, ...(cursor ? { cursor } : {}) };
        const result = await callOptional(session, tool, args, signal, state, logger);
        if (!result)
            break;
        succeeded = true;
        const currentRows = constituentRows(result);
        collected.push(...currentRows);
        const metadata = isRecord(result.metadata) ? result.metadata : {};
        const pagination = isRecord(metadata.pagination) ? metadata.pagination : {};
        const nextCursor = text(metadata, 'next_cursor', 'nextCursor', 'cursor');
        const hasMore = pagination.has_more === true || Boolean(nextCursor);
        if (!hasMore || currentRows.length === 0)
            break;
        if (!isWeightTool)
            cursor = nextCursor ?? String(page + 2);
    }
    return { rows: collected, succeeded };
}
function currentIndexSymbols(sourceRows, asOf) {
    return unique(sourceRows
        .filter(row => {
        const included = dateValue(row.included_date ?? row.include_date ?? row.effective_date);
        const removed = dateValue(row.removed_date ?? row.remove_date ?? row.end_date);
        const rowDate = dateValue(row.date ?? row.trade_date);
        return (!included || included <= asOf) && (!removed || removed > asOf) && (!rowDate || rowDate <= asOf);
    })
        .map(constituentCode)
        .filter((value) => Boolean(value))
        .map(canonicalSymbol)
        .filter(Boolean), bareSymbol);
}
async function effectiveWeightDate(session, indexCode, asOf, signal, state, logger) {
    const summary = await callOptional(session, 'ft_v1_index_index_weight_summary', { index_code: indexCode, page: 1, page_size: 100 }, signal, state, logger);
    if (!summary)
        return undefined;
    const periods = constituentRows(summary).flatMap(row => Array.isArray(row.periods) ? row.periods.filter(isRecord) : [row]);
    return periods
        .map(row => dateValue(row.date ?? row.trade_date ?? row.period))
        .filter((value) => value !== null && value <= asOf)
        .sort((left, right) => right.localeCompare(left))[0]
        ?.replaceAll('-', '');
}
async function loadIndexSymbols(session, indexCode, asOf, signal, state, logger) {
    for (const tool of INDEX_CONSTITUENT_TOOLS) {
        const isWeightTool = tool === 'ft_v1_index_index_weight';
        let collected = await collectIndexRows(session, tool, indexCode, isWeightTool ? asOf.replaceAll('-', '') : undefined, asOf, signal, state, logger);
        let filtered = currentIndexSymbols(collected.rows, asOf);
        if (isWeightTool && collected.succeeded && !filtered.length) {
            const fallbackDate = await effectiveWeightDate(session, indexCode, asOf, signal, state, logger);
            if (fallbackDate) {
                collected = await collectIndexRows(session, tool, indexCode, fallbackDate, asOf, signal, state, logger);
                filtered = currentIndexSymbols(collected.rows, asOf);
            }
        }
        if (collected.succeeded && filtered.length)
            return filtered;
    }
    state.dataGaps.push(`FTShare 未返回 ${indexCode} 在 ${asOf} 的可用指数成分`);
    return [];
}
async function loadDirectory(session, signal, state, logger) {
    const values = [];
    let pages = 1;
    for (let page = 1; page <= Math.min(30, pages); page += 1) {
        const result = await callOptional(session, 'ft_v1_company_list', {
            page,
            page_size: 200,
        }, signal, state, logger);
        if (!result)
            break;
        values.push(...rows(result));
        const metadata = isRecord(result.metadata) ? result.metadata : {};
        const pagination = isRecord(metadata.pagination) ? metadata.pagination : {};
        if (typeof pagination.pages === 'number' && Number.isFinite(pagination.pages))
            pages = Math.max(pages, Math.trunc(pagination.pages));
        if (pagination.has_more !== true || rows(result).length === 0)
            break;
    }
    return values;
}
function directorySymbol(row) {
    const value = text(row, 'symbol', 'stock_code', 'ts_code', 'code', 'security_code');
    return value ? canonicalSymbol(value) : null;
}
function directoryIndustry(row) {
    const direct = text(row, 'industry', 'industry_name', 'sw_industry_name', 'sector', 'sector_name', 'board_name');
    if (direct)
        return direct;
    const buckets = text(row, 'bk');
    const first = buckets?.split(',').map(value => value.trim()).find(Boolean);
    return first ?? '未知行业';
}
function directoryName(row, fallback) {
    return text(row, 'name', 'stock_name', 'company_name', 'security_name') ?? fallback;
}
function directoryMarketCap(row) {
    return number(row, 'total_market_cap', 'market_cap', 'market_capital', 'total_market_value', 'float_market_cap');
}
function snapshotIndustry(snapshot, directory) {
    const direct = text(snapshot?.quote, 'industry', 'industry_name', 'sw_industry_name', 'sector', 'sector_name');
    if (direct)
        return direct;
    const buckets = text(snapshot?.quote, 'bk');
    const first = buckets?.split(',').map(value => value.trim()).find(Boolean);
    return first ?? directoryIndustry(directory);
}
function snapshotName(snapshot, directory, fallback) {
    return text(snapshot?.quote, 'name', 'stock_name', 'company_name', 'security_name')
        ?? snapshot?.name
        ?? directoryName(directory, fallback);
}
function latestFinancial(snapshot, kind) {
    const values = snapshot?.financial?.[kind] ?? [];
    return values[0] ?? null;
}
function snapshotMetrics(snapshot, directory) {
    const closes = snapshot?.ohlcv.map(point => point.close).filter((value) => value !== null && value > 0) ?? [];
    const volumes = snapshot?.ohlcv.map(point => point.volume).filter((value) => value !== null && value > 0) ?? [];
    const dailyReturns = closes.slice(1).map((close, index) => close / closes[index] - 1).filter(Number.isFinite);
    const return20 = closes.length > 20 ? closes.at(-1) / closes.at(-21) - 1 : null;
    const return60 = closes.length > 60 ? closes.at(-1) / closes.at(-61) - 1 : null;
    const volatility = dailyReturns.length >= 10 ? (stdev(dailyReturns) ?? 0) * Math.sqrt(252) : null;
    let peak = closes[0] ?? 0;
    let maxDrawdown = 0;
    for (const close of closes) {
        peak = Math.max(peak, close);
        if (peak > 0)
            maxDrawdown = Math.min(maxDrawdown, close / peak - 1);
    }
    const income = latestFinancial(snapshot, 'income');
    const cashflow = latestFinancial(snapshot, 'cashflow');
    const valuation = snapshot?.valuation;
    const netProfit = number(income, 'n_profit', 'net_profit', 'net_income');
    const operatingCashflow = number(cashflow, 'net_oper_cash_flow', 'operating_cashflow', 'net_operating_cash_flow');
    return {
        return20,
        return60,
        volatility,
        maxDrawdown: maxDrawdown || null,
        averageVolume: mean(volumes.slice(-20)) ?? number(directory, 'volume', 'vol', 'turnover', 'amount'),
        marketCap: number(valuation, 'total_market_cap', 'market_cap') ?? number(snapshot?.quote, 'total_market_cap', 'market_cap') ?? directoryMarketCap(directory),
        pe: number(valuation, 'pe_ttm', 'pe', 'pe_lar'),
        pb: number(valuation, 'pb_mrq', 'pb'),
        peg: number(valuation, 'peg', 'peg_car'),
        revenueGrowth: number(income, 't_revenue_yoy', 'revenue_yoy', 'operating_revenue_yoy'),
        profitGrowth: number(income, 'n_profit_yoy', 'net_profit_yoy', 'profit_yoy'),
        // Prefer cash conversion (OCF / net profit) when both fields exist; use
        // absolute OCF only as a transparent fallback when profit is unavailable.
        operatingCashflow: operatingCashflow !== null && netProfit !== null && Math.abs(netProfit) > 0
            ? operatingCashflow / Math.abs(netProfit)
            : operatingCashflow,
        momentumScore: 0.5,
        qualityScore: 0.5,
        valuationScore: 0.5,
        liquidityScore: 0.5,
        riskScore: 0.5,
    };
}
function scoreCandidates(candidates) {
    const metrics = candidates.map(candidate => candidate.metrics);
    for (const candidate of candidates) {
        const m = candidate.metrics;
        m.momentumScore = 0.60 * percentile(metrics.map(item => item.return20), m.return20) + 0.40 * percentile(metrics.map(item => item.return60), m.return60);
        m.qualityScore = 0.40 * percentile(metrics.map(item => item.profitGrowth), m.profitGrowth)
            + 0.30 * percentile(metrics.map(item => item.revenueGrowth), m.revenueGrowth)
            + 0.30 * percentile(metrics.map(item => item.operatingCashflow), m.operatingCashflow);
        const valuationSignals = [
            percentile(metrics.map(item => item.pe !== null && item.pe > 0 ? item.pe : null), m.pe !== null && m.pe > 0 ? m.pe : null, false),
            percentile(metrics.map(item => item.pb !== null && item.pb > 0 ? item.pb : null), m.pb !== null && m.pb > 0 ? m.pb : null, false),
            percentile(metrics.map(item => item.peg !== null && item.peg > 0 ? item.peg : null), m.peg !== null && m.peg > 0 ? m.peg : null, false),
        ].filter(value => value !== 0.5);
        m.valuationScore = valuationSignals.length ? valuationSignals.reduce((sum, value) => sum + value, 0) / valuationSignals.length : 0.5;
        m.liquidityScore = percentile(metrics.map(item => item.averageVolume !== null && item.averageVolume > 0 ? Math.log1p(item.averageVolume) : null), m.averageVolume !== null && m.averageVolume > 0 ? Math.log1p(m.averageVolume) : null);
        // Here a larger percentile means more risk, so the risk penalty grows with
        // volatility and drawdown. (Valuation below uses the opposite direction.)
        const volScore = percentile(metrics.map(item => item.volatility), m.volatility, true);
        const drawdownScore = percentile(metrics.map(item => item.maxDrawdown !== null ? Math.abs(item.maxDrawdown) : null), m.maxDrawdown !== null ? Math.abs(m.maxDrawdown) : null, true);
        m.riskScore = 0.60 * volScore + 0.40 * drawdownScore;
        const raw = 0.30 * m.momentumScore + 0.30 * m.qualityScore + 0.20 * m.valuationScore + 0.20 * m.liquidityScore - 0.15 * m.riskScore;
        candidate.score = clamp(raw * (0.70 + 0.30 * candidate.coverage));
        const reasons = [];
        if (m.momentumScore >= 0.67)
            reasons.push('近20/60日动量位于候选池前列');
        if (m.qualityScore >= 0.67)
            reasons.push('利润/收入增长或经营现金流质量较好');
        if (m.valuationScore >= 0.67)
            reasons.push('估值因子相对占优');
        if (m.liquidityScore >= 0.67)
            reasons.push('成交活跃度较高');
        if (m.riskScore <= 0.33)
            reasons.push('历史波动与回撤相对可控');
        if (candidate.coverage < 0.60)
            reasons.push('数据覆盖有限，结论强度下调');
        candidate.reasons = reasons.length ? reasons : ['综合评分处于候选池中位附近'];
    }
}
function returnsFor(candidate) {
    const closes = candidate.snapshot?.ohlcv.map(point => point.close).filter((value) => value !== null && value > 0) ?? [];
    return closes.slice(1).map((close, index) => close / closes[index] - 1).filter(Number.isFinite).slice(-60);
}
function correlation(left, right) {
    const a = returnsFor(left);
    const b = returnsFor(right);
    const length = Math.min(a.length, b.length);
    if (length < 10)
        return left.industry === right.industry ? 0.70 : 0.20;
    const x = a.slice(-length);
    const y = b.slice(-length);
    const ax = mean(x) ?? 0;
    const ay = mean(y) ?? 0;
    const numerator = x.reduce((sum, value, index) => sum + (value - ax) * (y[index] - ay), 0);
    const denominator = Math.sqrt(x.reduce((sum, value) => sum + (value - ax) ** 2, 0) * y.reduce((sum, value) => sum + (value - ay) ** 2, 0));
    return denominator > 0 ? clamp(numerator / denominator, -1, 1) : 0;
}
function chooseDiversified(candidates, size, references) {
    const remaining = [...candidates].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    const selected = [];
    const maxOverlap = Math.max(1, Math.floor(size * 0.4));
    while (selected.length < size && remaining.length) {
        let bestIndex = 0;
        let bestUtility = Number.NEGATIVE_INFINITY;
        const feasibleIndices = remaining
            .map((candidate, index) => ({ candidate, index }))
            .filter(({ candidate }) => references.every(reference => {
            const overlap = selected.filter(item => reference.has(item.symbol)).length;
            return overlap + (reference.has(candidate.symbol) ? 1 : 0) <= maxOverlap;
        }))
            .map(item => item.index);
        // Keep the stock_rec_stream invariant: once a reference portfolio exists,
        // do not fill the remaining slots with securities that would breach the
        // overlap cap. Returning a shorter portfolio is preferable to silently
        // violating the constraint.
        const choices = feasibleIndices;
        if (choices.length === 0)
            break;
        choices.forEach(index => {
            const candidate = remaining[index];
            const sameIndustry = selected.filter(item => item.industry === candidate.industry).length;
            const maxCorrelation = selected.length ? Math.max(...selected.map(item => Math.max(0, correlation(item, candidate)))) : 0;
            const overlap = references.length
                ? Math.max(...references.map(reference => reference.has(candidate.symbol) ? 1 : 0))
                : 0;
            const utility = candidate.score - 0.09 * sameIndustry - 0.08 * maxCorrelation - 0.05 * overlap;
            if (utility > bestUtility) {
                bestUtility = utility;
                bestIndex = index;
            }
        });
        selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected;
}
function chooseTheme(candidates, size, references) {
    const groups = new Map();
    for (const candidate of candidates) {
        const group = groups.get(candidate.industry) ?? [];
        group.push(candidate);
        groups.set(candidate.industry, group);
    }
    const rankedGroups = [...groups.entries()]
        .map(([industry, values]) => ({
        industry,
        values: values.sort((left, right) => right.score - left.score),
        coverage: values.length,
        topScore: values[0]?.score ?? 0,
    }))
        .sort((left, right) => Math.min(right.coverage, size) - Math.min(left.coverage, size) || right.topScore - left.topScore || left.industry.localeCompare(right.industry));
    for (const group of rankedGroups) {
        const selected = chooseDiversified(group.values, Math.min(size, group.values.length), references);
        if (selected.length >= Math.min(3, size))
            return { selected, theme: group.industry };
    }
    const selected = chooseDiversified(candidates, size, references);
    return { selected, theme: selected[0]?.industry ?? '多主题分散' };
}
function projectWeights(selected, strategy, maxSingleWeight, maxIndustryWeight) {
    if (!selected.length)
        return [];
    const uniqueIndustries = new Set(selected.map(item => item.industry)).size;
    const singleCap = Math.max(maxSingleWeight, 1 / selected.length);
    const industryCap = Math.max(maxIndustryWeight, 1 / uniqueIndustries);
    let raw = selected.map(candidate => {
        const volatility = candidate.metrics.volatility;
        if (strategy === 'equal_weight' || strategy === 'theme' || strategy === 'diversified')
            return 1;
        if (strategy === 'minimum_variance')
            return 1 / Math.max((volatility ?? 0.35) ** 2, 0.01);
        return 1 / Math.max(volatility ?? 0.35, 0.05);
    });
    raw = raw.map((value, index) => value * (0.65 + 0.35 * selected[index].score));
    const rawTotal = raw.reduce((sum, item) => sum + item, 0);
    let weights = raw.map(value => value / Math.max(rawTotal, 1.0e-12));
    for (let iteration = 0; iteration < 100; iteration += 1) {
        const byIndustry = new Map();
        selected.forEach((candidate, index) => byIndustry.set(candidate.industry, (byIndustry.get(candidate.industry) ?? 0) + weights[index]));
        selected.forEach((candidate, index) => {
            const industryTotal = byIndustry.get(candidate.industry) ?? 0;
            const groupFactor = industryTotal > industryCap ? industryCap / industryTotal : 1;
            weights[index] = Math.min(weights[index] * groupFactor, singleCap);
        });
        const afterCaps = new Map();
        selected.forEach((candidate, index) => afterCaps.set(candidate.industry, (afterCaps.get(candidate.industry) ?? 0) + weights[index]));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const deficit = 1 - total;
        if (deficit <= 1.0e-10)
            break;
        const capacities = weights.map((weight, index) => {
            const industryTotal = afterCaps.get(selected[index].industry) ?? 0;
            return Math.max(0, Math.min(singleCap - weight, industryCap - industryTotal));
        });
        const capacity = capacities.reduce((sum, value) => sum + value, 0);
        if (capacity <= 1.0e-12)
            break;
        const allocationBase = capacities.map((value, index) => value > 0 ? value * Math.max(raw[index], 1.0e-12) : 0);
        const allocationTotal = allocationBase.reduce((sum, value) => sum + value, 0);
        capacities.forEach((available, index) => {
            if (available > 0)
                weights[index] += deficit * (allocationBase[index] / Math.max(allocationTotal, 1.0e-12));
        });
    }
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0)
        return selected.map(() => 1 / selected.length);
    weights = weights.map(weight => weight / total);
    return weights;
}
function metricsJson(metrics) {
    return {
        return20: metrics.return20,
        return60: metrics.return60,
        annualizedVolatility: metrics.volatility,
        maxDrawdown: metrics.maxDrawdown,
        averageVolume: metrics.averageVolume,
        marketCap: metrics.marketCap,
        peTtm: metrics.pe,
        pbMrq: metrics.pb,
        peg: metrics.peg,
        revenueGrowth: metrics.revenueGrowth,
        profitGrowth: metrics.profitGrowth,
        momentumScore: metrics.momentumScore,
        qualityScore: metrics.qualityScore,
        valuationScore: metrics.valuationScore,
        liquidityScore: metrics.liquidityScore,
        riskScore: metrics.riskScore,
    };
}
function buildRecommendation(id, selected, theme, strategy, references, maxSingleWeight, maxIndustryWeight) {
    const weights = projectWeights(selected, strategy, maxSingleWeight, maxIndustryWeight);
    const roundedWeights = weights.map(weight => Number(weight.toFixed(6)));
    if (roundedWeights.length) {
        const last = roundedWeights.length - 1;
        roundedWeights[last] = Number((roundedWeights[last] + 1 - roundedWeights.reduce((sum, weight) => sum + weight, 0)).toFixed(6));
    }
    const holdings = selected.map((candidate, index) => ({
        symbol: candidate.symbol,
        name: candidate.name,
        industry: candidate.industry,
        weight: roundedWeights[index] ?? 0,
        score: Number(candidate.score.toFixed(6)),
        role: index === 0 ? 'core' : 'satellite',
        reasons: candidate.reasons,
        metrics: metricsJson(candidate.metrics),
        dataGaps: candidate.dataGaps,
    }));
    const industryMap = new Map();
    holdings.forEach(holding => {
        const current = industryMap.get(holding.industry) ?? { weight: 0, count: 0 };
        current.weight += holding.weight;
        current.count += 1;
        industryMap.set(holding.industry, current);
    });
    const overlapWithPrevious = references.length && selected.length
        ? Math.max(...references.map(reference => selected.filter(candidate => reference.has(candidate.symbol)).length))
        : 0;
    const description = theme === '多主题分散'
        ? '多主题分散组合：在综合评分基础上降低行业集中和历史收益相关性。'
        : `${theme}主题组合：优先保留同一行业的核心候选，权重仍受单票与行业上限约束。`;
    return {
        portfolioId: `portfolio_${id}`,
        description,
        strategy,
        holdings,
        industryExposure: [...industryMap.entries()].map(([industry, value]) => ({ industry, weight: Number(value.weight.toFixed(6)), count: value.count })),
        overlapWithPrevious,
    };
}
function normalizeParameters(args) {
    const poolSource = args.poolSource ?? (args.symbols?.length ? 'custom' : 'csi1000');
    if (poolSource !== 'custom' && poolSource !== 'csi1000')
        throw new Error('poolSource 只能是 csi1000 或 custom');
    const portfolioSize = Math.max(2, Math.min(20, Math.trunc(args.portfolioSize ?? DEFAULT_PORTFOLIO_SIZE)));
    const portfolioCount = Math.max(1, Math.min(5, Math.trunc(args.portfolioCount ?? DEFAULT_PORTFOLIO_COUNT)));
    const strategy = args.strategy ?? 'auto';
    if (!['auto', 'theme', 'diversified', 'equal_weight', 'minimum_variance', 'risk_budgeting'].includes(strategy)) {
        throw new Error('strategy 不是受支持的组合方式');
    }
    const indexCode = normalizeIndexCode(args.indexCode ?? CSI1000_CODE);
    const maxSingleWeight = args.maxSingleWeight ?? DEFAULT_MAX_SINGLE_WEIGHT;
    const maxIndustryWeight = args.maxIndustryWeight ?? DEFAULT_MAX_INDUSTRY_WEIGHT;
    const maxCandidates = Math.max(portfolioSize, Math.min(200, Math.trunc(args.maxCandidates ?? DEFAULT_MAX_CANDIDATES)));
    if (!Number.isFinite(maxSingleWeight) || maxSingleWeight <= 0 || maxSingleWeight > 1)
        throw new Error('maxSingleWeight 必须在 (0, 1] 区间');
    if (!Number.isFinite(maxIndustryWeight) || maxIndustryWeight <= 0 || maxIndustryWeight > 1)
        throw new Error('maxIndustryWeight 必须在 (0, 1] 区间');
    return { poolSource, portfolioSize, portfolioCount, strategy, indexCode, maxSingleWeight, maxIndustryWeight, maxCandidates };
}
function sampleSymbols(symbols, limit) {
    if (symbols.length <= limit)
        return symbols;
    const result = [];
    for (let index = 0; index < limit; index += 1) {
        const position = Math.floor(index * symbols.length / limit);
        result.push(symbols[position]);
    }
    return unique(result, bareSymbol);
}
async function loadCandidates(session, args, input, asOf, signal, state, logger) {
    const requestedSymbols = args.poolSource === 'custom'
        ? unique(input.symbols?.map(canonicalSymbol).filter(Boolean) ?? [], bareSymbol)
        : await loadIndexSymbols(session, args.indexCode, asOf, signal, state, logger);
    if (args.poolSource === 'custom' && requestedSymbols.length === 0)
        throw new Error('custom 股票池需要提供非空 symbols');
    const directoryRows = args.poolSource === 'csi1000'
        ? await loadDirectory(session, signal, state, logger)
        : (await Promise.all(requestedSymbols.map(symbol => callOptional(session, 'ft_v1_company_list', {
            stock_code: bareSymbol(symbol),
            page: 1,
            page_size: 1,
        }, signal, state, logger)))).flatMap(result => result ? rows(result) : []);
    const directoryBySymbol = new Map(directoryRows.map(row => [bareSymbol(directorySymbol(row) ?? ''), row]));
    const requested = requestedSymbols.length;
    const requestedSet = new Set(requestedSymbols.map(bareSymbol));
    const directoryPriority = directoryRows
        .map(row => ({ symbol: directorySymbol(row), marketCap: directoryMarketCap(row) ?? 0 }))
        .filter(item => item.symbol !== null && requestedSet.has(bareSymbol(item.symbol)))
        .map(item => ({ symbol: item.symbol, marketCap: item.marketCap }))
        .sort((left, right) => right.marketCap - left.marketCap)
        .map(item => item.symbol);
    const orderedSymbols = unique([...directoryPriority, ...requestedSymbols], bareSymbol);
    const sampled = sampleSymbols(orderedSymbols, args.maxCandidates);
    if (sampled.length < requested)
        state.dataGaps.push(`候选池共 ${requested} 只，本次只加载 ${sampled.length} 只以控制 FTShare 请求量`);
    const snapshots = [];
    const concurrency = 8;
    for (let start = 0; start < sampled.length; start += concurrency) {
        const batch = sampled.slice(start, start + concurrency);
        const values = await Promise.all(batch.map(async (symbol) => {
            try {
                const snapshot = await loadSnapshot(session, symbol, asOf, 120, signal, 30, {
                    includeAnnouncements: false,
                    includeResearch: false,
                }, logger);
                state.permissions.push(...snapshot.permissions);
                state.dataGaps.push(...snapshot.dataGaps);
                state.warnings.push(...snapshot.warnings);
                state.provenance.push(...snapshot.provenance);
                return { symbol, snapshot };
            }
            catch (error) {
                if (isFtSharePermissionError(error)) {
                    addPermission(state, error.permission);
                    logger?.warn('ftshare.permission_denied', {
                        step: 'candidate_snapshot',
                        symbol,
                        code: error.permission.code,
                        requiredPlan: error.permission.requiredPlan,
                        errorType: 'permission_denied',
                    });
                }
                else
                    state.warnings.push(`${symbol}：${error instanceof Error ? error.message : String(error)}`);
                return { symbol, snapshot: null };
            }
        }));
        snapshots.push(...values);
    }
    const candidateRecords = snapshots.map(({ symbol, snapshot }) => {
        const directory = directoryBySymbol.get(bareSymbol(symbol)) ?? null;
        const dataGaps = [...(snapshot?.dataGaps ?? [])];
        const coverage = [
            snapshot?.quote,
            snapshot?.ohlcv.length ? snapshot.ohlcv : null,
            snapshot?.financial,
            snapshot?.valuation,
        ].filter(Boolean).length / 4;
        if (!snapshot)
            dataGaps.push('缺少 FTShare 个股快照');
        return {
            symbol,
            name: snapshotName(snapshot, directory, symbol),
            industry: snapshotIndustry(snapshot, directory),
            snapshot,
            directory,
            dataGaps: unique(dataGaps, value => value),
            warnings: snapshot?.warnings ?? [],
            coverage,
            score: 0,
            metrics: snapshotMetrics(snapshot, directory),
            reasons: [],
        };
        // A directory row alone is not enough to recommend a security: without a
        // real FTShare snapshot there is no historical return/risk evidence. Keep
        // it out of the final ranking and disclose the resulting coverage gap.
    });
    const candidates = candidateRecords.filter(candidate => candidate.snapshot !== null);
    if (candidates.length < candidateRecords.length) {
        state.dataGaps.push(`${candidateRecords.length - candidates.length} 只候选缺少可用于评分的 FTShare 个股快照，已排除`);
    }
    scoreCandidates(candidates);
    return {
        candidates,
        requested,
        sourceDescription: args.poolSource === 'csi1000'
            ? `FTShare 指数成分池 ${args.indexCode}（按 ${asOf} 可见数据）`
            : '用户提供的自定义候选股票池（代码仅作为候选，不直接视为最终持仓）',
    };
}
function losslessJson(value) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'number')
        return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    if (Array.isArray(value))
        return value.map(item => losslessJson(item) ?? null);
    if (value && typeof value === 'object') {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            const normalized = losslessJson(item);
            if (normalized !== undefined)
                output[key] = normalized;
        }
        return output;
    }
    return value;
}
export async function generatePortfolioRecommendation(ctx, input, signal, config, logger) {
    const args = normalizeParameters(input);
    const asOf = validAsOf(input.asOf);
    const state = { permissions: [], dataGaps: [], warnings: [], provenance: [] };
    const settings = ctx.ftshareSettings;
    const resolvedCredential = await settings.apiKey.resolve();
    const client = new FtShareClient(config.ftshareUrl, resolvedCredential, logger);
    const loaded = await client.withSession(signal, session => loadCandidates(session, args, input, asOf, signal, state, logger));
    const sorted = [...loaded.candidates].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    const enoughForTheme = sorted.some(candidate => sorted.filter(item => item.industry === candidate.industry).length >= Math.min(3, args.portfolioSize));
    let strategyUsed = args.strategy;
    if (strategyUsed === 'auto')
        strategyUsed = enoughForTheme ? 'theme' : 'diversified';
    const selectionStrategy = ['theme', 'diversified'].includes(strategyUsed) ? strategyUsed : 'diversified';
    const references = [];
    const recommendations = [];
    for (let index = 0; index < args.portfolioCount; index += 1) {
        const selection = selectionStrategy === 'theme'
            ? chooseTheme(sorted, args.portfolioSize, references)
            : { selected: chooseDiversified(sorted, args.portfolioSize, references), theme: '多主题分散' };
        if (selection.selected.length < Math.min(2, args.portfolioSize))
            break;
        const recommendation = buildRecommendation(index + 1, selection.selected, selection.theme, strategyUsed, references, args.maxSingleWeight, args.maxIndustryWeight);
        recommendations.push(recommendation);
        const symbols = new Set(selection.selected.map(candidate => candidate.symbol));
        references.push(symbols);
    }
    if (!recommendations.length)
        state.dataGaps.push('候选池中没有足够的 FTShare 行情/基础数据形成组合');
    if (recommendations.length < args.portfolioCount)
        state.warnings.push(`目标生成 ${args.portfolioCount} 个组合，实际生成 ${recommendations.length} 个`);
    for (const recommendation of recommendations) {
        if (recommendation.holdings.length < args.portfolioSize) {
            state.warnings.push(`${recommendation.portfolioId} 仅包含 ${recommendation.holdings.length} 只股票：低重合约束下没有足够的独立候选`);
        }
    }
    const selectedIn = new Map();
    recommendations.forEach(recommendation => recommendation.holdings.forEach(holding => {
        const values = selectedIn.get(holding.symbol) ?? [];
        values.push(recommendation.portfolioId);
        selectedIn.set(holding.symbol, values);
    }));
    const candidateDiagnostics = sorted.slice(0, Math.max(args.maxCandidates, args.portfolioSize * 2)).map(candidate => ({
        symbol: candidate.symbol,
        name: candidate.name,
        industry: candidate.industry,
        score: Number(candidate.score.toFixed(6)),
        selectedIn: selectedIn.get(candidate.symbol) ?? [],
        ...(selectedIn.has(candidate.symbol) ? {} : { excludedReason: '未进入组合：综合评分或分散约束不占优' }),
        dataGaps: candidate.dataGaps,
    }));
    const dataGaps = unique(state.dataGaps, value => value);
    const warnings = unique(state.warnings, value => value);
    const permissions = unique(state.permissions, value => `${value.tool}:${value.requiredPlan}`);
    const provenance = unique(state.provenance, value => `${value.tool}:${value.retrievedAt.slice(0, 19)}`);
    const status = permissions.length > 0 && !recommendations.length
        ? 'permission_required'
        : recommendations.length && dataGaps.length === 0
            ? 'complete'
            : 'degraded';
    const result = {
        status,
        asOf,
        poolSource: args.poolSource,
        ...(args.poolSource === 'csi1000' ? { indexCode: args.indexCode } : {}),
        strategyRequested: args.strategy,
        strategyUsed,
        candidatePool: {
            requested: loaded.requested,
            loaded: loaded.candidates.length,
            scored: sorted.length,
            selected: new Set(recommendations.flatMap(item => item.holdings.map(holding => holding.symbol))).size,
            coverage: loaded.requested ? loaded.candidates.length / loaded.requested : 0,
            industries: new Set(loaded.candidates.map(candidate => candidate.industry)).size,
            sourceDescription: loaded.sourceDescription,
        },
        recommendations,
        candidateDiagnostics,
        dataGaps,
        warnings,
        permissions,
        provenance,
        freshness: { asOf, retrievedAt: new Date().toISOString(), provider: 'ftshare' },
    };
    if (input.includeReport && recommendations.length) {
        try {
            const report = await generateInvestmentReport(ctx, {
                reportType: 'portfolio_stocks',
                symbols: recommendations[0].holdings.map(holding => holding.symbol),
                asOf,
            }, signal, config, logger);
            result.report = report;
            if (report.status !== 'complete')
                result.status = 'degraded';
        }
        catch (error) {
            logger?.warn('portfolio.report_failed', {
                fallback: 'partial-report',
                reportType: 'portfolio_stocks',
                errorType: error instanceof Error ? error.name : typeof error,
            });
            result.dataGaps.push('组合已生成，但后续股票组合报告生成失败');
            result.warnings.push(error instanceof Error ? error.message : String(error));
            result.status = 'degraded';
        }
    }
    return losslessJson(result);
}
//# sourceMappingURL=portfolio-recommendation.js.map