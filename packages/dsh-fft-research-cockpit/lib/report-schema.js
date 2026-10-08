function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function recordArray(value) {
    return Array.isArray(value) && value.every(isRecord);
}
export function validateDeepReadReport(value) {
    if (!isRecord(value))
        return { ok: false, errors: ['根节点必须是 JSON 对象'] };
    const errors = [];
    for (const field of ['title', 'investment_thesis', 'business_overview', 'fundamental_analysis', 'technical_analysis', 'industry_position', 'valuation', 't0_assessment', 'validation_framework', 'conclusion']) {
        const fieldValue = value[field];
        if (['title', 'investment_thesis'].includes(field)) {
            if (!nonEmptyString(fieldValue))
                errors.push(`${field} 必须是非空字符串`);
        }
        else if (!isRecord(fieldValue)) {
            errors.push(`${field} 必须是对象`);
        }
    }
    for (const field of ['catalysts', 'risks', 'key_observation_points']) {
        if (!recordArray(value[field]))
            errors.push(`${field} 必须是对象数组`);
    }
    if (recordArray(value.catalysts) && value.catalysts.length < 3)
        errors.push('catalysts 至少需要 3 条');
    if (recordArray(value.risks) && value.risks.length < 5)
        errors.push('risks 至少需要 5 条');
    if (recordArray(value.key_observation_points) && value.key_observation_points.length < 4)
        errors.push('key_observation_points 至少需要 4 条');
    const requireStrings = (parent, fields, prefix) => {
        if (!parent)
            return;
        for (const field of fields)
            if (!nonEmptyString(parent[field]))
                errors.push(`${prefix}.${field} 必须是非空字符串`);
    };
    const business = isRecord(value.business_overview) ? value.business_overview : undefined;
    requireStrings(business, ['main_business', 'revenue_structure'], 'business_overview');
    if (business && (!recordArray(business.moat) || business.moat.length < 2))
        errors.push('business_overview.moat 至少需要 2 条');
    const fundamental = isRecord(value.fundamental_analysis) ? value.fundamental_analysis : undefined;
    for (const field of ['financial_health', 'growth', 'profitability']) {
        const section = fundamental && isRecord(fundamental[field]) ? fundamental[field] : undefined;
        if (!section || !recordArray(section.items) || section.items.length < 3)
            errors.push(`fundamental_analysis.${field}.items 至少需要 3 条`);
        requireStrings(section, ['summary'], `fundamental_analysis.${field}`);
    }
    const technical = isRecord(value.technical_analysis) ? value.technical_analysis : undefined;
    requireStrings(technical, ['trend', 'pattern', 'key_levels', 'volume_price', 'conclusion'], 'technical_analysis');
    const industry = isRecord(value.industry_position) ? value.industry_position : undefined;
    requireStrings(industry, ['industry_overview', 'market_share'], 'industry_position');
    if (industry && (!recordArray(industry.competitors) || industry.competitors.length < 2))
        errors.push('industry_position.competitors 至少需要 2 条');
    const valuation = isRecord(value.valuation) ? value.valuation : undefined;
    requireStrings(valuation, ['current_valuation', 'historical_percentile', 'peer_comparison', 'conclusion'], 'valuation');
    const t0 = isRecord(value.t0_assessment) ? value.t0_assessment : undefined;
    requireStrings(t0, ['level', 'suitability', 'backtest_summary'], 't0_assessment');
    const validation = isRecord(value.validation_framework) ? value.validation_framework : undefined;
    requireStrings(validation, ['description'], 'validation_framework');
    if (validation && (!recordArray(validation.items) || validation.items.length < 3))
        errors.push('validation_framework.items 至少需要 3 条');
    const conclusion = isRecord(value.conclusion) ? value.conclusion : undefined;
    requireStrings(conclusion, ['rating', 'rationale', 'suitable_investors'], 'conclusion');
    return errors.length ? { ok: false, errors } : { ok: true, report: value };
}
//# sourceMappingURL=report-schema.js.map