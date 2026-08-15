// DSH 主题 (dsh-themes) — Client 入口
// 本文件由 VitePlus(vp pack)打包为 IIFE 并包装成 __ModuleLoader__ factory。
// 以 profile bundle(静态插件)方式挂载:通过注入的 theme / slots / connection
// 服务工作;与 Host 半区的 RPC 通过 connection.rpc.call('/dsh-themes', ...) 配对。
// 调色板引擎(语义角色映射、双种子生成、对比度求解)与 VS Code 导入映射的
// 架构灵感来自 t3code(https://github.com/pingdotgg/t3code),详见仓库 README。
// 界面文案通过 client locale 服务本地化(命名空间 dsh-themes,见 locales.ts):
// 跟随 DSH 语言设置(设置 → 通用 → Language),切换后自动重渲染。
import { DEFAULT_THEME, TOKEN_NAMES, PALETTES, DEFAULT_PALETTE, CORE_TOKEN_NAMES } from './palette.js'
import { humanizeName, parseVsCodeTheme, slugify } from './vs-import.js'
import { STYLES_CSS } from './styles.js'
import { NAV_ICON_CSS, installNavIconPatch } from './nav-icon.js'
import { LOCALES } from './locales.js'
export const PLUGIN_NAME = 'dsh-themes'
export default {
  apply(ctx) {
    // 等待核心服务就绪后再挂载(而非 apply 时提前 return:静态 kernel 中
    // 过早 apply 会导致插件永久失效)。React 由安装脚本在 factory 顶层
    // 注入 `const React = require('react')`(__ModuleLoader__ seed word)。
    ctx.inject(['theme', 'slots', 'connection', 'locale'], (scope) => {
    const theme = scope.theme
    const slots = scope.slots
    const connection = scope.connection
    const locale = scope.locale

    // ---- 国际化:注册词典并绑定翻译函数 ----
    // ctx.effect 托管 register 返回的 disposer,插件停止/重载时清理词典。
    ctx.effect(() => locale.register('dsh-themes', LOCALES))
    const t = locale.bind('dsh-themes')

    /** 本地化 Host RPC 错误:优先按稳定错误码翻译,message 中冒号后的内容作为详情透传。 */
    function errorText(res, fallback) {
      const err = res && res.error
      if (!err) return fallback
      const msg = typeof err === 'string' ? err : (err && err.message) || ''
      const code = (err && typeof err === 'object' && typeof err.code === 'string' && err.code !== 'bad-request')
        ? err.code
        : ''
      if (code) {
        const key = 'error.' + code
        const localized = t(key)
        if (localized !== key) {
          const idx = msg.indexOf(':')
          const detail = idx > 0 ? msg.slice(idx + 1).trim() : ''
          return localized + (detail ? ': ' + detail : '')
        }
      }
      return fallback
    }

    /** 展示用的主题名映射:持久化数据语言中立,内置「DSH 默认」及副本在渲染时本地化。 */
    function plabel(label) {
      if (typeof label !== 'string') return label
      if (label.endsWith(' 副本')) return plabel(label.slice(0, -3)) + ' ' + t('copySuffix')
      if (label.startsWith('DSH 默认')) return t('defaultThemeLabel') + label.slice('DSH 默认'.length)
      return label
    }

    /** 展示用的变体名映射:默认「浅色」/「深色」槽标签在渲染时本地化,导入主题的真实变体名保持原样。 */
    function vlabel(label) {
      if (label === '浅色') return t('mode.light')
      if (label === '深色') return t('mode.dark')
      return label
    }

    const modeLabel = (m) => t('mode.' + m)

    // ============================================================
    // 颜色工具:RGB/HSL 混合 + WCAG 对比度求解
    // (受 t3code 主题引擎启发)
    // ============================================================

    const store = {
      current: null,
      mixed: { light: null, dark: null },
      custom: [],
      loaded: false,
      /** 本会话是否曾从磁盘载入/添加过自定义主题(空库覆盖磁盘旧库的防线)。 */
      hadCustom: false,
      listeners: new Set(),
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      emit() { for (const fn of this.listeners) fn() },
    }
    let layerDisposer = null

    function paletteById(id) {
      if (!id) return null
      return PALETTES.find((p) => p.id === id) || store.custom.find((p) => p.id === id) || null
    }

    /** 将主题库状态持久化到 ~/.dsh/dsh-themes.json(Host 侧写入)。 */
    function persist() {
      if (!store.loaded) return
      // 防数据丢失:本会话从未成功载入/添加过自定义主题时,拒绝用空库覆盖
      // 磁盘上可能仍存在的旧库(load-themes 失败或返回空时触发)。用户显式
      // 删除最后一个自定义主题(removeCustom 清空 hadCustom)除外。
      if (store.custom.length === 0 && store.hadCustom) return
      connection.rpc.call('/dsh-themes', 'persist-themes', {
        payload: { current: store.mixed.light, mixed: store.mixed, custom: store.custom },
      }).catch(() => {})
    }

    /** 某外观模式当前生效的主题:显式指定优先,未指定由默认主题兜底。 */
    function ownerOf(mode) {
      const id = store.mixed[mode]
      return (id ? paletteById(id) : null) || DEFAULT_THEME
    }

    /** 统一应用覆盖层:明/暗各自独立归属,缺省一侧由默认主题兜底。 */
    function applyLayers() {
      const lightOwner = ownerOf('light')
      const darkOwner = ownerOf('dark')
      const pairs = {}
      for (const name of TOKEN_NAMES) {
        pairs[name] = {
          light: lightOwner.light[name],
          dark: darkOwner.dark[name],
        }
      }
      layerDisposer = theme.overrideTokens('dsh-themes', pairs)
      store.emit()
    }

    /** 选择单一主题:明/暗两侧都指向它(点击主题卡片)。 */
    function applyPalette(palette) {
      const id = palette ? palette.id : null
      store.mixed.light = id
      store.mixed.dark = id
      applyLayers()
      persist()
    }

    /** 选择某外观模式的变体:只设置该侧归属,不切换外观模式。 */
    function selectVariant(palette, mode, variant) {
      palette[mode] = variant.tokens
      store.mixed[mode] = palette.id
      applyLayers()
      persist()
    }

    /** 恢复默认:两侧都未指定,全部由默认主题兜底。 */
    function clearAll() {
      store.mixed.light = null
      store.mixed.dark = null
      applyLayers()
      persist()
    }

    function removeCustom(id) {
      store.custom = store.custom.filter((p) => p.id !== id)
      // 显式删除最后一个自定义主题:视为用户有意清空库,允许持久化空库
      if (store.custom.length === 0) store.hadCustom = false
      if (store.mixed.light === id) store.mixed.light = null
      if (store.mixed.dark === id) store.mixed.dark = null
      applyLayers()
      persist()
    }

    function isValidPalette(p) {
      return !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.label === 'string' &&
        p.light && typeof p.light === 'object' && p.dark && typeof p.dark === 'object' &&
        CORE_TOKEN_NAMES.every((tok) => typeof p.light[tok] === 'string' && typeof p.dark[tok] === 'string')
    }

    /** 补齐缺失的品牌 token 与变体槽(旧版库升级兼容),返回新对象。 */
    function fillPalette(p) {
      const out = { id: p.id, label: p.label, light: {}, dark: {} }
      for (const t of TOKEN_NAMES) {
        out.light[t] = typeof p.light[t] === 'string' ? p.light[t] : DEFAULT_PALETTE.light[t]
        out.dark[t] = typeof p.dark[t] === 'string' ? p.dark[t] : DEFAULT_PALETTE.dark[t]
      }
      out.lightVariants = Array.isArray(p.lightVariants) && p.lightVariants.length > 0
        ? p.lightVariants
        : [{ label: '浅色', tokens: out.light }]
      out.darkVariants = Array.isArray(p.darkVariants) && p.darkVariants.length > 0
        ? p.darkVariants
        : [{ label: '深色', tokens: out.dark }]
      if (p.collection && typeof p.collection.id === 'string') out.collection = p.collection
      if (p.imported) out.imported = true
      return out
    }

    /** 从持久化存储恢复主题库(异步、幂等)。 */
    async function hydrate() {
      let ok = false
      try {
        const res = await connection.rpc.call('/dsh-themes', 'load-themes', {})
        // load-themes 方法体返回 { ok, data },经信封包装后内容在 value.data
        if (res && res.ok) {
          const d = res.value ? res.value.data : null
          ok = true
          if (d) {
            if (Array.isArray(d.custom)) {
              const raw = d.custom.filter((p) => isValidPalette(p)).map((p) => fillPalette(p))
              store.custom = raw
              // 磁盘上存在自定义主题即视为“持有旧库”,空库持久化必须被拦截
              if (raw.length > 0 || (d.custom.length > 0 && raw.length === 0)) store.hadCustom = true
            }
            // half 模型:优先恢复 mixed;旧版 current 转成双侧同值
            if (d.mixed && typeof d.mixed === 'object') {
              if (typeof d.mixed.light === 'string' && paletteById(d.mixed.light)) store.mixed.light = d.mixed.light
              if (typeof d.mixed.dark === 'string' && paletteById(d.mixed.dark)) store.mixed.dark = d.mixed.dark
            } else if (typeof d.current === 'string' && paletteById(d.current)) {
              store.mixed.light = d.current
              store.mixed.dark = d.current
            }
          }
        }
      } catch { /* 持久化不可用时保持 loaded=false:禁止 persist,避免用空库覆盖磁盘旧库 */ }
      store.loaded = ok
      applyLayers()
      store.emit()
    }

    /** 解析单个 VS Code 主题文件为导入条目(不写入库)。 */
    function buildImportedEntry(text, sourceName) {
      let raw
      try { raw = JSON.parse(text) } catch (e) { throw new Error(t('jsonParseFailed') + ':' + ((e && e.message) || String(e))) }
      const tokens = parseVsCodeTheme(raw)
      let label = ''
      for (const cand of [raw.displayName, raw.name]) {
        if (typeof cand !== 'string') continue
        const h = humanizeName(cand)
        if (h.length > 0) { label = h; break }
      }
      if (!label && sourceName) label = humanizeName(String(sourceName).replace(/\.json$/i, '').replace(/[#?].*$/, ''))
      label = (label || t('vsCodeTheme')).slice(0, 40)
      return { label, appearance: tokens.appearance, light: tokens.light, dark: tokens.dark }
    }

    /** 生成唯一 id 并写入库。 */
    function pushImportedPalette(palette) {
      const base = slugify(palette.label)
      let id = 'vsc-' + base
      let n = 2
      while (store.custom.some((p) => p.id === id)) id = 'vsc-' + base + '-' + n++
      const final = { ...palette, id }
      store.custom.push(final)
      // 导入是显式写入:即便 hydrate 失败(loaded=false),也应允许持久化
      store.loaded = true
      store.hadCustom = true
      return final
    }

    /** 设置主题某个明暗槽的变体并应用。 */
    function setVariant(palette, mode, variant) {
      selectVariant(palette, mode, variant)
    }

    /** 明暗变体聚合(参照 t3code variants 模型):同一扩展的所有明色文件聚合为明色槽、暗色文件聚合为暗色槽,一个主题一张卡片。 */
    function importBatchThemes(results, collection) {
      const entries = []
      for (const r of results) {
        try {
          entries.push({ ...buildImportedEntry(r.text, r.label), sourceLabel: r.label || '' })
        } catch { /* 跳过无法解析的文件 */ }
      }
      if (entries.length === 0) throw new Error(t('noImportFiles'))
      const lights = entries.filter((e) => e.appearance === 'light')
      const darks = entries.filter((e) => e.appearance === 'dark')
      if (lights.length === 0 && darks.length === 0) throw new Error(t('noImportFiles'))
      const light = lights[0] ? lights[0].light : darks[0].dark
      const dark = darks[0] ? darks[0].dark : lights[0].light
      const label = (collection && collection.label) || entries[0].label
      const palette = pushImportedPalette({
        label,
        ...(collection ? { collection } : {}),
        imported: true,
        light,
        dark,
        lightVariants: lights.map((e) => ({ label: e.label, tokens: e.light })),
        darkVariants: darks.map((e) => ({ label: e.label, tokens: e.dark })),
      })
      applyPalette(palette)
      return t('importedBatch', { name: palette.label, light: lights.length, dark: darks.length })
    }

    function importVsCodeTheme(text, sourceName) {
      const entry = buildImportedEntry(text, sourceName)
      const palette = pushImportedPalette({
        label: entry.label,
        imported: true,
        light: entry.light,
        dark: entry.dark,
        lightVariants: [{ label: '浅色', tokens: entry.light }],
        darkVariants: [{ label: '深色', tokens: entry.dark }],
      })
      applyPalette(palette)
      return palette
    }

    // ---- 样式 ----

    ctx.effect(() => {
      // 静态 client 无动态 sandbox 的 styles 座位:自行注入并回收 <style> 标签
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-dsh-themes', '')
      styleEl.textContent = STYLES_CSS + NAV_ICON_CSS
      document.head.appendChild(styleEl)
      return () => {
        if (layerDisposer) { try { layerDisposer() } catch { /* ignore */ } layerDisposer = null }
        styleEl.remove()
      }
    })

    // 设置页导航图标补丁:设置面板重开时重新打标记(元素重建,观察者再次扫描)
    ctx.effect(() => installNavIconPatch(), 'dsh-themes: settings nav icon patch')

    // ---- 设置页 ----

    /** 颜色详细参数编辑器(参照 t3code ThemeEditorPanel 的分组结构):按语义分组列出 token。标签为字典键,渲染时经 t() 本地化。 */
    const EDITOR_GROUPS = [
      { id: 'main', titleKey: 'editorGroup.main', tokens: [
        ['--dsw-alias-bg-base', 'tok.bgBase'],
        ['--dsw-alias-bg-layer-2', 'tok.surface'],
        ['--dsw-alias-bg-overlay', 'tok.overlay'],
        ['--dsw-alias-border-l1', 'tok.border'],
        ['--dsw-alias-label-primary', 'tok.textPrimary'],
        ['--dsw-alias-label-secondary', 'tok.textSecondary'],
        ['--dsw-specific-sidebar-fill', 'tok.sidebar'],
        ['--dsw-alias-brand-primary', 'tok.brand'],
        ['--dsw-alias-button-info-fill', 'tok.actionButton'],
        ['--dsw-alias-state-business-primary', 'tok.business'],
      ] },
      { id: 'status', titleKey: 'editorGroup.status', tokens: [
        ['--dsw-alias-state-error-primary', 'tok.error'],
        ['--dsw-alias-state-warn-primary', 'tok.warn'],
        ['--dsw-alias-state-success-primary', 'tok.success'],
        ['--dsw-static-deepseek-450', 'tok.running'],
      ] },
      { id: 'other', titleKey: 'editorGroup.other', tokens: [
        ['--dsw-specific-bubble', 'tok.bubble'],
        ['--dsw-specific-bubble-highlight', 'tok.bubbleHighlight'],
        ['--dsw-specific-sidebar-nav-item-active', 'tok.sidebarActive'],
        ['--dsw-static-deepseek-500', 'tok.brandDark'],
        ['--dsw-static-deepseek-200', 'tok.brandLight'],
      ] },
    ]


    /** 明暗槽变体选择器:融合色球列表,选中放大,溢出时显示左右导航箭头,悬停显示变体名。 */
    function VariantRow({ palette, mode, variants, active }) {
      const ref = React.useRef(null)
      const [nav, setNav] = React.useState({ left: false, right: false })
      const updateNav = React.useCallback(() => {
        const el = ref.current
        if (!el) return
        setNav({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
      }, [])
      React.useEffect(() => {
        const el = ref.current
        if (!el) return
        updateNav()
        el.addEventListener('scroll', updateNav)
        if (typeof window !== 'undefined') window.addEventListener('resize', updateNav)
        return () => {
          el.removeEventListener('scroll', updateNav)
          if (typeof window !== 'undefined') window.removeEventListener('resize', updateNav)
        }
      }, [updateNav, variants.length])
      const scrollBy = (dir) => {
        const el = ref.current
        if (el) el.scrollBy({ left: dir * 80, behavior: 'smooth' })
      }
      const dark = mode === 'dark'
      const ballStyle = (tokens) => {
        const canvas = tokens['--dsw-alias-bg-base']
        const accent = tokens['--dsw-alias-brand-primary']
        const action = tokens['--dsw-alias-button-info-fill']
        const modeBase = dark
          ? 'color-mix(in oklab, ' + canvas + ' 80%, #09090b)'
          : 'color-mix(in oklab, ' + canvas + ' 80%, #ffffff)'
        const accentPos = dark ? '28% 78%' : '72% 22%'
        const actionPos = dark ? '82% 18%' : '18% 82%'
        const fade = dark ? 62 : 72
        return {
          backgroundColor: modeBase,
          backgroundImage: [
            'radial-gradient(circle at ' + accentPos + ' in oklab, ' + accent + ' 0%, color-mix(in oklab, ' + accent + ' ' + fade + '%, transparent) 28%, transparent 58%)',
            'radial-gradient(circle at ' + actionPos + ' in oklab, color-mix(in oklab, ' + action + ' 45%, transparent) 0%, transparent 55%)',
          ].join(', '),
        }
      }
      const activeIdx = Math.max(0, variants.findIndex((v) => v.tokens === palette[mode]))
      return React.createElement('div', { className: 'dsth-vrow' },
        React.createElement('span', { className: 'dsth-vlabel' }, modeLabel(mode)),
        React.createElement('button', {
          className: 'dsth-nav dsth-nav-l' + (nav.left ? '' : ' dsth-nav-disabled'),
          disabled: !nav.left,
          tabIndex: -1,
          onClick: () => scrollBy(-1),
        }),
        React.createElement('div', { className: 'dsth-balls', ref, onScroll: updateNav },
          variants.map((v, i) => React.createElement('span', { key: v.label + i, className: 'dsth-ball-slot' },
            React.createElement('button', {
              className: 'dsth-ball' + (active && i === activeIdx ? ' dsth-ball-active' : '') + (dark ? ' dsth-ball-dark' : ''),
              style: ballStyle(v.tokens),
              title: vlabel(v.label),
              onClick: () => setVariant(palette, mode, v),
            })
          ))
        ),
        React.createElement('button', {
          className: 'dsth-nav dsth-nav-r' + (nav.right ? '' : ' dsth-nav-disabled'),
          disabled: !nav.right,
          tabIndex: -1,
          onClick: () => scrollBy(1),
        })
      )
    }

    function ThemesPage() {
      const [snapshot, setSnapshot] = React.useState(() => theme.getTheme())
      const [, setTick] = React.useState(0)
      const [scanRoot, setScanRoot] = React.useState('')
      const [scanResults, setScanResults] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [url, setUrl] = React.useState('')
      const [pasteText, setPasteText] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [searchQuery, setSearchQuery] = React.useState('')
      const [searchResults, setSearchResults] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [editMode, setEditMode] = React.useState('light')
      const editSnapshot = React.useRef(null)
      React.useEffect(() => ctx.on('theme/change', (next) => setSnapshot(next)), [])
      React.useEffect(() => store.subscribe(() => setTick((n) => n + 1)), [])
      // 语言切换/词典注册时重渲染,界面文案即时跟随
      React.useEffect(() => locale.subscribe(() => setTick((n) => n + 1)), [])
      const preference = snapshot.preference

      const runScan = async () => {
        setBusy('scan')
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'scan-vscode-themes', { root: scanRoot })
          if (res && res.ok) {
            const value = res.value || {}
            setScanResults(value.themes || [])
            if ((value.themes || []).length === 0) setMessage({ kind: 'error', text: t('noThemesFound', { roots: value.roots }) })
          } else {
            setMessage({ kind: 'error', text: errorText(res, t('scanFailed')) })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: t('callFailed') + ': ' + String((e && e.message) || e) })
        }
        setBusy('')
      }

      const importLocal = async (entry) => {
        setBusy(entry.path)
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'read-theme-file', { path: entry.path })
          if (res && res.ok) {
            doImport(res.value.text, entry.label)
          } else {
            setMessage({ kind: 'error', text: errorText(res, t('readFailed')) })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      const fetchUrl = async () => {
        if (!url.trim()) { setMessage({ kind: 'error', text: t('urlRequired') }); return }
        setBusy('url')
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'fetch-theme-url', { url: url.trim() })
          if (res && res.ok) {
            doImport(res.value.text, url.trim().split('/').pop() || 'remote')
            setUrl('')
          } else {
            setMessage({ kind: 'error', text: errorText(res, t('fetchFailed')) })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      const pasteImport = () => {
        if (!pasteText.trim()) { setMessage({ kind: 'error', text: t('pasteRequired') }); return }
        doImport(pasteText, t('pastedTheme'))
      }

      const doImport = (text, sourceName) => {
        try {
          const palette = importVsCodeTheme(text, sourceName)
          setMessage({ kind: 'ok', text: t('importedApplied', { name: palette.label }) })
        } catch (e) {
          setMessage({ kind: 'error', text: t('importFailed') + ': ' + String((e && e.message) || e) })
        }
      }

      // ---- Open VSX 搜索安装 ----

      const isZh = locale.getLocale().active === 'zh'
      const fmtCount = (n) => {
        if (isZh) return n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n)
        return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
      }

      const fmtDate = (iso) => {
        if (!iso) return ''
        const d = new Date(iso)
        if (isNaN(d.getTime())) return ''
        const days = Math.floor((Date.now() - d.getTime()) / 86400000)
        if (days <= 0) return t('today')
        if (days === 1) return t('yesterday')
        if (days < 30) return t('daysAgo', { days })
        const p = (n) => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      }

      const fmtRating = (r, count) => r > 0 ? '★ ' + r.toFixed(1) + (count > 0 ? ' (' + count + ')' : '') : ''

      const runSearch = async () => {
        if (!searchQuery.trim()) { setMessage({ kind: 'error', text: t('searchRequired') }); return }
        setBusy('search')
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'search-open-vsx', { query: searchQuery.trim() })
          if (res && res.ok) {
            const list = (res.value && res.value.list) || []
            setSearchResults(list)
            // 作者/许可证需详情接口,后台异步补充,不阻塞搜索展示
            if (list.length > 0) {
              Promise.all(list.map((ext) => connection.rpc.call('/dsh-themes', 'open-vsx-detail', { namespace: ext.namespace, name: ext.name }).then((d) => {
                const detail = d && d.ok ? d.value : null
                if (detail) {
                  setSearchResults((prev) => prev.map((e) => e === ext ? { ...e, author: detail.author || e.author, license: detail.license || e.license, url: detail.url || e.url || '', repository: detail.repository || '' } : e))
                }
              }).catch(() => {})))
            }
            if (list.length === 0) setMessage({ kind: 'error', text: t('noMatches') })
          } else {
            setMessage({ kind: 'error', text: errorText(res, t('searchFailed')) })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: t('callFailed') + ': ' + String((e && e.message) || e) })
        }
        setBusy('')
      }

      /** 一步导入:下载 VSIX → 解压(带版本缓存)→ 解析全部主题(include 已合并)→ 聚合导入并应用。 */
      const importExt = async (ext) => {
        setBusy('import-' + ext.name)
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'install-open-vsx', {
            namespace: ext.namespace,
            name: ext.name,
            downloadUrl: ext.downloadUrl,
            version: ext.version,
          })
          if (res && res.ok) {
            const value = res.value || {}
            const themes = value.themes || []
            if (themes.length === 0) {
              setMessage({ kind: 'error', text: t('noColorThemes', { name: value.extension }) })
            } else {
              const summary = importBatchThemes(
                themes.map((th) => ({ text: th.text, label: th.label })),
                { id: 'ovx-' + ext.namespace + '.' + ext.name, label: ext.displayName }
              )
              setMessage({ kind: 'ok', text: summary })
            }
          } else {
            setMessage({ kind: 'error', text: errorText(res, t('importFailed')) })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      // ---- 渲染 ----

      const openLink = (url) => {
        if (!url) return
        try { window.open(url, '_blank', 'noopener') } catch { /* ignore */ }
      }

      /** 打开编辑器:直接编辑传入的主题(内置主题无修改入口,仅自定义主题可编辑)。 */
      const openEditor = (palette) => {
        editSnapshot.current = {
          light: { ...palette.light },
          dark: { ...palette.dark },
          lightVariants: palette.lightVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } })),
          darkVariants: palette.darkVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } })),
        }
        setEditing(palette)
        setEditMode('light')
        applyPalette(palette)
      }

      /** 复制主题(内置主题的快速复制入口):深拷贝为新自定义主题并进入编辑器。 */
      const copyTheme = (palette) => {
        const base = 'vsc-' + slugify(palette.label + '-copy')
        let id = base
        let n = 2
        while (store.custom.some((p) => p.id === id)) id = base + '-' + n++
        const copy = {
          id,
          label: palette.label + ' 副本',
          imported: true,
          light: { ...palette.light },
          dark: { ...palette.dark },
          lightVariants: palette.lightVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } })),
          darkVariants: palette.darkVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } })),
        }
        store.custom.push(copy)
        // 复制是显式添加:允许持久化(与 pushImportedPalette 同策略)
        store.loaded = true
        store.hadCustom = true
        editSnapshot.current = {
          light: { ...copy.light },
          dark: { ...copy.dark },
          lightVariants: copy.lightVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } })),
          darkVariants: copy.darkVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } })),
        }
        setEditing(copy)
        setEditMode('light')
        applyPalette(copy)
      }

      const setToken = (palette, mode, token, value) => {
        if (typeof value !== 'string' || value === '') return
        palette[mode][token] = value
        applyLayers()
        persist()
      }

      /** 二级页面:颜色详细参数编辑器(明暗切换 + 分组颜色字段,修改即时生效)。 */
      const renamePalette = (palette, value) => {
        palette.label = value
        store.emit()
        persist()
      }

      /** 重置修改:恢复进入编辑器时该主题全部颜色的初始值。 */
      const resetEdits = (palette) => {
        const snap = editSnapshot.current
        if (!snap) return
        palette.light = { ...snap.light }
        palette.dark = { ...snap.dark }
        palette.lightVariants = snap.lightVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } }))
        palette.darkVariants = snap.darkVariants.map((v) => ({ label: v.label, tokens: { ...v.tokens } }))
        applyLayers()
        persist()
      }

      const renderEditor = (palette) => React.createElement('div', { className: 'dsth-page' },
        React.createElement('div', { className: 'dsth-editor-head' },
          React.createElement('button', { className: 'dsth-btn', onClick: () => setEditing(null) }, t('back')),
          React.createElement('input', {
            className: 'dsth-input dsth-edit-name',
            value: palette.label,
            title: t('editNameTitle'),
            onChange: (e) => renamePalette(palette, e.target.value),
          }),
          ['light', 'dark'].map((m) => React.createElement('button', {
            key: m,
            className: 'dsth-modechip' + (editMode === m ? ' dsth-modechip-active' : ''),
            onClick: () => setEditMode(m),
          }, modeLabel(m))),
          React.createElement('button', {
            className: 'dsth-btn',
            title: t('resetTitle'),
            onClick: () => resetEdits(palette),
          }, t('resetEdits'))
        ),
        EDITOR_GROUPS.map((group) => React.createElement('div', { key: group.id, className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, t(group.titleKey)),
          group.tokens.map(([token, labelKey]) => {
            const value = palette[editMode][token] || ''
            const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
            return React.createElement('div', { key: token, className: 'dsth-editrow' },
              React.createElement('span', { className: 'dsth-editlabel' }, t(labelKey)),
              React.createElement('span', { className: 'dsth-editval' }, token),
              React.createElement('input', {
                type: 'color',
                className: 'dsth-editcolor',
                value: hex,
                onChange: (e) => setToken(palette, editMode, token, e.target.value),
              }),
              React.createElement('input', {
                className: 'dsth-input dsth-edithex',
                value: value,
                onChange: (e) => setToken(palette, editMode, token, e.target.value),
              })
            )
          })
        ))
      )

      const renderCard = (palette, extra) => {
        const lightActive = ownerOf('light').id === palette.id
        const darkActive = ownerOf('dark').id === palette.id
        const badge = lightActive && darkActive
          ? t('badge.active')
          : lightActive ? t('badge.light')
          : darkActive ? t('badge.dark')
          : null
        return React.createElement('div', {
          key: palette.id,
          className: 'dsth-card' + (badge ? ' dsth-selected' : ''),
        },
          React.createElement('div', { className: 'dsth-card-name', onClick: () => applyPalette(palette), title: t('applyTitle') },
            React.createElement('span', { className: 'dsth-card-label', title: plabel(palette.label) }, plabel(palette.label)),
            badge ? React.createElement('span', { className: 'dsth-badge' }, badge) : null,
            extra || null
          ),
          renderVariantRow(palette, 'light', palette.lightVariants),
          renderVariantRow(palette, 'dark', palette.darkVariants)
        )
      }

      const renderVariantRow = (palette, mode, variants) =>
        React.createElement(VariantRow, { key: mode, palette, mode, variants, active: ownerOf(mode).id === palette.id })

      const renderEditButton = (p) => React.createElement('button', { className: 'dsth-btn dsth-edit-btn', onClick: () => openEditor(p) }, t('edit'))
      const renderCopyButton = (p) => React.createElement('button', { className: 'dsth-btn dsth-edit-btn', onClick: () => copyTheme(p) }, t('copy'))

      const renderCustomGrid = store.custom.length > 0
        ? React.createElement('div', { className: 'dsth-grid' },
            store.custom.map((p) => renderCard(p,
              React.createElement('div', { className: 'dsth-actions' },
                renderEditButton(p),
                React.createElement('button', { className: 'dsth-del', onClick: () => removeCustom(p.id) }, t('delete'))
              )
            ))
          )
        : null

      const scanList = scanResults && scanResults.length > 0
        ? React.createElement('div', { className: 'dsth-list' },
            scanResults.map((entry) => React.createElement('div', { key: entry.path, className: 'dsth-listitem' },
              React.createElement('div', { className: 'dsth-listitem-main' },
                React.createElement('span', { className: 'dsth-listitem-name' }, entry.label + ' · ' + entry.extension),
                React.createElement('span', { className: 'dsth-listitem-path' }, entry.path)
              ),
              React.createElement('button', {
                className: 'dsth-btn',
                disabled: busy === entry.path,
                onClick: () => importLocal(entry),
              }, busy === entry.path ? t('importing') : t('import'))
            ))
          )
        : null

      if (editing) return renderEditor(editing)
      return React.createElement('div', { className: 'dsth-page' },
        React.createElement('div', { className: 'dsth-title' }, t('sectionLabel')),
        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, t('appearanceTitle')),
          React.createElement('div', { className: 'dsth-moderow' },
            ['system', 'light', 'dark'].map((m) => React.createElement('button', {
              key: m,
              className: 'dsth-modechip' + (preference === m ? ' dsth-modechip-active' : ''),
              onClick: () => theme.setTheme(m),
            }, modeLabel(m))),
            React.createElement('button', {
              className: 'dsth-btn',
              onClick: () => { clearAll(); theme.setTheme('system') },
            }, t('restoreDefault'))
          )
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, t('searchTitle')),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('input', {
              className: 'dsth-input',
              placeholder: t('searchPlaceholder'),
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
            }),
            React.createElement('button', { className: 'dsth-btn', disabled: busy !== '', onClick: runSearch },
              busy === 'search' ? t('searching') : t('search')
            )
          ),
          searchResults && searchResults.length > 0
            ? React.createElement('div', { className: 'dsth-list' },
                searchResults.map((ext) => {
                  const detailUrl = ext.url || 'https://open-vsx.org/extension/' + ext.namespace + '/' + ext.name
                  const meta = [
                    t('author', { name: ext.author }),
                    ext.license ? ext.license : '',
                    'v' + ext.version,
                    t('downloads', { n: fmtCount(ext.downloadCount) }),
                    fmtRating(ext.rating, ext.reviewCount),
                    ext.timestamp ? t('updated', { date: fmtDate(ext.timestamp) }) : '',
                  ].filter(Boolean).join(' · ')
                  return React.createElement('div', {
                    key: ext.namespace + '.' + ext.name,
                    className: 'dsth-listitem dsth-searchitem',
                  },
                    ext.icon
                      ? React.createElement('img', {
                          className: 'dsth-ext-icon dsth-ext-click',
                          src: ext.icon,
                          alt: '',
                          title: t('openDetail'),
                          onClick: () => openLink(detailUrl),
                          onError: (e) => { e.target.style.display = 'none' },
                        })
                      : null,
                    React.createElement('div', { className: 'dsth-listitem-main' },
                      React.createElement('span', {
                        className: 'dsth-listitem-name dsth-ext-click',
                        title: t('openDetail'),
                        onClick: () => openLink(detailUrl),
                      }, ext.displayName + ' · ' + ext.namespace + '.' + ext.name),
                      ext.description
                        ? React.createElement('span', { className: 'dsth-ext-desc' },
                            ext.description.slice(0, 160) + (ext.description.length > 160 ? '…' : '')
                          )
                        : null,
                      React.createElement('span', { className: 'dsth-listitem-path' }, meta),
                      React.createElement('div', { className: 'dsth-ext-links' },
                        React.createElement('button', { className: 'dsth-tip-link', onClick: () => openLink(detailUrl) }, t('extDetail')),
                        ext.repository
                          ? React.createElement('button', { className: 'dsth-tip-link', onClick: () => openLink(ext.repository) }, t('extHome'))
                          : null
                      )
                    ),
                  React.createElement('button', {
                    className: 'dsth-btn',
                    disabled: busy !== '',
                    onClick: () => importExt(ext),
                  }, busy === 'import-' + ext.name ? t('importing') : t('import'))
                  )
                })
              )
            : null
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, t('builtinTitle')),
          React.createElement('div', { className: 'dsth-grid' }, PALETTES.map((p) => renderCard(p, renderCopyButton(p))))
        ),

        store.custom.length > 0
          ? React.createElement('div', { className: 'dsth-section' },
              React.createElement('div', { className: 'dsth-section-title' }, t('customTitle')),
              renderCustomGrid
            )
          : null,

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, t('scanTitle')),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('input', {
              className: 'dsth-input',
              placeholder: t('scanPlaceholder'),
              value: scanRoot,
              onChange: (e) => setScanRoot(e.target.value),
            }),
            React.createElement('button', { className: 'dsth-btn', disabled: busy === 'scan', onClick: runScan },
              busy === 'scan' ? t('scanning') : t('scan')
            )
          ),
          scanList,
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('input', {
              className: 'dsth-input',
              placeholder: t('urlPlaceholder'),
              value: url,
              onChange: (e) => setUrl(e.target.value),
            }),
            React.createElement('button', { className: 'dsth-btn', disabled: busy === 'url', onClick: fetchUrl },
              busy === 'url' ? t('fetching') : t('fetch')
            )
          ),
          React.createElement('textarea', {
            className: 'dsth-textarea',
            placeholder: t('pastePlaceholder'),
            value: pasteText,
            onChange: (e) => setPasteText(e.target.value),
          }),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('button', { className: 'dsth-btn', onClick: pasteImport }, t('parse')),
            React.createElement('span', { className: 'dsth-sub' }, t('importHint'))
          )
        ),

        message ? React.createElement('div', { className: 'dsth-msg dsth-msg-' + message.kind }, message.text) : null,

        React.createElement('div', { className: 'dsth-foot' },
          React.createElement('span', { className: 'dsth-note' }, t('footNote'))
        )
      )
    }

    slots.inject('settings.section', () => slots.register(
      // label 使用 thunk:设置面板每次投影时重读,语言切换后导航文案即时跟随
      { name: 'settings.section', id: 'dsh-themes', order: 12, label: () => t('sectionLabel') },
      () => React.createElement(ThemesPage)
    ))

    // 从持久化存储恢复主题库(异步;完成后自动应用覆盖层并触发重渲染)
    hydrate()
    })
  },
}
