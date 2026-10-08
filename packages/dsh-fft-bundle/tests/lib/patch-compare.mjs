/**
 * Structural comparison for parsed patch rows.
 *
 * Two patches that must stay in sync are compared as data rather than as text,
 * so comments and formatting are free to differ while a missing field, a
 * changed literal, or a reworded `!!js` expression is reported with the exact
 * key path that differs.
 */
import { JsExpression } from './patch-yaml.mjs'

/**
 * Stand-in profile URL for evaluating `!!js` scalars. A patch that reaches
 * `ctx.baseUrl` and cannot be evaluated against a real profile URL at all is
 * itself a defect, so evaluating here also proves the expression runs.
 */
export const FAKE_BASE_URL = 'file:///tmp/dsh-profile/cordis.yml'

/**
 * Evaluate a parsed patch value the way the loader does: a `!!js` scalar
 * becomes its value, an array or plain object is rebuilt with each member
 * evaluated, and every other scalar is already its value. Object property
 * order is preserved, because the loader merges row config in that order.
 * @param value - parsed JSON-safe patch data, possibly containing `!!js` scalars.
 * @param context - `ctx` (the profile's `cordis.yml` URL) and `process` bindings.
 * @returns the same shape with every expression evaluated.
 */
export function evaluate(value, context) {
  if (value instanceof JsExpression) {
    // The loader evaluates each `!!js` scalar in a scope holding exactly `ctx`
    // and `process`; a two-parameter constructor reproduces that scope without
    // letting the expression see this module's bindings.
    return new Function('ctx', 'process', `return (${value.source})`)(context.ctx, context.process)
  }
  if (Array.isArray(value)) return value.map(item => evaluate(item, context))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evaluate(item, context)]))
  }
  return value
}

/** The evaluation context for one patch comparison. */
export function context(overrides = {}) {
  return {
    ctx: { baseUrl: FAKE_BASE_URL, ...overrides.ctx },
    process: overrides.process ?? {
      execPath: '/usr/local/bin/node',
      pid: 1,
      platform: process.platform,
      env: { ...process.env, DSH_KLINE_PACKAGE_ROOT: '' },
    },
  }
}

function kindOf(value) {
  if (value instanceof JsExpression) return 'expression'
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function show(value) {
  if (value instanceof JsExpression) return `!!js ${value.source}`
  return JSON.stringify(value) ?? String(value)
}

/**
 * Report every structural difference between two parsed patch values.
 * @param expected - the value that must stay in sync (the upstream row).
 * @param actual - the value under test (the bundle's copied row).
 * @param path - key path of this value, used in the messages.
 * @returns human-readable differences; empty means the two values match.
 */
export function diffRows(expected, actual, path = 'row') {
  const expectedKind = kindOf(expected)
  const actualKind = kindOf(actual)
  if (expectedKind !== actualKind) {
    return [`${path}: kind changed (upstream ${expectedKind}, bundle ${actualKind})`]
  }

  // `!!js` scalars are compared as source text: a copied row that rewords or
  // drops an expression must fail even when the current values agree.
  if (expectedKind === 'expression') {
    return expected.source === actual.source
      ? []
      : [`${path}: expression differs\n    upstream: ${expected.source}\n    bundle:   ${actual.source}`]
  }

  if (expectedKind === 'array') {
    const differences = []
    if (expected.length !== actual.length) {
      differences.push(`${path}: length changed (upstream ${expected.length}, bundle ${actual.length})`)
    }
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      differences.push(...diffRows(expected[index], actual[index], `${path}[${index}]`))
    }
    return differences
  }

  if (expectedKind === 'object') {
    const differences = []
    const expectedKeys = Object.keys(expected)
    const actualKeys = Object.keys(actual)
    for (const key of actualKeys) {
      if (!expectedKeys.includes(key)) differences.push(`${path}.${key}: present in the bundle but not upstream`)
    }
    for (const key of expectedKeys) {
      if (!actualKeys.includes(key)) differences.push(`${path}.${key}: present upstream but missing from the bundle`)
    }
    const shared = expectedKeys.filter(key => actualKeys.includes(key))
    for (const key of shared) {
      differences.push(...diffRows(expected[key], actual[key], `${path}.${key}`))
    }
    return differences
  }

  return Object.is(expected, actual)
    ? []
    : [`${path}: value changed (upstream ${show(expected)}, bundle ${show(actual)})`]
}
