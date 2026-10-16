/**
 * 叶子取数函数的测试替身。
 *
 * 投研舱的取数叶子只依赖一个 `call(interface, args, { signal })`（见
 * `src/ftshare-call.ts` 的 `FtshareCaller`），所以一个假服务就能完整替换 FTShare
 * 网关。这里按底座的**四态**造结果，测试据此断言「denied 与 empty 不可混同」，
 * 而不是像旧用例那样自己拼 MCP envelope。
 */

/** 四态结果里的来源字段，固定时点便于断言。 */
const SOURCE = { name: 'FTShare', fetchedAt: '2026-09-03T00:00:00.000Z' }

/** 升级入口，与底座契约里的默认值一致。 */
export const UPGRADE_URL = 'https://ftai.chat/me/profile?tab=subscription'

/** 调用成功且有明细行。 */
export function available(rows) {
  return { ok: true, state: 'available', rows, source: SOURCE }
}

/** 调用成功但上游确实没有数据（不是权限问题）。 */
export function empty() {
  return { ok: true, state: 'empty', rows: [], source: SOURCE }
}

/** 套餐未开通或凭据无效：带升级入口，且**不是**「没有数据」。 */
export function denied(message, options = {}) {
  return {
    ok: false,
    state: 'denied',
    rows: [],
    source: SOURCE,
    notice: {
      code: options.code ?? 'route_not_allowed',
      message,
      ...(options.requiredPlan !== undefined ? { requiredPlan: options.requiredPlan } : {}),
      upgradeUrl: options.upgradeUrl ?? UPGRADE_URL,
      retryable: false,
    },
  }
}

/** 取数失败：连接、超时、参数或上游 5xx。 */
export function failed(message, options = {}) {
  return {
    ok: false,
    state: 'failed',
    rows: [],
    source: SOURCE,
    notice: { code: options.code ?? 'upstream_error', message, retryable: options.retryable === true },
  }
}

/**
 * 建一个假 `ftshareData`。
 * @param handler - `(tool, args, options) => FtshareCallResult`；返回 undefined 视为 empty。
 * @returns `{ call, calls }`，`calls` 记录每次调用的接口名与入参。
 */
export function fakeFtshare(handler) {
  const calls = []
  return {
    calls,
    async call(tool, args = {}, options = {}) {
      calls.push({ tool, args, signal: options?.signal })
      return (await handler(tool, args, options)) ?? empty()
    },
  }
}
