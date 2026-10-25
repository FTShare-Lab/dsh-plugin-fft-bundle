/**
 * 叶子取数函数与 FTShare 数据底座之间唯一的接缝。
 *
 * 投研舱不再自己连网关：所有取数都经 `ctx.ftshareData.call(interface, args, { signal })`
 * （见 `docs/specs/ftshare-base/design.html` §8.1）。叶子函数（`ftshare-data` /
 * `report-data` / `portfolio-recommendation` 里的取数函数）保持纯函数，只吃一个
 * {@link FtshareCaller}，**绝不接触 cordis ctx**，因此测试可以用假实现完整替换网关。
 *
 * 结局只看 {@link FtshareCallResult.state}：`empty` 才是「上游确实没有数据」，
 * `denied` 带升级入口，`failed` 是取数失败。`rows` 不是权限判据——旧实现把这三者都
 * 读成「空数组」，正是底座要治的病。
 * @module
 */
import { FTSHARE_UPGRADE_URL, } from '@dsh-ft/dsh-fft-ftshare/contract';
/** 同一份主体可以被切断的最大尝试次数：首次 + 2 次重试。 */
const MAX_ATTEMPTS = 3;
/** 订阅档位的中文名；档位只来自上游信封，本包不按接口版本号猜。 */
export const FTSHARE_PLAN_LABELS = {
    Free: '免费版',
    Basic: '基础版',
    Advanced: '进阶版',
    Pro: '专业版（Pro）',
};
/** 权限提示的去重键；`requiredPlan` 可能缺省（上游没说档位）。 */
export function permissionKey(notice) {
    return `${notice.tool}:${notice.requiredPlan ?? ''}`;
}
/** 把底座的 notice 归一成报告遮罩认得的权限提示。 */
export function permissionFromNotice(tool, notice) {
    return {
        tool,
        code: notice.code,
        requiredPlan: notice.requiredPlan,
        message: notice.message,
        upgradeUrl: notice.upgradeUrl ?? FTSHARE_UPGRADE_URL,
    };
}
/**
 * 把底座的四态结果折成叶子层的读法。
 * @param tool - 上游接口名。
 * @param result - 底座的归一结果。
 * @returns 叶子层结局；`gap` / `warning` 文案在这一处生成。
 */
export function outcomeOf(tool, result) {
    const rows = result.rows;
    const metadata = { source: 'ftshare', tool, fetchedAt: result.source.fetchedAt };
    if (result.state === 'available' && rows.length > 0) {
        return { state: 'available', value: { data: rows, metadata }, rows, retryable: false };
    }
    if (result.state === 'denied') {
        const notice = result.notice;
        const message = notice?.message ?? `FTShare 无权访问 ${tool}`;
        return {
            state: 'denied',
            value: null,
            rows: [],
            permission: notice ? permissionFromNotice(tool, notice) : undefined,
            gap: message,
            warning: message,
            retryable: false,
        };
    }
    if (result.state === 'failed') {
        const notice = result.notice;
        return {
            state: 'failed',
            value: null,
            rows: [],
            gap: `FTShare 工具调用失败：${tool}`,
            warning: notice?.message ?? `FTShare ${tool} 调用失败`,
            retryable: notice?.retryable === true,
        };
    }
    // empty：调用走通了，上游确实没有数据。这不是权限问题，也不该被说成「取数失败」。
    const message = `FTShare 数据为空：${tool}`;
    return { state: 'empty', value: null, rows: [], gap: message, warning: message, retryable: false };
}
/** 重试前的退避等待。 */
async function backoff(millis) {
    await new Promise(resolve => setTimeout(resolve, millis));
}
/**
 * 调一次底座接口，并把「值得重试的失败」重试到 {@link MAX_ATTEMPTS} 次。
 *
 * 底座的 `call()` 契约上不抛异常，但这里仍兜一层：一个坏掉的客户端实现不该让整份
 * 报告崩掉，它只会变成一条 `failed`。
 * @param caller - 底座服务（或测试假实现）。
 * @param tool - 上游接口名。
 * @param args - 上游入参，原样透传。
 * @param signal - 取消信号，转给底座。
 * @param logger - 具名 logger；权限与失败各记一条，便于线上定位。
 * @returns 叶子层结局。
 */
export async function callInterface(caller, tool, args = {}, signal, logger) {
    let outcome;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) {
            outcome = { state: 'failed', value: null, rows: [], gap: `FTShare 工具调用失败：${tool}`, warning: `${tool} 已取消`, retryable: false };
            break;
        }
        try {
            const options = signal ? { signal } : undefined;
            outcome = outcomeOf(tool, await caller.call(tool, args, options));
        }
        catch (error) {
            outcome = {
                state: 'failed',
                value: null,
                rows: [],
                gap: `FTShare 工具调用失败：${tool}`,
                warning: error instanceof Error ? error.message : String(error),
                retryable: false,
            };
        }
        if (!outcome.retryable || attempt + 1 >= MAX_ATTEMPTS)
            break;
        await backoff(250 * (attempt + 1));
    }
    const settled = outcome;
    if (settled.state === 'denied') {
        logger?.warn('ftshare.permission_denied', {
            tool,
            code: settled.permission?.code,
            requiredPlan: settled.permission?.requiredPlan,
            errorType: 'permission_denied',
        });
    }
    else if (settled.state === 'failed') {
        logger?.warn('ftshare.call_failed', { tool, message: settled.warning, errorType: 'call_failed' });
    }
    return settled;
}
/**
 * 把一次取数结局记进四本账。
 * @param ledger - 权限/遮罩/缺口/警告四本账。
 * @param outcome - {@link callInterface} 的结局。
 * @returns `available` 时的行信封，其余为 null。
 */
export function recordOutcome(ledger, outcome) {
    if (outcome.permission) {
        ledger.permissions.push(outcome.permission);
        ledger.blockedPermissions?.push(outcome.permission);
    }
    if (outcome.gap)
        ledger.dataGaps.push(outcome.gap);
    if (outcome.warning)
        ledger.warnings.push(outcome.warning);
    return outcome.state === 'available' ? outcome.value : null;
}
//# sourceMappingURL=ftshare-call.js.map