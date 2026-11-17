/**
 * Browser half of the FT gallery: the right-sidebar "画廊" tab.
 *
 * It renders `gallery/catalog.json` (served by the Host half on
 * `/api/ft-gallery/catalog`) as a shelf of third-party web apps, and opens one
 * through the Host's own right-sidebar browser tab. The package deliberately
 * owns no iframe carrier: the Host's browser tab already carries a sandboxed
 * page, an address bar, a reload and an "open in system browser" escape, and a
 * Web profile that ships no browser tab falls back to a plain window.
 *
 * The module is already in the loader factory format, so the build copies it
 * instead of bundling it.
 */
window.__ModuleLoader__.load({
  id: '@dsh-ft/dsh-fft-gallery',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    /** Exact route the host half serves; the two are one contract. */
    const ROUTE = '/api/ft-gallery/catalog'
    /** Tab implementation identity: also the key the body registers under. */
    const TAB_ID = '@dsh-ft/dsh-fft-gallery/tab'
    /** Kind `openTab` names. */
    const KIND = 'ft-gallery'

    /** The shelf follows the interface language at render time. */
    const ZH = typeof navigator === 'undefined' || !/^zh/i.test(navigator.language ?? '') ? false : true
    const pick = (zh, en) => (ZH ? zh : en)

    const TEXT = {
      title: pick('画廊', 'Gallery'),
      guide: pick('第三方网页应用', 'Third-party web apps'),
      count: (shown, total) => (ZH ? `${shown} / ${total} 个条目` : `${shown} / ${total} entries`),
      search: pick('搜索', 'Search'),
      all: pick('全部', 'All'),
      open: pick('打开', 'Open'),
      retry: pick('重试', 'Retry'),
      refresh: pick('刷新', 'Refresh'),
      loading: pick('正在读取目录…', 'Reading the catalog…'),
      empty: pick('暂无条目', 'Nothing here yet'),
      failed: (message) => (ZH ? `目录读取失败：${message}` : `Catalog unavailable: ${message}`),
      openedExternal: pick('已在系统浏览器打开', 'Opened in your browser'),
      noBrowser: pick('此处没有侧栏浏览器，已在系统浏览器打开', 'No sidebar browser here; opened in your browser'),
      verified: pick('官方', 'Verified'),
      community: pick('社区', 'Community'),
      web: pick('网页', 'Web'),
      footer: pick('条目随版本发布；第三方页面的内容由其作者负责。', 'Entries ship with this release; page content belongs to its author.'),
    }

    const CSS = `
.ftg{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#17181c);font-size:13px}
.ftg *{box-sizing:border-box}
.ftg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px 10px}
.ftg-head h2{margin:0;font-size:15px;font-weight:600}
.ftg-count{color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11.5px;margin-left:8px;font-weight:400}
.ftg-tools{display:flex;gap:8px;align-items:center;padding:0 16px 10px}
.ftg-search{flex:1;min-width:0;height:30px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,#fbfbfc);color:var(--dsw-alias-label-primary,#17181c);padding:0 10px;font-size:12.5px;outline:none}
.ftg-search::placeholder{color:var(--dsw-alias-label-tertiary,#9aa0a6)}
.ftg-icon{width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#6b7075);font-size:12px;cursor:pointer}
.ftg-icon:hover{background:var(--dsw-alias-bg-layer-2,#f1f2f4)}
.ftg-pills{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px}
.ftg-pill{font-size:11.5px;padding:4px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));background:transparent;color:var(--dsw-alias-label-secondary,#6b7075);cursor:pointer;line-height:1.2}
.ftg-pill[data-on]{background:var(--dsw-alias-button-primary-fill,#17181c);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.ftg-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:0 16px 12px}
.ftg-card{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:var(--dsw-radius-md,12px);padding:10px 12px;background:var(--dsw-alias-bg-base,#fff)}
.ftg-glyph{width:30px;height:30px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,#f1f2f4);display:flex;align-items:center;justify-content:center;font-size:12.5px;color:var(--dsw-alias-label-secondary,#6b7075);flex:none}
.ftg-body{flex:1;min-width:0}
.ftg-name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;line-height:1.3}
.ftg-desc{margin-top:3px;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ftg-badge{font-size:10px;line-height:1.4;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#f1f2f4);color:var(--dsw-alias-label-secondary,#6b7075);font-weight:400;white-space:nowrap}
.ftg-badge[data-trust="verified"]{background:rgba(176,154,79,.16);color:#8a7638}
.ftg-open{flex:none;font-size:11.5px;height:26px;padding:0 11px;border-radius:var(--dsw-radius-sm,8px);border:1px solid transparent;background:var(--dsw-alias-button-primary-fill,#17181c);color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer}
.ftg-open:hover{opacity:.88}
.ftg-state{margin:24px 16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:12.5px;line-height:1.6;text-align:center}
.ftg-state button{margin-top:10px}
.ftg-foot{padding:8px 16px 12px;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:10.5px;line-height:1.5;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05))}
.ftg-note{margin:12px 16px 0;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,#f1f2f4);color:var(--dsw-alias-label-secondary,#6b7075);font-size:11.5px;line-height:1.5}
`

    /** One `<style>` for the shelf; the host has no shared CSS channel. */
    function ensureStyle() {
      if (typeof document === 'undefined' || document.getElementById('ftg-style') !== null) return
      const style = document.createElement('style')
      style.id = 'ftg-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** One read of the host route. A failure is shown, never swallowed. */
    async function readCatalog() {
      const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body?.ok !== true) throw new Error(body?.error?.message ?? pick('读取失败', 'read failed'))
      return body.catalog
    }

    /** The localized side of a `{ zh, en }` field, falling back to whatever exists. */
    function localized(value) {
      if (typeof value === 'string') return value
      if (value === undefined || value === null) return ''
      return value[ZH ? 'zh' : 'en'] ?? value.zh ?? value.en ?? ''
    }

    /** Glyph used when an entry declares no icon: the title's first character. */
    function glyphOf(entry) {
      const title = localized(entry.title)
      return title.slice(0, 1) || '·'
    }

    /**
     * Open one entry.
     *
     * The Host browser tab is the carrier: one `openTab` call, the same path a
     * chat link takes. A profile without that tab type (Web ships none) falls
     * back to a plain window, and an open that throws is retried the same way.
     * @returns {'sidebar' | 'external'} where the page went.
     */
    function openEntry(right, entry) {
      const url = entry.url
      try {
        if (right !== undefined && typeof right.openTab === 'function') {
          right.openTab('browser', { params: { url } })
          return 'sidebar'
        }
      } catch {
        // Falls through to the plain window.
      }
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
      return 'external'
    }

    /** One card: glyph, name with its trust badge, one-line description, action. */
    function Card({ entry, onOpen }) {
      return h('div', { className: 'ftg-card', 'data-entry': entry.id },
        h('div', { className: 'ftg-glyph', 'aria-hidden': 'true' }, glyphOf(entry)),
        h('div', { className: 'ftg-body' },
          h('div', { className: 'ftg-name' },
            localized(entry.title),
            h('span', { className: 'ftg-badge', 'data-trust': entry.trust }, entry.trust === 'verified' ? TEXT.verified : TEXT.community),
            h('span', { className: 'ftg-badge' }, TEXT.web),
          ),
          h('div', { className: 'ftg-desc' }, localized(entry.description)),
        ),
        h('button', { type: 'button', className: 'ftg-open', onClick: () => onOpen(entry) }, TEXT.open),
      )
    }

    /** The shelf: catalog fetch, one category filter, one text filter, the list. */
    function Gallery({ right }) {
      const [state, setState] = useState({ status: 'loading' })
      const [category, setCategory] = useState(null)
      const [query, setQuery] = useState('')
      const [notice, setNotice] = useState('')

      const load = useCallback(async () => {
        setState({ status: 'loading' })
        try {
          const catalog = await readCatalog()
          setState({ status: 'ready', catalog })
        } catch (error) {
          setState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const onOpen = useCallback((entry) => {
        const where = openEntry(right, entry)
        setNotice(where === 'external' ? TEXT.noBrowser : '')
      }, [right])

      const catalog = state.status === 'ready' ? state.catalog : undefined
      const webEntries = useMemo(
        () => (catalog?.entries ?? []).filter(entry => entry?.kind === 'web' && typeof entry.url === 'string'),
        [catalog],
      )
      const categories = useMemo(() => {
        const declared = catalog?.categories ?? {}
        const ids = [...new Set(webEntries.map(entry => entry.category).filter(Boolean))]
        return ids.map(id => ({ id, title: localized(declared[id]) || id }))
      }, [catalog, webEntries])
      const shown = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return webEntries.filter(entry => {
          if (category !== null && entry.category !== category) return false
          if (needle === '') return true
          return [localized(entry.title), localized(entry.description), entry.id]
            .some(value => value.toLowerCase().includes(needle))
        })
      }, [webEntries, category, query])

      const header = h('div', { className: 'ftg-head' },
        h('div', null,
          h('h2', null, TEXT.title,
            h('span', { className: 'ftg-count' }, state.status === 'ready' ? TEXT.count(shown.length, webEntries.length) : ''),
          ),
        ),
        h('button', {
          type: 'button',
          className: 'ftg-icon',
          title: TEXT.refresh,
          'aria-label': TEXT.refresh,
          onClick: () => void load(),
        }, '↻'),
      )

      if (state.status === 'loading') {
        return h('div', { className: 'ftg' }, header, h('div', { className: 'ftg-state' }, TEXT.loading))
      }
      if (state.status === 'failed') {
        return h('div', { className: 'ftg' }, header,
          h('div', { className: 'ftg-state' },
            TEXT.failed(state.message),
            h('div', null, h('button', { type: 'button', className: 'ftg-icon', onClick: () => void load() }, TEXT.retry)),
          ),
        )
      }

      return h('div', { className: 'ftg' },
        header,
        h('div', { className: 'ftg-tools' },
          h('input', {
            className: 'ftg-search',
            type: 'search',
            placeholder: TEXT.search,
            value: query,
            onChange: event => setQuery(event.target.value),
          }),
        ),
        categories.length > 1
          ? h('div', { className: 'ftg-pills' },
            h('button', {
              type: 'button',
              className: 'ftg-pill',
              'data-on': category === null ? '' : undefined,
              onClick: () => setCategory(null),
            }, TEXT.all),
            categories.map(item => h('button', {
              key: item.id,
              type: 'button',
              className: 'ftg-pill',
              'data-on': category === item.id ? '' : undefined,
              onClick: () => setCategory(current => (current === item.id ? null : item.id)),
            }, item.title)),
          )
          : null,
        shown.length === 0
          ? h('div', { className: 'ftg-state' }, TEXT.empty)
          : h('div', { className: 'ftg-list' },
            shown.map(entry => h(Card, { key: entry.id, entry, onOpen })),
          ),
        notice === '' ? null : h('div', { className: 'ftg-note' }, notice),
        h('div', { className: 'ftg-foot' }, TEXT.footer),
      )
    }

    /** Register the tab type and its body; both live as long as the plugin. */
    function apply(ctx) {
      ensureStyle()
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        title: () => TEXT.title,
        guide: [{ id: 'gallery', order: 60, title: () => TEXT.title, description: () => TEXT.guide }],
      }), 'dsh-fft-gallery: tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: TAB_ID },
        () => h(Gallery, { right: ctx.sidebarRight }),
      )), 'dsh-fft-gallery: tab body')
    }

    exports.apply = apply
    exports.inject = ['slots', 'sidebarRightTabs', 'sidebarRight']
    return module.exports
  },
})
