export const ANALYSIS_UNAVAILABLE = '本次 AI 分析未生成，请重新生成报告。';
const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && Boolean(value.trim()) && !['...', '…', ANALYSIS_UNAVAILABLE].includes(value.trim());
/** Only contract fields belong to the model; all other values remain factual. */
export function projectAnalysis(value, shape) {
    if (Array.isArray(shape)) {
        if (!Array.isArray(value))
            return undefined;
        if (!shape.length)
            return value.filter(text);
        const items = value.map(item => projectAnalysis(item, shape[0]));
        return items.some(item => item === undefined) ? undefined : items;
    }
    if (record(shape)) {
        if (!record(value))
            return undefined;
        const entries = Object.entries(shape).map(([key, child]) => [key, projectAnalysis(value[key], child)]).filter(([, child]) => child !== undefined);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    if (typeof shape === 'number')
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    return text(value) ? value : undefined;
}
/** Retain layout and factual siblings, but never use canned commentary as AI. */
export function clearAnalysis(context, shape) {
    const result = structuredClone(context);
    for (const [key, child] of Object.entries(shape)) {
        if (record(child))
            result[key] = clearAnalysis(record(result[key]) ? result[key] : {}, child);
        else if (Array.isArray(child))
            result[key] = child.length && record(child[0]) ? [clearAnalysis({}, child[0])] : [];
        else
            result[key] = typeof child === 'number' ? null : ['tone', 'class_name'].includes(key) ? 'neutral' : ['title', 'label', 'headline'].includes(key) ? 'AI 分析未生成' : ['url', 'stock_code', 'source_name', 'published_at'].includes(key) ? '' : ['level', 'verdict', 'confidence', 'rating'].includes(key) ? '未评估' : ANALYSIS_UNAVAILABLE;
    }
    return result;
}
export function mergeAnalysis(context, patch) {
    const result = { ...context };
    for (const [key, value] of Object.entries(patch)) {
        if (record(value))
            result[key] = mergeAnalysis(record(result[key]) ? result[key] : {}, value);
        else
            result[key] = value;
    }
    return result;
}
export function missingAnalysis(value, shape, prefix = '') {
    if (Array.isArray(shape)) {
        if (!Array.isArray(value))
            return [prefix];
        return shape.length ? value.flatMap((item, i) => missingAnalysis(item, shape[0], `${prefix}[${i}]`)) : [];
    }
    if (record(shape))
        return Object.entries(shape).flatMap(([key, child]) => missingAnalysis(record(value) ? value[key] : undefined, child, prefix ? `${prefix}.${key}` : key));
    return typeof shape === 'number' ? typeof value === 'number' ? [] : [prefix] : text(value) ? [] : [prefix];
}
export function analysisMetadata(value, shape) {
    const fields = {};
    const walk = (node, contract, path) => {
        if (record(contract))
            for (const [key, child] of Object.entries(contract))
                walk(record(node) ? node[key] : undefined, child, path ? `${path}.${key}` : key);
        else
            fields[path] = missingAnalysis(node, contract, path).length ? 'unavailable' : 'generated';
    };
    walk(value, shape, '');
    const count = Object.values(fields).filter(status => status === 'generated').length;
    return { status: count === 0 ? 'unavailable' : count === Object.keys(fields).length ? 'generated' : 'partial', generated: count, total: Object.keys(fields).length, fields };
}
export function remainingAnalysisContract(value, shape) {
    const pending = {};
    for (const [key, child] of Object.entries(shape)) {
        const current = record(value) ? value[key] : undefined;
        if (!missingAnalysis(current, child).length)
            continue;
        pending[key] = record(child) ? remainingAnalysisContract(current, child) : child;
    }
    return pending;
}
//# sourceMappingURL=analysis-contract.js.map