/**
 * Browser half of the FT gallery: the right-sidebar "金融组件库" tab.
 *
 * Three surfaces share one tab:
 *   - 发现 (Discover): a CSS-columns waterfall of the catalog entries the Host
 *     half serves on `/api/ft-gallery/catalog`;
 *   - 我的收藏 (Saved): one timeline of the components the user saved plus the
 *     personal launchers they added — URLs and local HTML pages — all kept on
 *     the Host (`/api/ft-gallery/state`);
 *   - 详情 (detail): screenshots, summary/details, links and the open action,
 *     rendered in place of the list with a back control.
 *
 * Hard rules this module keeps (see docs/specs/gallery/design.md §2, §5–§10):
 * it is already in the loader factory format the build copies verbatim, so it
 * requires nothing but `react`; every string is rendered as plain text (no HTML
 * injection); images are HTTPS-only with `referrerpolicy="no-referrer"` and a
 * gradient + first-glyph fallback; external links carry `rel="noopener noreferrer"`;
 * the gallery never installs a plugin — it only shows a copyable command.
 *
 * The shelf is favorites-only: nothing appears there that the user did not
 * save, so the list needs no runtime registry to keep it honest.
 */
window.__ModuleLoader__.load({
  id: '@dsh-ft/dsh-fft-gallery',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    // ---------------------------------------------------------------- contract

    /** Host route that serves the merged catalog. The two halves are one contract. */
    const CATALOG_ROUTE = '/api/ft-gallery/catalog'
    /** Host route that reads and writes saved entries. */
    const STATE_ROUTE = '/api/ft-gallery/state'
    /** Tab implementation identity: the key the type's body registers under. */
    const TAB_ID = '@dsh-ft/dsh-fft-gallery/tab'
    /** Kind `openTab` names for this tab type. */
    const KIND = 'ft-gallery'
    /** Entry id rule shared with the author-side schema. */
    const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/

    /** The interface language the shelf renders in, decided once at load. */
    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language ?? '')
    const pick = (zh, en) => (ZH ? zh : en)

    const TEXT = {
      title: pick('金融组件库', 'Finance gallery'),
      guide: pick('网页应用与插件组件，收藏后可随时打开', 'Web apps and plugin components; save one to open later'),
      discover: pick('发现', 'Discover'),
      shelf: pick('收藏', 'Saved'),
      refresh: pick('刷新目录', 'Refresh catalog'),
      refreshFailed: pick('刷新失败，仍显示上次的目录', 'Refresh failed; showing the previous catalog'),
      loading: pick('正在读取目录…', 'Loading the catalog…'),
      loadFailed: (message) => pick(`目录读取失败：${message}`, `Catalog unavailable: ${message}`),
      badCatalog: pick('目录格式无法识别', 'Unrecognized catalog format'),
      badResponse: pick('服务返回无法识别', 'Unrecognized response'),
      retry: pick('重试', 'Retry'),
      emptyCatalog: pick('目录暂时没有条目', 'The catalog has no entries yet'),
      emptyFiltered: pick('该分类下没有条目', 'Nothing in this category'),
      componentShelf: pick('组件收藏', 'Saved components'),
      personalShelf: pick('个人收藏', 'Personal collection'),
      emptyComponents: pick('还没有收藏组件。', 'No saved components yet.'),
      goDiscover: pick('去发现', 'Discover'),
      emptyPersonal: pick('还没有添加网址或本地页面。点右上角「添加」。', 'No URLs or local pages yet. Use Add.'),
      add: pick('添加', 'Add'),
      addLink: pick('添加网址', 'Add a URL'),
      addPage: pick('添加本地页面', 'Add a local page'),
      linkHint: pick('在侧栏浏览器打开', 'Opens in the sidebar browser'),
      pageHint: pick('用文档预览在侧栏打开', 'Opens in the sidebar document preview'),
      titleField: pick('标题', 'Title'),
      urlField: pick('网址', 'URL'),
      pathField: pick('文件路径', 'File path'),
      titleHint: (fallback) => pick(`留空用「${fallback}」`, `Blank uses "${fallback}"`),
      saveForm: pick('保存', 'Save'),
      updatedRow: pick('已保存', 'Saved'),
      cancel: pick('取消', 'Cancel'),
      edit: pick('编辑', 'Edit'),
      remove: pick('删除', 'Delete'),
      confirmRemove: pick('确认删除', 'Confirm delete'),
      addFailed: (message) => pick(`保存失败：${message}`, `Could not save: ${message}`),
      removed: pick('已删除', 'Removed'),
      linkAdded: pick('网址已添加', 'URL added'),
      pageAdded: pick('本地页面已添加', 'Local page added'),
      previewUnavailable: pick('无法打开文档预览：宿主未启用该能力', 'Document preview is unavailable in this host'),
      noSession: pick('打开一个会话后才能预览本地页面', 'Open a conversation to preview local pages'),
      urlRequired: pick('需要填写 http/https 网址', 'An http(s) URL is required'),
      pathRequired: pick('需要填写绝对路径且以 .html 结尾', 'An absolute path ending in .html is needed'),
      all: pick('全部', 'All'),
      stale: pick('目录可能过期', 'The catalog may be out of date'),
      cached: pick('来自缓存', 'Served from cache'),
      updated: (time) => pick(`更新于 ${time}`, `Updated ${time}`),
      web: pick('网页', 'Web'),
      plugin: pick('插件', 'Plugin'),
      installed: pick('已安装', 'Installed'),
      installedVersion: (version) => pick(`已安装（版本 ${version}）`, `Installed (version ${version})`),
      notInstalled: pick('未安装', 'Not installed'),
      noSurface: pick('无独立界面', 'No standalone view'),
      open: pick('打开', 'Open'),
      back: pick('返回', 'Back'),
      save: pick('收藏', 'Save'),
      unsave: pick('取消收藏', 'Remove from saved'),
      saveFailed: (message) => pick(`收藏操作失败：${message}`, `Could not update saved state: ${message}`),
      savedStateFailed: (message) => pick(`收藏状态读取失败：${message}`, `Saved state unavailable: ${message}`),
      loadingSaved: pick('正在读取收藏…', 'Loading saved entries…'),
      noBrowser: pick('此环境没有侧栏浏览器，已在系统浏览器打开', 'No sidebar browser here; opened in your system browser'),
      tabMissing: (kind) => pick(`宿主没有注册「${kind}」页面，可能需要重启或等待热应用`, `The host has no "${kind}" view registered; restart or wait for hot-apply`),
      panelMissing: (panel) => pick(`宿主没有注册「${panel}」面板，可能需要重启或等待热应用`, `The host has no "${panel}" panel registered; restart or wait for hot-apply`),
      openFailed: pick('打开失败', 'Could not open the entry'),
      summary: pick('简介', 'Summary'),
      details: pick('详情', 'Details'),
      screenshots: pick('截图', 'Screenshots'),
      links: pick('链接', 'Links'),
      homepage: pick('首页', 'Homepage'),
      repo: pick('仓库', 'Repository'),
      author: pick('作者', 'Author'),
      starsNote: pick('热度（GitHub ★），非评分', 'Popularity (GitHub stars), not a rating'),
      stars: (count) => `★ ${count}`,
      installTitle: pick('安装命令', 'Install command'),
      installHint: pick('这里不安装插件。安装后需重启或等待热应用。', 'Nothing is installed from here. Restart or wait for hot-apply after installing.'),
      unknownInstall: pick('暂时无法确认安装状态；可在命令行查看。', 'Installation state is unknown right now; check it in the terminal.'),
      copy: pick('复制', 'Copy'),
      copied: pick('已复制', 'Copied'),
      copyFailed: pick('复制失败，请手动选择命令', 'Copy failed; select the command manually'),
      engines: (range) => pick(`运行环境 DSH ${range}`, `Requires DSH ${range}`),
      entryCount: (count) => pick(`${count} 个条目`, `${count} entries`),
    }

    // ------------------------------------------------------------------ styles

    const CSS = `
.ftg{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;line-height:1.4}
.ftg *{box-sizing:border-box}
.ftg button{font-family:inherit}
.ftg-head{position:relative;display:flex;align-items:center;gap:8px;padding:10px 14px 6px}
.ftg-head .ftg-grow{flex:1}
.ftg-seg{display:flex;align-items:center;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);min-width:0}
.ftg-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.2;padding:4px 10px;border-radius:calc(var(--dsw-radius-md) - 2px);cursor:pointer;white-space:nowrap}
.ftg-seg button[data-on]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:600}
.ftg-n{color:var(--dsw-alias-label-tertiary);font-weight:400;margin-left:4px;font-variant-numeric:tabular-nums}
.ftg-icon{margin-left:auto;width:26px;height:26px;flex:none;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer}
.ftg-icon:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ftg-icon[disabled]{opacity:.5;cursor:default}
.ftg-sub{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;padding:0 14px 4px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}
.ftg-stale{color:var(--dsw-alias-state-warn-primary)}
.ftg-pills{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 6px}
.ftg-pill{font-size:11px;line-height:1.2;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.ftg-pill[data-on]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.ftg-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.ftg-grid{column-count:2;column-gap:10px;padding:4px 14px 16px}
.ftg-grid[data-cols="3"]{column-count:3}
.ftg-grid[data-cols="4"]{column-count:4}
.ftg-card{break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);overflow:hidden;cursor:pointer;outline:none}
.ftg-card:hover{border-color:var(--dsw-alias-border-l3)}
.ftg-card:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.ftg-cover{position:relative;width:100%;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;overflow:hidden;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-3),var(--dsw-alias-bg-layer-2))}
.ftg-cover-lg{aspect-ratio:16/9}
.ftg-cover img{width:100%;height:100%;object-fit:cover;display:block}
.ftg-glyph{font-size:22px;font-weight:600;line-height:1;color:var(--dsw-alias-label-tertiary);user-select:none}
.ftg-card-body{padding:8px 10px 9px}
.ftg-card-title{font-size:12.5px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ftg-card-summary{margin-top:3px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ftg-card-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);min-height:16px}
.ftg-tag{font-size:9.5px;line-height:1.5;padding:0 5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ftg-tag[data-state="yes"]{color:var(--dsw-alias-state-success-primary)}
.ftg-tag[data-state="no"]{color:var(--dsw-alias-label-tertiary)}
.ftg-author{max-width:9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ftg-stars{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.ftg-media{position:relative}
.ftg-fav{position:absolute;top:6px;right:6px;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.38);color:#fff;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}
.ftg-fav:hover{background:rgba(0,0,0,.55)}
.ftg-fav[data-on]{color:#ffd479;background:rgba(0,0,0,.55)}
.ftg-fav[disabled]{opacity:.5;cursor:default}
.ftg-state{margin:28px 18px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.65;text-align:center}
.ftg-state-title{margin-bottom:4px;color:var(--dsw-alias-label-secondary);font-size:12.5px;font-weight:600}
.ftg-state-action{margin-top:10px}
.ftg-btn{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:1.2;padding:5px 12px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.ftg-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ftg-btn[data-primary]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.ftg-btn[disabled]{opacity:.5;cursor:default}
.ftg-toast{margin:8px 14px 12px;padding:7px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.45;word-break:break-word}
.ftg-toast[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}
.ftg-detail{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.ftg-bar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l1)}
.ftg-bar .ftg-icon{margin-left:0}
.ftg-bar .ftg-icon[data-on]{color:var(--dsw-alias-state-warn-primary)}
.ftg-bar-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ftg-detail-body{padding-bottom:18px}
.ftg-detail-cover{margin:12px 14px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}
.ftg-detail-title{margin:10px 14px 0;font-size:14.5px;font-weight:600;line-height:1.35;word-break:break-word}
.ftg-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:7px 14px 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ftg-detail-meta .ftg-stars{margin-left:0}
.ftg-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 14px 0}
.ftg-sect{padding:14px 14px 0}
.ftg-sect-h{margin:0 0 4px;font-size:10.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}
.ftg-text{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.ftg-shots{display:flex;gap:8px;overflow-x:auto;padding:2px 0 4px;scroll-snap-type:x proximity}
.ftg-shot{flex:0 0 78%;max-width:280px;scroll-snap-align:start;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);overflow:hidden;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-3),var(--dsw-alias-bg-layer-2))}
.ftg-shot img{width:100%;height:100%;object-fit:cover;display:block}
.ftg-links{display:flex;flex-wrap:wrap;gap:6px 14px;padding-top:8px;font-size:11.5px;line-height:1.5}
.ftg-link{color:var(--dsw-alias-link);text-decoration:none}
.ftg-link:hover{text-decoration:underline}
.ftg-note{margin:10px 14px 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);word-break:break-word}
.ftg-install{margin:12px 14px 0;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1)}
.ftg-install-head{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.ftg-install-head .ftg-btn{margin-left:auto;padding:2px 8px;font-size:10.5px}
.ftg-cmd{display:block;margin-top:6px;padding:6px 8px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;word-break:break-all;white-space:pre-wrap;user-select:all}
.ftg-install-hint{margin-top:6px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.ftg-sec-head{display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px 14px 4px;border-top:1px solid var(--dsw-alias-border-l1)}
.ftg-sec-head[data-first]{margin-top:2px;padding-top:2px;border-top:0}
.ftg-sec-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ftg-sec-count{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.ftg-sec-note{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:4px 14px 8px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.ftg-add{position:relative}
.ftg-add-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:20;min-width:190px;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);box-shadow:0 8px 24px rgba(0,0,0,.14)}
.ftg-add-menu button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;text-align:left;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:12px}
.ftg-add-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ftg-add-menu small{color:var(--dsw-alias-label-tertiary);font-size:10px}
.ftg-form{margin:0 14px 10px;padding:9px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.ftg-form-error{margin:0 0 6px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.45}
.ftg-field{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.ftg-field label{width:52px;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ftg-field input{flex:1;min-width:0;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px}
.ftg-form-actions{display:flex;justify-content:flex-end;gap:6px}
.ftg-list{display:flex;flex-direction:column;gap:2px;padding:2px 8px 16px}
.ftg-row{display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:var(--dsw-radius-md);cursor:pointer}
.ftg-row:hover{background:var(--dsw-alias-bg-layer-2)}
.ftg-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.ftg-row-ico{width:40px;height:40px;flex:none;border-radius:var(--dsw-radius-md);overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600}
.ftg-row-ico img{width:100%;height:100%;object-fit:cover;display:block}
.ftg-row-ico[data-kind="link"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-link);font-size:15px}
.ftg-row-ico[data-kind="page"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:9px}
.ftg-row-main{flex:1;min-width:0}
.ftg-row-title{font-size:12.5px;font-weight:600;line-height:1.3;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;word-break:break-word}
.ftg-row-sub{margin-top:2px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ftg-row-when{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary);padding-top:2px;font-variant-numeric:tabular-nums}
.ftg-row-more{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:15px;line-height:1;padding:2px 6px;border-radius:var(--dsw-radius-xs)}
.ftg-row-more:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ftg-row-menu{display:flex;gap:4px;padding:0 8px 8px 58px}
.ftg-row-menu .ftg-btn{padding:2px 8px;font-size:10.5px}
.ftg-mini-tag{font-size:9.5px;line-height:1.5;padding:0 5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ftg-mini-tag[data-saved]{background:transparent;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2)}
`

    /**
     * One `<style>` for the shelf; the host has no shared CSS channel.
     * @param force - replace an existing sheet (the loader's HMR bookkeeping
     * claims the one created during factory evaluation, so only that call
     * replaces it).
     */
    function ensureStyle(force) {
      if (typeof document === 'undefined' || document.head === null) return
      if (force !== true && document.getElementById('ftg-style') !== null) return
      for (const existing of document.querySelectorAll('#ftg-style')) existing.remove()
      const style = document.createElement('style')
      style.id = 'ftg-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // Create the sheet while the module factory is evaluated: the browser
    // module loader then owns the `<style>` and can drop it on a reload.
    ensureStyle(true)

    // ---------------------------------------------------------------- helpers

    /** Localized text of a `{ zh, en }` field, falling back to whatever exists. */
    function localized(value) {
      if (typeof value === 'string') return value
      if (value === null || typeof value !== 'object') return ''
      const preferred = ZH ? value.zh : value.en
      if (typeof preferred === 'string' && preferred.trim() !== '') return preferred
      for (const key of ['en', 'zh']) {
        if (typeof value[key] === 'string' && value[key].trim() !== '') return value[key]
      }
      return ''
    }

    /** HTTPS-only URL, trimmed; anything else is treated as absent. */
    function httpsUrl(value) {
      if (typeof value !== 'string') return ''
      const trimmed = value.trim()
      return /^https:\/\//i.test(trimmed) ? trimmed : ''
    }

    /** The card's fallback glyph: the title's first character. */
    function firstGlyph(title) {
      const text = localized(title)
      return text === '' ? '·' : text.slice(0, 1)
    }

    /** Entry title with a last-resort identity so a card is never blank. */
    function entryTitle(entry) {
      return localized(entry.title) || entry.id
    }

    /** Entry summary; the format-1 `description` field is tolerated as a fallback. */
    function entrySummary(entry) {
      const summary = localized(entry.summary)
      return summary === '' ? localized(entry.description) : summary
    }

    /** `YYYY-MM-DD HH:mm` without depending on Intl data. */
    function formatTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const time = new Date(value)
      if (Number.isNaN(time.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
    }

    /** A short "when" label for one saved row. */
    function formatWhen(at) {
      const time = typeof at === 'string' ? Date.parse(at) : Number.NaN
      if (!Number.isFinite(time)) return ''
      const now = Date.now()
      const diff = Math.max(0, now - time)
      const minute = 60 * 1000
      const hour = 60 * minute
      if (diff < minute) return pick('刚刚', 'Just now')
      if (diff < hour) return pick(`${Math.floor(diff / minute)} 分钟前`, `${Math.floor(diff / minute)} min ago`)
      const date = new Date(time)
      const pad = (number) => String(number).padStart(2, '0')
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
      if (date.toDateString() === new Date(now).toDateString()) return pick(`今天 ${clock}`, `Today ${clock}`)
      if (date.toDateString() === new Date(now - 24 * hour).toDateString()) return pick(`昨天 ${clock}`, `Yesterday ${clock}`)
      return pick(`${date.getMonth() + 1}月${date.getDate()}日`, `${date.getMonth() + 1}/${date.getDate()}`)
    }

    /** The host's file-resource address for one local page, mirroring its grammar. */
    function fileAddress(sessionId, path) {
      const encode = (segment) => encodeURIComponent(segment).replace(/%3A/giu, ':')
      const encoded = path.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '').split('/').map(encode).join('/')
      return `dsh-resource://file/session/${encode(sessionId)}/${encoded}`
    }

    /** One human-readable message out of anything thrown. */
    function messageOf(error) {
      if (error instanceof Error && error.message !== '') return error.message
      if (typeof error === 'string' && error !== '') return error
      return TEXT.badResponse
    }

    /**
     * Whether a served catalog may be out of date or came from the disk cache.
     * Accepts both the documented top-level flags and the shipped route's
     * `meta` block, so the client does not depend on one spelling.
     * @param catalog - the catalog document.
     * @returns `{ stale, cached }`.
     */
    function freshnessOf(catalog) {
      const meta = catalog !== null && typeof catalog === 'object'
        && catalog.meta !== null && typeof catalog.meta === 'object' ? catalog.meta : {}
      return {
        stale: catalog?.stale === true || meta.stale === true
          || (meta.remote === 'unavailable' && meta.notPublished !== true),
        cached: catalog?.fromCache === true || meta.remote === 'cached',
      }
    }

    /** Whether a catalog entry has the minimum a card can render. */
    function isEntry(value) {
      return value !== null && typeof value === 'object'
        && typeof value.id === 'string' && value.id !== ''
        && (value.kind === 'web' || value.kind === 'plugin')
    }

    /** Install command for a plugin entry, shown but never executed by the gallery. */
    function installCommand(entry) {
      const spec = entry.spec
      if (spec === null || typeof spec !== 'object') return ''
      if (spec.type === 'npm' && typeof spec.name === 'string' && spec.name !== '') return `dsh plugin add ${spec.name}`
      if (spec.type === 'git' && typeof spec.url === 'string' && typeof spec.commit === 'string') {
        return `dsh plugin add ${httpsUrl(spec.url)}#${spec.commit}`
      }
      return ''
    }

    /** The `open.kind` an entry declares, or the empty string. */
    function openKindOf(entry) {
      return entry.open !== null && typeof entry.open === 'object' && typeof entry.open.kind === 'string' ? entry.open.kind : ''
    }

    /** The main panel id a plugin entry opens, else ''. */
    function openPanelOf(entry) {
      return entry.open !== null && typeof entry.open === 'object' && typeof entry.open.panel === 'string' ? entry.open.panel : ''
    }

    /** Saved-state map shape guard; a null prototype keeps hostile ids inert. */
    /** The parsed shelf: favorites by id, plus the personal launchers the host stores. */
    function readShelfState(state) {
      const source = state !== null && typeof state === 'object'
        && state.favorites !== null && typeof state.favorites === 'object' ? state.favorites : {}
      const map = Object.create(null)
      for (const [id, value] of Object.entries(source)) {
        if (!ID_PATTERN.test(id)) continue
        map[id] = { at: value !== null && typeof value === 'object' && typeof value.at === 'string' ? value.at : '' }
      }
      const atOf = (value) => (value !== null && typeof value === 'object' && typeof value.at === 'string' ? value.at : '')
      const links = (state !== null && typeof state === 'object' && Array.isArray(state.links) ? state.links : [])
        .flatMap((row) => {
          if (row === null || typeof row !== 'object') return []
          if (typeof row.id !== 'string' || !/^link_[a-z0-9]{8,}$/u.test(row.id)) return []
          if (typeof row.url !== 'string' || !/^https?:\/\//iu.test(row.url)) return []
          const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title.trim() : hostOf(row.url)
          return [{ key: `link:${row.id}`, id: row.id, title, url: row.url, at: atOf(row) }]
        })
      const pages = (state !== null && typeof state === 'object' && Array.isArray(state.pages) ? state.pages : [])
        .flatMap((row) => {
          if (row === null || typeof row !== 'object') return []
          if (typeof row.id !== 'string' || !/^page_[a-z0-9]{8,}$/u.test(row.id)) return []
          if (typeof row.path !== 'string' || !row.path.startsWith('/')) return []
          const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title.trim() : baseName(row.path)
          return [{ key: `page:${row.id}`, id: row.id, title, path: row.path, at: atOf(row) }]
        })
      return { map, links, pages }
    }

    /** A link's hostname, or the URL itself when it does not parse. */
    function hostOf(url) {
      try {
        return new URL(url).hostname
      } catch {
        return url
      }
    }

    /** The last path segment, for a page title that was left blank. */
    function baseName(path) {
      const parts = path.replace(/\\/gu, '/').split('/')
      return parts[parts.length - 1] || path
    }

    /** One read of a host route; `{ ok: false }` and non-2xx are both failures. */
    async function readJson(route, init) {
      const response = await fetch(route, init)
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (!response.ok) {
        const message = body !== null && typeof body === 'object' && typeof body.error?.message === 'string' ? body.error.message : ''
        throw new Error(message === '' ? `HTTP ${response.status}` : message)
      }
      if (body === undefined) throw new Error(TEXT.badResponse)
      if (body === null || typeof body !== 'object' || body.ok !== true) {
        const error = body !== null && typeof body === 'object' ? body.error : undefined
        const message = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : ''
        throw new Error(message === '' ? TEXT.badResponse : message)
      }
      return body
    }

    /** Whether a saved id is currently saved. */
    function isSaved(map, id) {
      return Object.prototype.hasOwnProperty.call(map, id)
    }

    /** A saved entry's timestamp for ordering; unparsable ones sort last. */
    // -------------------------------------------------------------- transport

    /**
     * Resolve how one plugin entry's installation stands.
     *
     * A live tab type for the entry's `open.kind` is itself proof: a bundle
     * dependency is not always listed as a profile bundle, but a plugin that
     * registered its tab is loaded.
     */
    function installedState(entry, bundles, hasTabKind, hasMainPanel) {
      if (entry.kind !== 'plugin') return { status: 'web' }
      const spec = entry.spec
      const named = spec !== null && typeof spec === 'object' && spec.type === 'npm' && typeof spec.name === 'string'
      const row = named && bundles.status === 'ready' ? bundles.byName.get(spec.name) : undefined
      const kind = openKindOf(entry)
      if (kind !== '' && typeof hasTabKind === 'function' && hasTabKind(kind)) {
        return { status: 'installed', version: row !== undefined && typeof row.version === 'string' ? row.version : '' }
      }
      const panel = openPanelOf(entry)
      if (panel !== '' && typeof hasMainPanel === 'function' && hasMainPanel(panel)) {
        return { status: 'installed', version: row !== undefined && typeof row.version === 'string' ? row.version : '' }
      }
      if (!named || bundles.status !== 'ready') return { status: 'unknown' }
      if (row === undefined || row.installed !== true) return { status: 'missing' }
      return { status: 'installed', version: typeof row.version === 'string' ? row.version : '' }
    }

    /** Open a web entry in the host browser tab, else in the system browser. */
    function openWeb(host, url, pushToast) {
      const target = httpsUrl(url)
      if (target === '') {
        pushToast('error', TEXT.openFailed)
        return
      }
      const tabs = host.tabs
      if (tabs !== undefined && typeof tabs.get === 'function' && tabs.get('browser') !== undefined) {
        try {
          host.right.openTab('browser', { params: { url: target } })
          return
        } catch {
          // A host without a live Session falls through to the system browser.
        }
      } else {
        pushToast('info', TEXT.noBrowser)
      }
      if (typeof window !== 'undefined') window.open(target, '_blank', 'noopener,noreferrer')
    }

    /** Open the page type a plugin entry declares, if the host has it. */
    function openPlugin(host, kind, pushToast) {
      if (kind === '') {
        pushToast('info', TEXT.openFailed)
        return
      }
      const tabs = host.tabs
      try {
        if (tabs !== undefined && typeof tabs.get === 'function' && tabs.get(kind) === undefined) {
          pushToast('error', TEXT.tabMissing(kind))
          return
        }
        host.right.openTab(kind)
      } catch {
        pushToast('error', TEXT.tabMissing(kind))
      }
    }

    /** Select a plugin's main panel; a profile without that panel says so. */
    function openPanel(host, panel, pushToast) {
      try {
        host.layout.selectPanel(panel)
      } catch {
        pushToast('error', TEXT.panelMissing(panel))
      }
    }

    // -------------------------------------------------------------- data hooks

    function useCatalog(pushToast) {
      const [state, setState] = useState({ status: 'loading', data: null, error: '', refreshing: false })
      const dataRef = useRef(null)
      const sequenceRef = useRef(0)

      const load = useCallback(async (refresh) => {
        const sequence = sequenceRef.current + 1
        sequenceRef.current = sequence
        const force = refresh === true
        setState((current) => (current.data === null
          ? { status: 'loading', data: null, error: '', refreshing: force }
          : { ...current, refreshing: force }))
        try {
          const body = await readJson(`${CATALOG_ROUTE}${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
          const catalog = body.catalog
          if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.entries)) throw new Error(TEXT.badCatalog)
          if (sequenceRef.current !== sequence) return
          dataRef.current = catalog
          setState({ status: 'ready', data: catalog, error: '', refreshing: false })
        } catch (error) {
          if (sequenceRef.current !== sequence) return
          const message = messageOf(error)
          if (dataRef.current === null) {
            setState({ status: 'failed', data: null, error: message, refreshing: false })
          } else {
            setState((current) => ({ ...current, refreshing: false }))
            pushToast('error', TEXT.refreshFailed)
          }
        }
      }, [pushToast])

      useEffect(() => { void load(false) }, [load])
      return { status: state.status, data: state.data, error: state.error, refreshing: state.refreshing, load }
    }

    function useShelf(pushToast) {
      const [state, setState] = useState({ status: 'loading', map: Object.create(null), links: [], pages: [], error: '' })
      const mapRef = useRef(Object.create(null))
      const pendingRef = useRef(new Set())
      const [pending, setPending] = useState({})

      const load = useCallback(async () => {
        setState((current) => (current.status === 'ready'
          ? { ...current, error: '' }
          : { status: 'loading', map: current.map, links: current.links, pages: current.pages, error: '' }))
        try {
          const body = await readJson(STATE_ROUTE, { cache: 'no-store' })
          const shelf = readShelfState(body.state)
          mapRef.current = shelf.map
          setState({ status: 'ready', map: shelf.map, links: shelf.links, pages: shelf.pages, error: '' })
        } catch (error) {
          const message = messageOf(error)
          setState((current) => ({ status: current.status === 'ready' ? 'ready' : 'failed', map: current.map, links: current.links, pages: current.pages, error: message }))
          pushToast('error', TEXT.savedStateFailed(message))
        }
      }, [pushToast])

      useEffect(() => { void load() }, [load])

      /** One mutation; the host answers with the whole new shelf. */
      const mutate = useCallback(async (payload) => {
        const body = await readJson(STATE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const shelf = readShelfState(body.state)
        mapRef.current = shelf.map
        setState({ status: 'ready', map: shelf.map, links: shelf.links, pages: shelf.pages, error: '' })
        return shelf
      }, [])

      const toggle = useCallback(async (entry) => {
        const id = entry !== null && typeof entry === 'object' && typeof entry.id === 'string' ? entry.id : ''
        if (id === '' || pendingRef.current.has(id)) return
        const before = isSaved(mapRef.current, id) ? mapRef.current[id] : undefined
        const removing = before !== undefined
        const optimistic = Object.create(null)
        for (const [key, value] of Object.entries(mapRef.current)) optimistic[key] = value
        if (removing) delete optimistic[id]
        else optimistic[id] = { at: new Date().toISOString() }
        pendingRef.current.add(id)
        setPending((current) => ({ ...current, [id]: true }))
        mapRef.current = optimistic
        setState((current) => ({ ...current, status: 'ready', map: optimistic }))
        try {
          const body = await readJson(STATE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ op: removing ? 'unfavorite' : 'favorite', id }),
          })
          const shelf = readShelfState(body.state)
          mapRef.current = shelf.map
          setState({ status: 'ready', map: shelf.map, links: shelf.links, pages: shelf.pages, error: '' })
        } catch (error) {
          const rolled = Object.create(null)
          for (const [key, value] of Object.entries(mapRef.current)) rolled[key] = value
          if (before === undefined) delete rolled[id]
          else rolled[id] = before
          mapRef.current = rolled
          setState((current) => ({ ...current, status: 'ready', map: rolled }))
          pushToast('error', TEXT.saveFailed(messageOf(error)))
        } finally {
          pendingRef.current.delete(id)
          setPending((current) => {
            const copy = { ...current }
            delete copy[id]
            return copy
          })
        }
      }, [pushToast])

      return { status: state.status, map: state.map, links: state.links, pages: state.pages, error: state.error, pending, load, toggle, mutate }
    }

    function useBundles(host) {
      const [state, setState] = useState({ status: 'loading', byName: new Map() })
      useEffect(() => {
        let alive = true
        let request
        try {
          request = Promise.resolve(host.listBundles())
        } catch (error) {
          request = Promise.reject(error)
        }
        request.then((rows) => {
          if (!alive) return
          if (!Array.isArray(rows)) {
            setState({ status: 'failed', byName: new Map() })
            return
          }
          const byName = new Map()
          for (const row of rows) {
            if (row === null || typeof row !== 'object' || typeof row.name !== 'string') continue
            if (!byName.has(row.name)) byName.set(row.name, row)
          }
          setState({ status: 'ready', byName })
        }, () => {
          if (alive) setState({ status: 'failed', byName: new Map() })
        })
        return () => { alive = false }
      }, [host])
      return state
    }

    /** Waterfall column count from the container's own width (2 / 3 / 4). */
    function useColumns() {
      const [node, setNode] = useState(null)
      const [count, setCount] = useState(2)
      useEffect(() => {
        if (node === null || typeof ResizeObserver === 'undefined') return
        const measure = () => {
          const width = node.clientWidth
          const next = width >= 980 ? 4 : width >= 560 ? 3 : 2
          setCount((current) => (current === next ? current : next))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
      }, [node])
      return [setNode, count]
    }

    // -------------------------------------------------------------------- atoms

    /** One cover/screenshot: HTTPS image with a gradient + glyph fallback. */
    function Picture({ src, alt, className, glyph }) {
      const [broken, setBroken] = useState(false)
      if (src === '' || broken) {
        return h('div', { className: `${className} ftg-ph`, 'aria-hidden': 'true' },
          h('span', { className: 'ftg-glyph' }, glyph))
      }
      return h('div', { className },
        h('img', {
          src,
          alt,
          loading: 'lazy',
          decoding: 'async',
          referrerPolicy: 'no-referrer',
          onError: () => setBroken(true),
        }))
    }

    /** Plugin installation tag: satisfied, missing, or not determinable. */
    function InstalledTag({ entry, installed }) {
      if (entry.kind === 'web') return h('span', { className: 'ftg-tag' }, TEXT.web)
      if (installed.status === 'installed') {
        const label = installed.version === '' ? TEXT.installed : TEXT.installedVersion(installed.version)
        return h('span', { className: 'ftg-tag', 'data-state': 'yes' }, label)
      }
      if (installed.status === 'unknown') return h('span', { className: 'ftg-tag' }, TEXT.plugin)
      return h('span', { className: 'ftg-tag', 'data-state': 'no' }, TEXT.notInstalled)
    }

    /** One waterfall card: cover, title, summary, badges, popularity, save. */
    function Card({ entry, saved, canSave, saving, installed, onOpen, onToggleFavorite }) {
      const summary = entrySummary(entry)
      const stars = typeof entry.stars === 'number' && Number.isFinite(entry.stars) ? entry.stars : null
      const author = typeof entry.author === 'string' && entry.author !== ''
        ? entry.author
        : typeof entry.owner === 'string' ? entry.owner : ''
      return h('div', {
        className: 'ftg-card',
        role: 'button',
        tabIndex: 0,
        'data-entry': entry.id,
        onClick: () => onOpen(entry),
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen(entry)
        },
      },
        h('div', { className: 'ftg-media' },
          h(Picture, { src: httpsUrl(entry.cover) || firstScreenshot(entry), alt: '', className: 'ftg-cover', glyph: firstGlyph(entry.title) }),
          canSave
            ? h('button', {
              type: 'button',
              className: 'ftg-fav',
              'data-on': saved ? '' : undefined,
              'aria-pressed': saved,
              'aria-label': saved ? TEXT.unsave : TEXT.save,
              title: saved ? TEXT.unsave : TEXT.save,
              disabled: saving,
              onClick: (event) => {
                event.stopPropagation()
                onToggleFavorite(entry)
              },
            }, saved ? '♥' : '♡')
            : null,
        ),
        h('div', { className: 'ftg-card-body' },
          h('div', { className: 'ftg-card-title' }, entryTitle(entry)),
          summary === '' ? null : h('div', { className: 'ftg-card-summary' }, summary),
          h('div', { className: 'ftg-card-meta' },
            h(InstalledTag, { entry, installed }),
            author === '' ? null : h('span', { className: 'ftg-author' }, author),
            stars === null ? null : h('span', { className: 'ftg-stars', title: TEXT.starsNote }, TEXT.stars(stars)),
          ),
        ),
      )
    }

    /** First usable screenshot source, used when an entry declares no cover. */
    function firstScreenshot(entry) {
      if (!Array.isArray(entry.screenshots)) return ''
      for (const shot of entry.screenshots) {
        const src = httpsUrl(shot !== null && typeof shot === 'object' ? shot.src : '')
        if (src !== '') return src
      }
      return ''
    }

    /** The CSS-columns waterfall for a set of entries. */
    function Waterfall({ entries, savedOf, canSave, savingOf, installedOf, onOpen, onToggleFavorite }) {
      const [setNode, columns] = useColumns()
      return h('div', { className: 'ftg-scroll' },
        h('div', { className: 'ftg-grid', 'data-cols': String(columns), ref: setNode },
          entries.map((entry) => h(Card, {
            key: entry.id,
            entry,
            saved: savedOf(entry),
            canSave: canSave(entry),
            saving: savingOf(entry),
            installed: installedOf(entry),
            onOpen,
            onToggleFavorite,
          })),
        ))
    }

    /** A centered state line with an optional retry action. */
    function StateNote({ title, message, action }) {
      return h('div', { className: 'ftg-state' },
        title === '' ? null : h('div', { className: 'ftg-state-title' }, title),
        message === '' ? null : h('div', null, message),
        action === undefined ? null : h('div', { className: 'ftg-state-action' }, action),
      )
    }

    /** The copyable plugin install command; the gallery never executes it. */
    function InstallBlock({ command, unknown }) {
      const [copyState, setCopyState] = useState('idle')
      const copy = useCallback(async () => {
        try {
          if (typeof navigator === 'undefined' || navigator.clipboard === undefined
            || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('clipboard unavailable')
          }
          await navigator.clipboard.writeText(command)
          setCopyState('copied')
        } catch {
          setCopyState('failed')
        }
      }, [command])
      if (command === '') return null
      return h('div', { className: 'ftg-install' },
        h('div', { className: 'ftg-install-head' },
          h('span', null, TEXT.installTitle),
          h('button', {
            type: 'button',
            className: 'ftg-btn',
            onClick: () => { void copy() },
          }, copyState === 'copied' ? TEXT.copied : TEXT.copy),
        ),
        h('code', { className: 'ftg-cmd' }, command),
        copyState === 'failed' ? h('div', { className: 'ftg-install-hint' }, TEXT.copyFailed) : null,
        unknown ? h('div', { className: 'ftg-install-hint' }, TEXT.unknownInstall) : null,
        h('div', { className: 'ftg-install-hint' }, TEXT.installHint),
      )
    }

    /** One entry's page inside the tab: screenshots, text, links, open action. */
    function Detail({ entry, installed, saved, canSave, saving, categoryTitle, onBack, onOpen, onToggleFavorite }) {
      const title = entryTitle(entry)
      const summary = entrySummary(entry)
      const details = localized(entry.details)
      const stars = typeof entry.stars === 'number' && Number.isFinite(entry.stars) ? entry.stars : null
      const author = typeof entry.author === 'string' && entry.author !== ''
        ? entry.author
        : typeof entry.owner === 'string' ? entry.owner : ''
      const homepage = httpsUrl(entry.homepage)
      const repo = httpsUrl(entry.repo)
      const shots = Array.isArray(entry.screenshots)
        ? entry.screenshots.filter((shot) => httpsUrl(shot !== null && typeof shot === 'object' ? shot.src : '') !== '')
        : []
      const cover = httpsUrl(entry.cover) || firstScreenshot(entry)
      const openKind = openKindOf(entry)
      const openPanelId = openPanelOf(entry)
      const canOpen = entry.kind === 'web'
        ? httpsUrl(entry.url) !== ''
        : installed.status === 'installed' && (openKind !== '' || openPanelId !== '')
      const command = entry.kind === 'plugin' && (installed.status === 'missing' || installed.status === 'unknown')
        ? installCommand(entry)
        : ''
      const engines = entry.engines !== null && typeof entry.engines === 'object' && typeof entry.engines.dsh === 'string'
        ? entry.engines.dsh
        : ''

      useEffect(() => {
        if (typeof document === 'undefined') return
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onBack()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [onBack])

      const notes = []
      if (stars !== null) notes.push(TEXT.starsNote)
      if (engines !== '') notes.push(TEXT.engines(engines))

      return h('div', { className: 'ftg-detail' },
        h('div', { className: 'ftg-bar' },
          h('button', {
            type: 'button',
            className: 'ftg-icon',
            'aria-label': TEXT.back,
            title: TEXT.back,
            onClick: onBack,
          }, '←'),
          h('div', { className: 'ftg-bar-title' }, title),
          canSave
            ? h('button', {
              type: 'button',
              className: 'ftg-icon',
              'data-on': saved ? '' : undefined,
              'aria-pressed': saved,
              'aria-label': saved ? TEXT.unsave : TEXT.save,
              title: saved ? TEXT.unsave : TEXT.save,
              disabled: saving,
              onClick: () => onToggleFavorite(entry),
            }, saved ? '♥' : '♡')
            : null,
        ),
        h('div', { className: 'ftg-detail-body' },
          cover === ''
            ? null
            : h('div', { className: 'ftg-detail-cover' },
              h(Picture, { src: cover, alt: '', className: 'ftg-cover ftg-cover-lg', glyph: firstGlyph(entry.title) })),
          h('h2', { className: 'ftg-detail-title' }, title),
          h('div', { className: 'ftg-detail-meta' },
            h(InstalledTag, { entry, installed }),
            entry.kind === 'plugin' && !canOpen && installed.status === 'installed'
              ? h('span', { className: 'ftg-tag' }, TEXT.noSurface)
              : null,
            categoryTitle === '' ? null : h('span', { className: 'ftg-tag' }, categoryTitle),
            author === '' ? null : h('span', null, `${TEXT.author} · ${author}`),
            stars === null ? null : h('span', { className: 'ftg-stars', title: TEXT.starsNote }, TEXT.stars(stars)),
          ),
          canOpen
            ? h('div', { className: 'ftg-actions' },
              h('button', {
                type: 'button',
                className: 'ftg-btn',
                'data-primary': '',
                onClick: () => onOpen(entry),
              }, TEXT.open))
            : null,
          h(InstallBlock, { command, unknown: installed.status === 'unknown' }),
          summary === '' ? null : h('div', { className: 'ftg-sect' },
            h('h3', { className: 'ftg-sect-h' }, TEXT.summary),
            h('p', { className: 'ftg-text' }, summary)),
          details === '' ? null : h('div', { className: 'ftg-sect' },
            h('h3', { className: 'ftg-sect-h' }, TEXT.details),
            h('p', { className: 'ftg-text' }, details)),
          shots.length === 0 ? null : h('div', { className: 'ftg-sect' },
            h('h3', { className: 'ftg-sect-h' }, TEXT.screenshots),
            h('div', { className: 'ftg-shots' },
              shots.map((shot, index) => {
                const src = httpsUrl(shot.src)
                const alt = localized(shot.alt) || title
                return h(Picture, {
                  key: `${src}-${index}`,
                  src,
                  alt,
                  className: 'ftg-shot',
                  glyph: firstGlyph(entry.title),
                })
              }),
            )),
          homepage === '' && repo === '' ? null : h('div', { className: 'ftg-sect' },
            h('h3', { className: 'ftg-sect-h' }, TEXT.links),
            h('div', { className: 'ftg-links' },
              homepage === '' ? null : h('a', {
                className: 'ftg-link',
                href: homepage,
                target: '_blank',
                rel: 'noopener noreferrer',
              }, TEXT.homepage),
              repo === '' ? null : h('a', {
                className: 'ftg-link',
                href: repo,
                target: '_blank',
                rel: 'noopener noreferrer',
              }, TEXT.repo),
            )),
          notes.length === 0 ? null : h('div', { className: 'ftg-note' }, notes.join(' · ')),
        ),
      )
    }

    // ------------------------------------------------------------------- tab

    /** The right-sidebar tab: view switch, waterfall, detail, save state. */
    function Gallery({ host, sessionId }) {
      const [view, setView] = useState('discover')
      const [detailId, setDetailId] = useState('')
      const [category, setCategory] = useState('')
      const [toast, setToast] = useState(null)
      const [addOpen, setAddOpen] = useState(false)
      const [editor, setEditor] = useState(null)
      const [rowMenu, setRowMenu] = useState('')
      const [confirming, setConfirming] = useState('')

      const pushToast = useCallback((kind, message) => {
        if (typeof message !== 'string' || message === '') return
        setToast({ kind, message })
      }, [])

      useEffect(() => {
        if (toast === null) return
        const timer = setTimeout(() => setToast(null), 5200)
        return () => clearTimeout(timer)
      }, [toast])

      const catalog = useCatalog(pushToast)
      const favorites = useShelf(pushToast)
      const bundles = useBundles(host)

      const catalogEntries = useMemo(() => {
        const entries = catalog.data !== null && Array.isArray(catalog.data.entries) ? catalog.data.entries : []
        return entries.filter(isEntry)
      }, [catalog.data])

      const catalogById = useMemo(() => {
        const byId = new Map()
        for (const entry of catalogEntries) byId.set(entry.id, entry)
        return byId
      }, [catalogEntries])

      const categories = useMemo(() => {
        const declared = catalog.data !== null && typeof catalog.data.categories === 'object' && catalog.data.categories !== null
          ? catalog.data.categories
          : {}
        const used = new Set(catalogEntries.map((entry) => (typeof entry.category === 'string' ? entry.category : '')).filter((id) => id !== ''))
        const list = []
        for (const [id, value] of Object.entries(declared)) {
          if (!used.has(id)) continue
          list.push({ id, title: localized(value) || id })
          used.delete(id)
        }
        for (const id of used) list.push({ id, title: id })
        return list
      }, [catalog.data, catalogEntries])

      const discoverEntries = useMemo(() => (category === ''
        ? catalogEntries
        : catalogEntries.filter((entry) => entry.category === category)), [catalogEntries, category])

      const shelfRows = useMemo(() => {
        if (favorites.status !== 'ready') return []
        const rows = []
        for (const id of Object.keys(favorites.map)) {
          const entry = catalogById.get(id)
          if (entry === undefined) continue
          const at = favorites.map[id]?.at ?? ''
          rows.push({ key: `catalog:${id}`, kind: 'catalog', at: Date.parse(at) || 0, when: formatWhen(at), entry })
        }
        for (const link of favorites.links) rows.push({ key: link.key, kind: 'link', at: Date.parse(link.at) || 0, when: formatWhen(link.at), title: link.title, link })
        for (const page of favorites.pages) rows.push({ key: page.key, kind: 'page', at: Date.parse(page.at) || 0, when: formatWhen(page.at), title: page.title, page })
        rows.sort((left, right) => right.at - left.at)
        return rows
      }, [favorites.status, favorites.map, favorites.links, favorites.pages, catalogById])

      const detailEntry = useMemo(
        () => (detailId === '' ? undefined : catalogById.get(detailId)),
        [detailId, catalogById],
      )

      const closeDetail = useCallback(() => setDetailId(''), [])

      const hasTabKind = useCallback((kind) => {
        const tabs = host.tabs
        return tabs !== undefined && typeof tabs.get === 'function' && tabs.get(kind) !== undefined
      }, [host])
      const hasMainPanel = useCallback((panel) => {
        const slots = host.slots
        try {
          return typeof slots.entries === 'function' && slots.entries('main').some(entry => entry?.options?.key === panel)
        } catch {
          return false
        }
      }, [host])
      const installedOf = useCallback(
        (entry) => installedState(entry, bundles, hasTabKind, hasMainPanel),
        [bundles, hasTabKind, hasMainPanel],
      )
      const savedOf = useCallback((entry) => isSaved(favorites.map, entry.id), [favorites.map])
      // The star stays in place when saved state is unavailable; only disabled.
      const canSave = useCallback(() => true, [])
      const savingOf = useCallback(
        (entry) => favorites.status !== 'ready' || favorites.pending[entry.id] === true,
        [favorites.status, favorites.pending],
      )

      const openEntry = useCallback((entry) => {
        if (entry === null || typeof entry !== 'object') return
        if (entry.kind === 'web') {
          openWeb(host, entry.url, pushToast)
          return
        }
        const panel = openPanelOf(entry)
        if (panel !== '') {
          openPanel(host, panel, pushToast)
          return
        }
        openPlugin(host, openKindOf(entry), pushToast)
      }, [host, pushToast])

      const toggleFavorite = useCallback((entry) => {
        if (favorites.status !== 'ready') return
        void favorites.toggle(entry)
      }, [favorites])

      const openLink = useCallback((url) => {
        openWeb(host, url, pushToast)
      }, [host, pushToast])

      const openPage = useCallback((path) => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          pushToast('info', TEXT.noSession)
          return
        }
        try {
          host.right.openResource(fileAddress(sessionId, path))
        } catch {
          pushToast('error', TEXT.previewUnavailable)
        }
      }, [host, sessionId, pushToast])

      const startEdit = useCallback((kind, row) => {
        setAddOpen(false)
        setRowMenu('')
        setConfirming('')
        setEditor(kind === 'link'
          ? { kind, id: row?.link?.id, title: row?.link?.title ?? '', url: row?.link?.url ?? '', path: '', error: '', busy: false }
          : { kind, id: row?.page?.id, title: row?.page?.title ?? '', url: '', path: row?.page?.path ?? '', error: '', busy: false })
      }, [])

      const submitEditor = useCallback(async (event) => {
        if (event !== undefined) event.preventDefault()
        if (editor === null || editor.busy) return
        const isLink = editor.kind === 'link'
        const title = editor.title.trim()
        const url = editor.url.trim()
        const path = editor.path.trim()
        if (isLink && !/^https?:\/\//iu.test(url)) {
          setEditor((current) => (current === null ? current : { ...current, error: TEXT.urlRequired }))
          return
        }
        if (!isLink && !path.startsWith('/')) {
          setEditor((current) => (current === null ? current : { ...current, error: TEXT.pathRequired }))
          return
        }
        const payload = isLink
          ? { op: editor.id === undefined ? 'add-link' : 'update-link', ...(editor.id === undefined ? {} : { id: editor.id }), title, url }
          : { op: editor.id === undefined ? 'add-page' : 'update-page', ...(editor.id === undefined ? {} : { id: editor.id }), title, path }
        setEditor((current) => (current === null ? current : { ...current, busy: true, error: '' }))
        try {
          await favorites.mutate(payload)
          setEditor(null)
          pushToast('info', editor.id === undefined ? (isLink ? TEXT.linkAdded : TEXT.pageAdded) : TEXT.updatedRow)
        } catch (error) {
          setEditor((current) => (current === null ? current : { ...current, busy: false, error: TEXT.addFailed(messageOf(error)) }))
        }
      }, [editor, favorites, pushToast])

      const removeRow = useCallback(async (kind, id) => {
        try {
          await favorites.mutate({ op: kind === 'link' ? 'remove-link' : 'remove-page', id })
          setRowMenu('')
          setConfirming('')
          pushToast('info', TEXT.removed)
        } catch (error) {
          pushToast('error', TEXT.addFailed(messageOf(error)))
        }
      }, [favorites, pushToast])

      /** One row of the unified timeline: a saved component, a URL or a local page. */
      const renderShelfRow = (row) => {
        const open = () => {
          if (row.kind === 'catalog') setDetailId(row.entry.id)
          else if (row.kind === 'link') openLink(row.link.url)
          else openPage(row.page.path)
        }
        const title = row.kind === 'catalog' ? entryTitle(row.entry) : row.title
        const sub = row.kind === 'catalog'
          ? (entrySummary(row.entry) || row.entry.id)
          : row.kind === 'link' ? row.link.url : row.page.path
        const menuOpen = rowMenu === row.key
        const confirmingRow = confirming === row.key
        const icon = row.kind === 'link'
          ? h('div', { className: 'ftg-row-ico', 'data-kind': 'link' }, firstGlyph(row.link.title) || '↗')
          : row.kind === 'page'
            ? h('div', { className: 'ftg-row-ico', 'data-kind': 'page' }, 'HTML')
            : h('div', { className: 'ftg-row-ico' }, firstGlyph(row.entry.title))
        return h('div', { key: row.key },
          h('div', {
            className: 'ftg-row',
            role: 'button',
            tabIndex: 0,
            'data-row': row.key,
            onClick: open,
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              open()
            },
          },
          icon,
          h('div', { className: 'ftg-row-main' },
            h('div', { className: 'ftg-row-title' }, title),
            h('div', { className: 'ftg-row-sub' }, sub)),
          h('span', { className: 'ftg-row-when' }, row.when),
          row.kind === 'catalog' ? null : h('button', {
            type: 'button',
            className: 'ftg-row-more',
            'aria-label': TEXT.edit,
            title: TEXT.edit,
            onClick: (event) => { event.stopPropagation(); setRowMenu(menuOpen ? '' : row.key); setConfirming('') },
          }, '⋯')),
          menuOpen ? h('div', { className: 'ftg-row-menu' },
            h('button', {
              type: 'button',
              className: 'ftg-btn',
              onClick: (event) => { event.stopPropagation(); startEdit(row.kind, row) },
            }, TEXT.edit),
            confirmingRow
              ? h('button', {
                type: 'button',
                className: 'ftg-btn',
                onClick: (event) => { event.stopPropagation(); void removeRow(row.kind, row.link?.id ?? row.page?.id) },
              }, TEXT.confirmRemove)
              : h('button', {
                type: 'button',
                className: 'ftg-btn',
                onClick: (event) => { event.stopPropagation(); setConfirming(row.key) },
              }, TEXT.remove)) : null,
        )
      }

      const categoryTitleOf = useCallback((entry) => {
        const declared = catalog.data !== null && typeof catalog.data.categories === 'object' && catalog.data.categories !== null
          ? catalog.data.categories
          : {}
        const id = typeof entry.category === 'string' ? entry.category : ''
        if (id === '') return ''
        return localized(declared[id]) || id
      }, [catalog.data])

      // A detail page replaces the list and owns its own back control.
      if (detailEntry !== undefined) {
        return h('div', { className: 'ftg' },
          h(Detail, {
            entry: detailEntry,
            installed: installedOf(detailEntry),
            saved: savedOf(detailEntry),
            canSave: canSave(detailEntry),
            saving: savingOf(detailEntry),
            categoryTitle: categoryTitleOf(detailEntry),
            onBack: closeDetail,
            onOpen: openEntry,
            onToggleFavorite: toggleFavorite,
          }),
          toast === null ? null : h('div', { className: 'ftg-toast', 'data-kind': toast.kind, role: 'status' }, toast.message),
        )
      }

      const ready = catalog.status === 'ready' && catalog.data !== null
      const segments = h('div', { className: 'ftg-seg' },
        h('button', {
          type: 'button',
          'data-on': view === 'discover' ? '' : undefined,
          'aria-pressed': view === 'discover',
          onClick: () => setView('discover'),
        }, TEXT.discover),
        h('button', {
          type: 'button',
          'data-on': view === 'shelf' ? '' : undefined,
          'aria-pressed': view === 'shelf',
          onClick: () => setView('shelf'),
        }, TEXT.shelf,
        shelfRows.length === 0 ? null : h('span', { className: 'ftg-n' }, String(shelfRows.length))),
      )

      const header = h('div', { className: 'ftg-head' },
        segments,
        h('button', {
          type: 'button',
          className: 'ftg-icon',
          'aria-label': TEXT.refresh,
          title: TEXT.refresh,
          'aria-busy': catalog.refreshing,
          disabled: catalog.refreshing,
          onClick: () => { void catalog.load(true) },
        }, '↻'),
        h('div', { className: 'ftg-add' },
          h('button', {
            type: 'button',
            className: 'ftg-btn',
            'data-primary': '',
            'aria-expanded': addOpen,
            onClick: () => setAddOpen((open) => !open),
          }, `＋ ${TEXT.add}`),
          addOpen
            ? h('div', { className: 'ftg-add-menu' },
              h('button', { type: 'button', onClick: () => startEdit('link') }, TEXT.addLink, h('small', null, TEXT.linkHint)),
              h('button', { type: 'button', onClick: () => startEdit('page') }, TEXT.addPage, h('small', null, TEXT.pageHint)))
            : null),
      )

      // Freshness: the Host reports it as top-level flags in the client contract
      // and as `meta.stale` / `meta.remote` in the shipped route; both work.
      const freshness = freshnessOf(catalog.data)
      const subline = view === 'discover' && ready
        ? h('div', { className: 'ftg-sub' },
          formatTime(catalog.data.generatedAt) === ''
            ? null
            : h('span', null, TEXT.updated(formatTime(catalog.data.generatedAt))),
          freshness.stale ? h('span', { className: 'ftg-stale' }, TEXT.stale) : null,
          freshness.cached ? h('span', null, TEXT.cached) : null,
          h('span', null, TEXT.entryCount(catalogEntries.length)),
        )
        : null

      const pills = view === 'discover' && ready && categories.length > 1
        ? h('div', { className: 'ftg-pills' },
          h('button', {
            type: 'button',
            className: 'ftg-pill',
            'data-on': category === '' ? '' : undefined,
            onClick: () => setCategory(''),
          }, TEXT.all),
          categories.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'ftg-pill',
            'data-on': category === item.id ? '' : undefined,
            onClick: () => setCategory((current) => (current === item.id ? '' : item.id)),
          }, item.title)))
        : null

      let body
      const catalogFailed = catalog.status === 'failed'
      const catalogFailure = TEXT.loadFailed(catalog.error === '' ? TEXT.badResponse : catalog.error)
      if (!ready && !(catalogFailed && view === 'shelf')) {
        body = catalogFailed
          ? h(StateNote, {
            title: '',
            message: catalogFailure,
            action: h('button', { type: 'button', className: 'ftg-btn', onClick: () => { void catalog.load(false) } }, TEXT.retry),
          })
          : h(StateNote, { title: '', message: TEXT.loading })
      } else if (view === 'discover') {
        body = discoverEntries.length === 0
          ? h(StateNote, { title: '', message: catalogEntries.length === 0 ? TEXT.emptyCatalog : TEXT.emptyFiltered })
          : h(Waterfall, {
            entries: discoverEntries,
            savedOf,
            canSave,
            savingOf,
            installedOf,
            onOpen: (entry) => setDetailId(entry.id),
            onToggleFavorite: toggleFavorite,
          })
      } else {
        const failed = favorites.status === 'failed'
        const loading = favorites.status === 'loading'
        if (loading) {
          body = h(StateNote, { title: '', message: TEXT.loadingSaved })
        } else {
          const notes = []
          if (catalogFailed) {
            notes.push(h('div', { key: 'catalog-error', className: 'ftg-sub' },
              h('span', { className: 'ftg-stale' }, catalogFailure),
              h('button', { type: 'button', className: 'ftg-pill', onClick: () => { void catalog.load(false) } }, TEXT.retry)))
          }
          if (failed) {
            notes.push(h('div', { key: 'saved-error', className: 'ftg-sub' },
              h('span', { className: 'ftg-stale' }, TEXT.savedStateFailed(favorites.error === '' ? TEXT.badResponse : favorites.error)),
              h('button', { type: 'button', className: 'ftg-pill', onClick: () => { void favorites.load() } }, TEXT.retry)))
          }
          const form = editor === null ? null : h('form', { className: 'ftg-form', onSubmit: submitEditor },
            editor.error === '' ? null : h('div', { className: 'ftg-form-error' }, editor.error),
            h('div', { className: 'ftg-field' },
              h('label', null, TEXT.titleField),
              h('input', {
                value: editor.title,
                placeholder: TEXT.titleHint(editor.kind === 'link' ? hostOf(editor.url) : baseName(editor.path)),
                onChange: (event) => setEditor((current) => (current === null ? current : { ...current, title: event.target.value })),
              })),
            editor.kind === 'link'
              ? h('div', { className: 'ftg-field' },
                h('label', null, TEXT.urlField),
                h('input', {
                  value: editor.url,
                  placeholder: 'https://',
                  onChange: (event) => setEditor((current) => (current === null ? current : { ...current, url: event.target.value })),
                }))
              : h('div', { className: 'ftg-field' },
                h('label', null, TEXT.pathField),
                h('input', {
                  value: editor.path,
                  placeholder: '/Users/…/report.html',
                  onChange: (event) => setEditor((current) => (current === null ? current : { ...current, path: event.target.value })),
                })),
            h('div', { className: 'ftg-form-actions' },
              h('button', { type: 'button', className: 'ftg-btn', onClick: () => setEditor(null) }, TEXT.cancel),
              h('button', { type: 'submit', className: 'ftg-btn', 'data-primary': '', disabled: editor.busy }, editor.busy ? '…' : TEXT.saveForm)))
          const savedComponents = shelfRows.filter((row) => row.kind === 'catalog')
          const personalRows = shelfRows.filter((row) => row.kind !== 'catalog')
          const componentHead = h('div', { className: 'ftg-sec-head', 'data-first': '' },
            h('span', { className: 'ftg-sec-title' }, TEXT.componentShelf),
            savedComponents.length === 0 ? null : h('span', { className: 'ftg-sec-count' }, String(savedComponents.length)))
          const componentBody = savedComponents.length === 0
            ? h('div', { className: 'ftg-sec-note' },
              TEXT.emptyComponents,
              h('button', { type: 'button', className: 'ftg-btn', onClick: () => setView('discover') }, TEXT.goDiscover))
            : h(Waterfall, {
              entries: savedComponents.map((row) => row.entry),
              savedOf,
              canSave,
              savingOf,
              installedOf,
              onOpen: (entry) => setDetailId(entry.id),
              onToggleFavorite: toggleFavorite,
            })
          const personalHead = h('div', { className: 'ftg-sec-head' },
            h('span', { className: 'ftg-sec-title' }, TEXT.personalShelf),
            personalRows.length === 0 ? null : h('span', { className: 'ftg-sec-count' }, String(personalRows.length)))
          const personalBody = personalRows.length === 0
            ? h('div', { className: 'ftg-sec-note' }, TEXT.emptyPersonal)
            : h('div', { className: 'ftg-list' }, personalRows.map(renderShelfRow))
          body = [...notes, form, componentHead, componentBody, personalHead, personalBody]
        }
      }

      return h('div', { className: 'ftg' },
        header,
        subline,
        pills,
        body,
        toast === null ? null : h('div', { className: 'ftg-toast', 'data-kind': toast.kind, role: 'status' }, toast.message),
      )
    }

    // ------------------------------------------------------------------ apply

    /**
     * Register the tab type and its body; both live exactly as long as the
     * plugin does.
     * @param ctx - client plugin context.
     */
    function apply(ctx) {
      ensureStyle()
      const host = {
        get right() { return ctx.sidebarRight },
        get tabs() { return ctx.sidebarRightTabs },
        get layout() { return ctx.layout },
        get slots() { return ctx.slots },
        listBundles() {
          // `remote.pluginManager` is its own cordis service, so `ctx.get`
          // reads it without needing the `remote` namespace service too.
          const manager = ctx.get('remote.pluginManager')
          if (manager === undefined || typeof manager.listBundles !== 'function') {
            return Promise.reject(new Error('plugin manager unavailable'))
          }
          return Promise.resolve(manager.listBundles())
        },
      }
      const Seat = ({ sessionId }) => h(Gallery, { host, sessionId })
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        keepMounted: true,
        title: () => TEXT.title,
        guide: [{ id: 'gallery', order: 60, title: () => TEXT.title, description: () => TEXT.guide }],
      }), 'dsh-fft-gallery: tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: TAB_ID },
        Seat,
      )), 'dsh-fft-gallery: tab body')
    }

    exports.apply = apply
    exports.inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'layout', 'remote.pluginManager']
    return module.exports
  },
})
