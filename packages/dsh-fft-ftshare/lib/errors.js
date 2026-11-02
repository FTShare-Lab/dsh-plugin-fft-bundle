/**
 * 上游失败的观测与四态归一的**薄**层。
 *
 * 只做四件事：抄事实、判 HTTP 语义、留现场、算指纹。**不解释上游**：不维护错误码表，
 * 不按中文文案猜「配额/权限/凭据」，不编造 remedy。上游改名、改文案、加码，这里一行
 * 都不用改。
 *
 * 判定只剩两条 HTTP 语义（稳定、不会随上游文案变）：
 *
 * - `401` / `403` → `denied`（面板遮罩要用）；
 * - 其余 → `failed`。
 *
 * `empty` 不在这里判定：它由成功载荷的**正向证据**决定（见 `./index.ts` 的
 * `observePayload`）。「成功信封里带权限标记」是载荷事实，由
 * {@link permissionNoticeFromPayload} 识别，同样不是文案猜测。
 * @module @dsh-ft/dsh-fft-ftshare/errors
 */
import { FTSHARE_UPGRADE_URL } from './contract.js';
/** 原始报文的上限；线上真实报文 p99 约 220 B，2 KB 只为兜住 HTML 错误页。 */
const RAW_MAX = 2048;
/** 展示文案（notice.message）的上限：原文很短，超长只可能是 HTML 错误页。 */
const NOTICE_TEXT_MAX = 1000;
/** 指纹前归一文案的长度上限，避免超长 HTML 撑爆聚合键。 */
const FINGERPRINT_TEXT_MAX = 512;
/** 传输层错误名：Node/DOM 的超时与取消。 */
const ABORT_NAMES = new Set(['AbortError', 'TimeoutError']);
/** Node 网络错误码：原样出现在 `Error.code` 上。 */
const NETWORK_CODES = new Set([
    'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);
/** 判断一个值是不是可当对象读的记录。 */
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 读一个非空字符串；其余一律 undefined。 */
export function asText(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/** 读一个非空字符串或数字码（上游的 `upstream_code` 是数字）；其余一律 undefined。 */
function asCode(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : asText(value);
}
/** 读一个 100—599 的 HTTP 状态；其余一律 undefined。 */
function asStatus(value) {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d{3}$/u.test(value.trim()) ? Number(value) : undefined;
    return numeric !== undefined && numeric >= 100 && numeric <= 599 ? numeric : undefined;
}
/** 不依赖 `node:crypto` 的稳定指纹：FNV-1a 64 位，十六进制 16 位。 */
export function hashText(text) {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= BigInt(text.charCodeAt(index));
        hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
}
/**
 * 失败指纹：同工具、同状态、同码、同归一文案的失败聚合用。
 *
 * 文案里的数字会归一成 `#`，否则「请等待 N 小时」会让每次失败都算新指纹。
 * @param status - HTTP 状态。
 * @param code - 上游码。
 * @param message - 可读文案。
 * @returns 16 位十六进制指纹。
 */
export function fingerprintOf(status, code, message) {
    const normalized = message.replace(/\d+/gu, '#').replace(/\s+/gu, ' ').trim().slice(0, FINGERPRINT_TEXT_MAX);
    return hashText(`${status ?? ''}|${code ?? ''}|${normalized}`);
}
/** 把报文压成单行，避免日志/面板出现换行。 */
function singleLine(text) {
    return text.replace(/\s+/gu, ' ').trim();
}
/** 剥掉 SDK 包装前缀，只留下网关/服务端自己的说明。 */
function stripSdkPrefix(text) {
    return text
        .replace(/^Streamable HTTP error:\s*/iu, '')
        .replace(/^Error POSTing to endpoint:\s*/iu, '')
        .replace(/^MCP error\s+-\d+:\s*/iu, '')
        .trim();
}
/** 从 error 对象自身读 HTTP 状态（`StreamableHTTPError.code` / `status`）。 */
function statusOfThrown(value) {
    if (!isRecord(value) && !(value instanceof Error))
        return undefined;
    const candidate = value;
    return asStatus(candidate.status) ?? asStatus(candidate.statusCode) ?? asStatus(candidate.code);
}
/** 该抛出物是不是网络/超时类失败。 */
function isTransportFailure(value) {
    if (!(value instanceof Error))
        return false;
    if (ABORT_NAMES.has(value.name))
        return true;
    const code = value.code;
    if (typeof code === 'string' && NETWORK_CODES.has(code))
        return true;
    return /fetch failed|network|socket hang up|timed? ?out|aborted/iu.test(value.message);
}
/**
 * 从文本里读有分界的 HTTP 状态。
 *
 * 只认三种写法：`HTTP 403`、`status: 429` / `code=400`、以及开头就是 `401/403/429`。
 * **不认裸 `5\d\d`**：实测「最多访问 500 次」会被误读成 HTTP 500。
 */
function statusOfText(text) {
    const bounded = /(?:HTTP|http|status|code|错误码)\s*[:：=]?\s*([45]\d{2})\b/u.exec(text);
    if (bounded?.[1] !== undefined)
        return Number(bounded[1]);
    const leading = /^\s*(401|403|429)\b/u.exec(text);
    return leading?.[1] === undefined ? undefined : Number(leading[1]);
}
/** 尝试把报文解析成上游错误信封。 */
function envelopeOf(raw) {
    const candidates = [raw.trim()];
    const brace = raw.indexOf('{');
    if (brace > 0)
        candidates.push(raw.slice(brace));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (!isRecord(parsed))
                continue;
            return isRecord(parsed.error) ? parsed.error : parsed;
        }
        catch {
            // 不是 JSON：按纯文本处理。
        }
    }
    return undefined;
}
/**
 * 把一次抛出物归一成 {@link UpstreamFailure}（只记事实）。
 * @param value - 抛出物或上游返回的文本。
 * @returns 观测事实。
 */
export function observeFailure(value) {
    const thrownStatus = statusOfThrown(value);
    const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value);
    const envelope = envelopeOf(raw);
    if (envelope !== undefined) {
        const message = asText(envelope.message) ?? asText(envelope.error) ?? asText(envelope.detail) ?? singleLine(stripSdkPrefix(raw));
        const code = asCode(envelope.code) ?? asCode(envelope.error_code);
        const status = asStatus(envelope.upstream_code) ?? asStatus(envelope.upstreamCode) ?? asStatus(envelope.status) ?? thrownStatus;
        const retryable = typeof envelope.retryable === 'boolean' ? envelope.retryable : undefined;
        const requiredPlan = asText(envelope.required_plan) ?? asText(envelope.requiredPlan) ?? asText(envelope.plan);
        return {
            surface: 'envelope',
            message: message.slice(0, RAW_MAX),
            ...code !== undefined ? { code } : {},
            ...status !== undefined ? { status } : {},
            ...retryable !== undefined ? { retryable } : {},
            ...requiredPlan !== undefined ? { requiredPlan } : {},
            raw,
            fingerprint: fingerprintOf(status, code, message),
        };
    }
    const transport = isTransportFailure(value);
    const cleaned = singleLine(stripSdkPrefix(raw)) || '上游未返回可读说明';
    const status = thrownStatus ?? statusOfText(cleaned);
    return {
        surface: thrownStatus !== undefined ? 'http' : transport ? 'transport' : 'text',
        message: cleaned.slice(0, RAW_MAX),
        ...status !== undefined ? { status } : {},
        raw,
        fingerprint: fingerprintOf(status, undefined, cleaned),
    };
}
/** retryable 的事实推导：HTTP 语义与传输层事实，不含「配额该不该重试」这类判断。 */
function factRetryable(status, transport) {
    if (status !== undefined)
        return status === 408 || status === 425 || status === 429 || status >= 500;
    return transport;
}
/** 组装 notice 里的上游现场。 */
function upstreamOf(failure) {
    return {
        raw: failure.raw.slice(0, RAW_MAX),
        ...failure.status !== undefined ? { status: failure.status } : {},
        fingerprint: failure.fingerprint,
    };
}
/**
 * 把一次失败折成结局与提示。
 *
 * 顺序即语义：`401/403` 是上游拒绝 → `denied`；其余一律 `failed`。不再按文案细分
 * 配额/凭据/档位——原文已经带出这些信息。
 * @param error - 抛出物。
 * @param tool - 上游工具名（只用于调用方日志，不写进提示）。
 * @returns 结局与可直接展示的提示。
 */
export function classifyFailure(error, tool) {
    const failure = observeFailure(error);
    const code = failure.code ?? (failure.status !== undefined ? String(failure.status) : undefined);
    const base = {
        ...code !== undefined ? { code } : {},
        message: `上游原文：${failure.message.slice(0, NOTICE_TEXT_MAX)}`,
        retryable: false,
        upstream: upstreamOf(failure),
    };
    if (failure.status === 401 || failure.status === 403) {
        return {
            state: 'denied',
            // 401 是凭据问题、403 是订阅/权限问题：只有 403 挂升级入口，401 交给原文说明。
            notice: {
                ...base,
                ...failure.status === 403 ? { upgradeUrl: FTSHARE_UPGRADE_URL } : {},
                ...failure.requiredPlan !== undefined ? { requiredPlan: failure.requiredPlan } : {},
            },
            failure,
        };
    }
    return {
        state: 'failed',
        notice: {
            ...base,
            retryable: failure.retryable ?? factRetryable(failure.status, failure.surface === 'transport'),
        },
        failure,
    };
}
/**
 * 从「调用成功但信封说自己无权」的载荷里读出权限提示。
 *
 * 部分网关把订阅门禁放在成功信封的 `metadata.permissions` 或 `permission` 里，而不是
 * 返回错误；只看空数组就会把这种情况读成「没有数据」。这里只认**显式标记**（
 * `access_denied` 之类布尔标记）或 `401/403` 状态码，不按文案猜。
 * @param tool - 上游工具名（只用于调用方日志，不写进提示）。
 * @param value - 上游返回的结构化载荷。
 * @returns 权限提示；没有标记时 undefined。
 */
export function permissionNoticeFromPayload(tool, value) {
    if (!isRecord(value))
        return undefined;
    const records = [value];
    const metadata = value.metadata;
    if (isRecord(metadata)) {
        records.push(metadata);
        if (Array.isArray(metadata.permissions))
            records.push(...metadata.permissions.filter(isRecord));
        if (isRecord(metadata.permission))
            records.push(metadata.permission);
    }
    if (isRecord(value.permission))
        records.push(value.permission);
    if (Array.isArray(value.permissions))
        records.push(...value.permissions.filter(isRecord));
    for (const record of records) {
        const marker = [record.access_denied, record.accessDenied, record.permission_denied, record.permissionDenied,
            record.subscription_required, record.subscriptionRequired, record.upgrade_required, record.upgradeRequired]
            .some(flag => flag === true);
        const code = asCode(record.code) ?? asCode(record.error_code);
        const status = asStatus(record.status) ?? asStatus(record.upstream_code) ?? asStatus(code);
        const denied = marker || status === 401 || status === 403;
        if (!denied)
            continue;
        const message = asText(record.message) ?? asText(record.reason) ?? asText(record.detail) ?? '';
        const raw = JSON.stringify(value);
        return {
            ...code !== undefined ? { code } : status !== undefined ? { code: String(status) } : {},
            message: `上游在成功响应里标注了权限限制：${message === '' ? '（未给说明）' : message}`,
            ...asText(record.required_plan) !== undefined ? { requiredPlan: asText(record.required_plan) } : {},
            ...status !== 401 ? { upgradeUrl: FTSHARE_UPGRADE_URL } : {},
            retryable: false,
            upstream: { raw: raw.slice(0, RAW_MAX), ...status !== undefined ? { status } : {}, fingerprint: fingerprintOf(status, code, message) },
        };
    }
    return undefined;
}
//# sourceMappingURL=errors.js.map