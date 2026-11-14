window.__ModuleLoader__.load({
  id: '@dsh-ft/finance-all-in-one',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const h = React.createElement

    /** Exact route the host half serves; the two are one contract. */
    const ROUTE = '/api/ft-workbench'
    /** Card seat inside the existing FT settings page. */
    const CARD_SLOT = 'ftshare.settings.card'
    const CARD_ID = 'workbench'
    /** After the API Key card (10) and the request log card (20). */
    const CARD_ORDER = 15

    /** The card is single-language: it follows the interface language at render time. */
    const ZH = typeof navigator === 'undefined' || !/^zh/i.test(navigator.language ?? '')
      ? false
      : true
    const pick = (zh, en) => (ZH ? zh : en)

    /**
     * Names for dependencies without locale metadata of their own. Plot has one
     * since 0.1.1 but older installs resolve 0.1.0; the text matches its locale
     * so the two agree either way. Kline lives upstream and publishes none.
     */
    const FALLBACK_TITLES = {
      '@dsh-ft/dsh-fft-plot': pick('FT 绘图', 'FT Plot'),
      '@ftshare-lab/dsh-kline': pick('K 线', 'K-line'),
    }

    /**
     * The interface-language title the package publishes, else a local name, else
     * the package name. The host falls back to the package name when a package
     * declares no locale title, so that value is treated as "no title".
     */
    function titleOf(pkg) {
      const published = pkg.title?.[ZH ? 'zh' : 'en'] ?? pkg.title?.en ?? pkg.title?.zh
      return (published !== undefined && published !== pkg.name ? published : FALLBACK_TITLES[pkg.name]) ?? pkg.name
    }

    const PRESET_TEXT = {
      ready: pick('就绪', 'ready'),
      broken: pick('损坏', 'broken'),
      missing: pick('未注册', 'not registered'),
      unavailable: pick('不可用', 'unavailable'),
    }
    const ROW_TEXT = {
      mounted: pick('已挂载', 'mounted'),
      disabled: pick('已禁用', 'disabled'),
      missing: pick('未挂载', 'not mounted'),
    }
    const PACKAGE_TEXT = {
      aligned: pick('一致', 'aligned'),
      mismatch: pick('不一致', 'mismatch'),
      missing: pick('未安装', 'not installed'),
      unchecked: pick('未校验', 'unchecked'),
    }

    /**
     * One read of the host route. A route failure is shown, never swallowed: a
     * card that silently keeps stale state is worse than one that says it failed.
     */
    async function readStatus() {
      const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body?.ok !== true) throw new Error(body?.error?.message ?? pick('读取失败', 'read failed'))
      return body.status
    }

    /** The preset's state, appended to its row so the lists stay the only surface. */
    function presetSuffix(preset) {
      if (preset === undefined) return ''
      const text = PRESET_TEXT[preset.state] ?? preset.state
      return preset.state === 'ready'
        ? preset.isDefault ? pick(' · 默认', ' · default') : ''
        : ` · ${text}`
    }

    /** Dots use host state colours, so they follow the live palette. */
    function Dot({ tone }) {
      return h('span', { className: `ftw-dot ftw-dot-${tone}`, 'aria-hidden': 'true' })
    }

    /** One titled list column; the card is exactly these two. */
    function Section({ title, children }) {
      return h('section', null, h('h3', null, title), children)
    }

    function ActivityCard({ status, busy, message, onRefresh, onCopy }) {
      const packages = status?.packages ?? []
      const rows = status?.rows ?? []
      const preset = status?.preset
      return h('section', { className: 'ftshare-settings ftw', 'data-ft-workbench-card': '', 'aria-busy': busy },
        h('style', null, CSS),
        h('header', null, h('div', null,
          h('span', { className: 'ftshare-eyebrow' }, 'FINANCE / WORKBENCH'),
          h('h2', null, pick('金融工作台', 'Finance workbench')),
        )),
        h('div', { className: 'ftshare-card' },
          h('div', { className: 'ftw-columns' },
            h(Section, { title: pick('依赖包', 'Dependency packages') },
              h('dl', { className: 'ftw-list' }, packages.map(pkg =>
                h('div', { key: pkg.name, className: 'ftw-row' },
                  h(Dot, { tone: pkg.state === 'aligned' ? 'ok' : pkg.state === 'unchecked' ? 'muted' : 'warn' }),
                  h('dt', null, titleOf(pkg)),
                  h('dd', null,
                    pkg.installed === undefined ? pick('未解析', 'unresolved') : `v${pkg.installed}`,
                    h('span', { className: 'ftw-dim' }, pkg.state === 'aligned' || pkg.state === 'unchecked'
                      ? ` · ${pkg.state === 'unchecked' ? declaredText(pkg) : PACKAGE_TEXT[pkg.state]}`
                      : ` · ${declaredText(pkg)} · ${PACKAGE_TEXT[pkg.state] ?? pkg.state}`),
                  ),
                ),
              )),
            ),
            h(Section, { title: pick('挂载点', 'Mount points') },
              h('dl', { className: 'ftw-list' }, rows.map(row => {
                const presetRow = row.id === 'preset-ft-finance' ? preset : undefined
                const tone = row.state === 'mounted'
                  ? presetRow !== undefined && presetRow.state !== 'ready' ? 'bad' : 'ok'
                  : row.state === 'disabled' ? 'muted' : 'bad'
                return h('div', { key: row.id, className: 'ftw-row' },
                  h(Dot, { tone }),
                  h('dt', null, row.id),
                  h('dd', null, row.state === 'mounted' ? `${ROW_TEXT[row.state]}${presetSuffix(presetRow)}` : ROW_TEXT[row.state]),
                )
              })),
            ),
          ),
          preset?.detail === undefined ? null : h('p', { className: 'ftw-detail' }, preset.detail),
          h('div', { className: 'ftshare-actions' },
            h('button', { type: 'button', className: 'primary', onClick: onRefresh, disabled: busy },
              busy ? pick('读取中…', 'Reading…') : pick('重新读取', 'Read again')),
            h('button', { type: 'button', onClick: onCopy, disabled: status === undefined },
              pick('复制诊断', 'Copy diagnostics')),
            h('small', null, pick(
              '只读检查：不联网、不读取密钥、不改配置。',
              'Read-only: no network, no credential read, no configuration write.',
            )),
          ),
          message === undefined ? null : h('p', { className: 'ftw-message', role: 'status' }, message),
          h('small', null, pick(
            `检查于 ${new Date(status.checkedAt).toLocaleString()}，工作台 v${status.bundle.version ?? '?'}。`,
            `Checked ${new Date(status.checkedAt).toLocaleString()}, workbench v${status.bundle.version ?? '?'}.`,
          )),
        ),
      )
    }

    function WorkbenchCard() {
      const [state, setState] = useState({ phase: 'loading', busy: false })
      const [message, setMessage] = useState(undefined)
      const load = useCallback(async () => {
        setState(previous => ({ ...previous, phase: previous.status === undefined ? 'loading' : 'ready', busy: true }))
        try {
          const status = await readStatus()
          setState({ phase: 'ready', status, busy: false })
          setMessage(undefined)
        } catch (error) {
          setState(previous => ({ ...previous, phase: previous.status === undefined ? 'error' : 'ready', busy: false }))
          setMessage(error instanceof Error ? error.message : String(error))
        }
      }, [])
      useEffect(() => { void load() }, [load])
      const copy = useCallback(async () => {
        if (state.status === undefined) return
        const text = JSON.stringify(state.status, null, 2)
        try {
          await navigator.clipboard.writeText(text)
          setMessage(pick('诊断信息已复制。', 'Diagnostics copied.'))
        } catch {
          setMessage(pick('复制失败：浏览器不允许写入剪贴板。', 'Copy failed: the browser denied clipboard access.'))
        }
      }, [state.status])
      if (state.phase === 'loading') {
        return h('section', { className: 'ftshare-settings ftw', 'data-ft-workbench-card': '', 'aria-busy': 'true' },
          h('style', null, CSS),
          h('header', null, h('div', null,
            h('span', { className: 'ftshare-eyebrow' }, 'FINANCE / WORKBENCH'),
            h('h2', null, pick('金融工作台', 'Finance workbench')),
          )),
          h('p', { role: 'status' }, pick('正在读取安装状态…', 'Reading installation state…')),
        )
      }
      if (state.phase === 'error') {
        return h('section', { className: 'ftshare-settings ftw', 'data-ft-workbench-card': '' },
          h('style', null, CSS),
          h('header', null, h('div', null,
            h('span', { className: 'ftshare-eyebrow' }, 'FINANCE / WORKBENCH'),
            h('h2', null, pick('金融工作台', 'Finance workbench')),
          )),
          h('p', { className: 'ftshare-error', role: 'alert' },
            pick('读取安装状态失败：', 'Could not read installation state: ') + message),
          h('div', { className: 'ftshare-actions' },
            h('button', { type: 'button', onClick: () => void load() }, pick('重试', 'Retry')),
          ),
        )
      }
      return h(ActivityCard, {
        status: state.status,
        busy: state.busy,
        message,
        onRefresh: () => void load(),
        onCopy: () => void copy(),
      })
    }

    const CSS = `
.ftw { --ftw-ok:var(--dsw-alias-state-success-primary,#4ea86b); --ftw-warn:var(--dsw-alias-state-warn-primary,#d9a441); --ftw-bad:var(--dsw-alias-state-error-primary,#ffb5ad); }
.ftw .ftw-dot { flex:none; width:8px; height:8px; margin-top:7px; border-radius:999px; background:var(--ftshare-muted,#aeb2bd); }
.ftw .ftw-dot-ok { background:var(--ftw-ok); }
.ftw .ftw-dot-warn { background:var(--ftw-warn); }
.ftw .ftw-dot-bad { background:var(--ftw-bad); }
.ftw .ftw-dot-muted { background:var(--ftshare-muted,#aeb2bd); }
.ftw .ftw-detail { margin:10px 0 0; font-size:12px; color:var(--ftshare-muted,#aeb2bd); white-space:pre-wrap; }
.ftw .ftw-list { margin:0; }
.ftw .ftw-row { display:grid; grid-template-columns:12px auto minmax(0,1fr); align-items:start; gap:8px; padding:6px 0; border-top:0.5px solid var(--ftshare-border,#44464f); }
.ftw .ftw-row:first-child { border-top:0; }
.ftw .ftw-row .ftw-dot { margin-top:6px; }
.ftw .ftw-row dt { color:var(--ftshare-text,#f4f4f5); white-space:nowrap; }
.ftw .ftw-row dd { margin:0; color:var(--ftshare-muted,#aeb2bd); overflow-wrap:anywhere; }
.ftw .ftw-dim { color:var(--ftshare-muted,#aeb2bd); opacity:.85; }
.ftw .ftw-columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:24px; }
.ftw .ftw-columns > section { min-width:0; }
.ftw .ftw-message { margin:12px 0 0; color:var(--ftshare-muted,#aeb2bd); }
.ftw :is(button,a):focus-visible { outline:2px solid var(--ftshare-accent-on-surface,#b09a4f); outline-offset:3px; }
@media(max-width:760px) { .ftw .ftw-columns { grid-template-columns:minmax(0,1fr); gap:0; } }
@media(max-width:540px) { .ftw .ftw-row { grid-template-columns:12px minmax(0,1fr); } .ftw .ftw-row dd { grid-column:2; } }
`

    /** Browser context this card requires: the slots service plus the page's fetch. */
    function apply(ctx) {
      ctx.slots.inject(CARD_SLOT, () => ctx.slots.register({
        name: CARD_SLOT,
        id: CARD_ID,
        order: CARD_ORDER,
      }, WorkbenchCard))
    }

    const inject = ['slots']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
