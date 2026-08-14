// DSH 主题 (dsh-themes) — Client 入口
// 本文件由 VitePlus(vp pack)打包为 IIFE 并包装成 __ModuleLoader__ factory。
// 以 profile bundle(静态插件)方式挂载:通过注入的 theme / slots / connection
// 服务工作;与 Host 半区的 RPC 通过 connection.rpc.call('/dsh-themes', ...) 配对。
// 调色板引擎(语义角色映射、双种子生成、对比度求解)与 VS Code 导入映射的
// 架构灵感来自 t3code(https://github.com/pingdotgg/t3code),详见仓库 README。
import { DEFAULT_THEME, TOKEN_NAMES, PALETTES, DEFAULT_PALETTE, CORE_TOKEN_NAMES } from './palette.js'
import { humanizeName, parseVsCodeTheme, slugify } from './vs-import.js'
import { STYLES_CSS } from './styles.js'
export const PLUGIN_NAME = 'dsh-themes'
export default {
  apply(ctx) {
    // 等待核心服务就绪后再挂载(而非 apply 时提前 return:静态 kernel 中
    // 过早 apply 会导致插件永久失效)。React 由安装脚本在 factory 顶层
    // 注入 `const React = require('react')`(__ModuleLoader__ seed word)。
    ctx.inject(['theme', 'slots', 'connection'], (scope) => {
    const theme = scope.theme
    const slots = scope.slots
    const connection = scope.connection

    /** connection RPC 失败时 error 为 { code, message, details } 信封,这里兼容字符串并取 message。 */
    function errorText(res, fallback) {
      const err = res && res.error
      if (typeof err === 'string') return err || fallback
      return (err && err.message) || fallback
    }

    // ============================================================
    // 颜色工具:RGB/HSL 混合 + WCAG 对比度求解
    // (受 t3code 主题引擎启发)
    // ============================================================

    const store = {
      current: null,
      mixed: { light: null, dark: null },
      custom: [],
      loaded: false,
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
      if (store.mixed.light === id) store.mixed.light = null
      if (store.mixed.dark === id) store.mixed.dark = null
      applyLayers()
      persist()
    }

    function isValidPalette(p) {
      return !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.label === 'string' &&
        p.light && typeof p.light === 'object' && p.dark && typeof p.dark === 'object' &&
        CORE_TOKEN_NAMES.every((t) => typeof p.light[t] === 'string' && typeof p.dark[t] === 'string')
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
      try {
        const res = await connection.rpc.call('/dsh-themes', 'load-themes', {})
        const d = res && res.ok ? res.value : null
        if (d) {
          if (Array.isArray(d.custom)) store.custom = d.custom.filter((p) => isValidPalette(p)).map((p) => fillPalette(p))
          // half 模型:优先恢复 mixed;旧版 current 转成双侧同值
          if (d.mixed && typeof d.mixed === 'object') {
            if (typeof d.mixed.light === 'string' && paletteById(d.mixed.light)) store.mixed.light = d.mixed.light
            if (typeof d.mixed.dark === 'string' && paletteById(d.mixed.dark)) store.mixed.dark = d.mixed.dark
          } else if (typeof d.current === 'string' && paletteById(d.current)) {
            store.mixed.light = d.current
            store.mixed.dark = d.current
          }
        }
      } catch { /* 持久化不可用时静默降级为会话内状态 */ }
      store.loaded = true
      applyLayers()
      store.emit()
    }

    /** 解析单个 VS Code 主题文件为导入条目(不写入库)。 */
    function buildImportedEntry(text, sourceName) {
      let raw
      try { raw = JSON.parse(text) } catch (e) { throw new Error('JSON 解析失败:' + ((e && e.message) || String(e))) }
      const tokens = parseVsCodeTheme(raw)
      let label = ''
      for (const cand of [raw.displayName, raw.name]) {
        if (typeof cand !== 'string') continue
        const h = humanizeName(cand)
        if (h.length > 0) { label = h; break }
      }
      if (!label && sourceName) label = humanizeName(String(sourceName).replace(/\.json$/i, '').replace(/[#?].*$/, ''))
      label = (label || 'VS Code 主题').slice(0, 40)
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
      if (entries.length === 0) throw new Error('没有可导入的主题文件')
      const lights = entries.filter((e) => e.appearance === 'light')
      const darks = entries.filter((e) => e.appearance === 'dark')
      if (lights.length === 0 && darks.length === 0) throw new Error('没有可导入的主题文件')
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
      return '已导入「' + palette.label + '」:明色 ' + lights.length + ' 个变体,暗色 ' + darks.length + ' 个变体'
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
      styleEl.textContent = STYLES_CSS
      document.head.appendChild(styleEl)
      return () => {
        if (layerDisposer) { try { layerDisposer() } catch { /* ignore */ } layerDisposer = null }
        styleEl.remove()
      }
    })

    // ---- 设置页 ----

    const SWATCH_TOKENS = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-2', '--dsw-alias-brand-primary', '--dsw-alias-state-business-primary', '--dsw-alias-label-primary', '--dsw-specific-sidebar-fill']
    const MODE_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' }

    /** 颜色详细参数编辑器(参照 t3code ThemeEditorPanel 的分组结构):按语义分组列出 token。 */
    const EDITOR_GROUPS = [
      { id: 'main', title: '主要颜色', tokens: [
        ['--dsw-alias-bg-base', '画布背景'],
        ['--dsw-alias-bg-layer-2', '表面'],
        ['--dsw-alias-bg-overlay', '浮层'],
        ['--dsw-alias-border-l1', '边框'],
        ['--dsw-alias-label-primary', '文字主色'],
        ['--dsw-alias-label-secondary', '文字次级'],
        ['--dsw-specific-sidebar-fill', '侧栏'],
        ['--dsw-alias-brand-primary', '品牌主色'],
        ['--dsw-alias-button-info-fill', '操作按钮'],
        ['--dsw-alias-state-business-primary', '业务主色'],
      ] },
      { id: 'status', title: '状态颜色', tokens: [
        ['--dsw-alias-state-error-primary', '错误'],
        ['--dsw-alias-state-warn-primary', '警告'],
        ['--dsw-alias-state-success-primary', '成功'],
        ['--dsw-static-deepseek-450', '运行中动画'],
      ] },
      { id: 'other', title: '其他', tokens: [
        ['--dsw-specific-bubble', '气泡'],
        ['--dsw-specific-bubble-highlight', '气泡高亮'],
        ['--dsw-specific-sidebar-nav-item-active', '侧栏选中'],
        ['--dsw-static-deepseek-500', '品牌深色'],
        ['--dsw-static-deepseek-200', '品牌浅色'],
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
        React.createElement('span', { className: 'dsth-vlabel' }, MODE_LABELS[mode]),
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
              title: v.label,
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
      const preference = snapshot.preference

      const runScan = async () => {
        setBusy('scan')
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'scan-vscode-themes', { root: scanRoot })
          if (res && res.ok) {
            const value = res.value || {}
            setScanResults(value.themes || [])
            if ((value.themes || []).length === 0) setMessage({ kind: 'error', text: '未找到主题文件(扫描了 ' + value.roots + ' 个候选目录)' })
          } else {
            setMessage({ kind: 'error', text: errorText(res, '扫描失败') })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: '调用失败:' + String((e && e.message) || e) })
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
            setMessage({ kind: 'error', text: errorText(res, '读取失败') })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      const fetchUrl = async () => {
        if (!url.trim()) { setMessage({ kind: 'error', text: '请输入主题 JSON 的 URL' }); return }
        setBusy('url')
        setMessage(null)
        try {
          const res = await connection.rpc.call('/dsh-themes', 'fetch-theme-url', { url: url.trim() })
          if (res && res.ok) {
            doImport(res.value.text, url.trim().split('/').pop() || 'remote')
            setUrl('')
          } else {
            setMessage({ kind: 'error', text: errorText(res, '获取失败') })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      const pasteImport = () => {
        if (!pasteText.trim()) { setMessage({ kind: 'error', text: '请先粘贴主题 JSON' }); return }
        doImport(pasteText, '粘贴的主题')
      }

      const doImport = (text, sourceName) => {
        try {
          const palette = importVsCodeTheme(text, sourceName)
          setMessage({ kind: 'ok', text: '已导入并应用:' + palette.label })
        } catch (e) {
          setMessage({ kind: 'error', text: '导入失败:' + String((e && e.message) || e) })
        }
      }

      // ---- Open VSX 搜索安装 ----

      const fmtCount = (n) => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n)

      const fmtDate = (iso) => {
        if (!iso) return ''
        const d = new Date(iso)
        if (isNaN(d.getTime())) return ''
        const days = Math.floor((Date.now() - d.getTime()) / 86400000)
        if (days <= 0) return '今天'
        if (days === 1) return '昨天'
        if (days < 30) return days + ' 天前'
        const p = (n) => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      }

      const fmtRating = (r, count) => r > 0 ? '★ ' + r.toFixed(1) + (count > 0 ? ' (' + count + ')' : '') : ''

      const runSearch = async () => {
        if (!searchQuery.trim()) { setMessage({ kind: 'error', text: '请输入搜索关键词' }); return }
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
            if (list.length === 0) setMessage({ kind: 'error', text: '没有找到匹配的主题扩展' })
          } else {
            setMessage({ kind: 'error', text: errorText(res, '搜索失败') })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: '调用失败:' + String((e && e.message) || e) })
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
              setMessage({ kind: 'error', text: '「' + value.extension + '」未贡献颜色主题' })
            } else {
              const summary = importBatchThemes(
                themes.map((t) => ({ text: t.text, label: t.label })),
                { id: 'ovx-' + ext.namespace + '.' + ext.name, label: ext.displayName }
              )
              setMessage({ kind: 'ok', text: summary })
            }
          } else {
            setMessage({ kind: 'error', text: errorText(res, '导入失败') })
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
          React.createElement('button', { className: 'dsth-btn', onClick: () => setEditing(null) }, '← 返回'),
          React.createElement('input', {
            className: 'dsth-input dsth-edit-name',
            value: palette.label,
            title: '主题名称(导入/复制主题可修改,内置主题仅副本可改)',
            onChange: (e) => renamePalette(palette, e.target.value),
          }),
          ['light', 'dark'].map((m) => React.createElement('button', {
            key: m,
            className: 'dsth-modechip' + (editMode === m ? ' dsth-modechip-active' : ''),
            onClick: () => setEditMode(m),
          }, MODE_LABELS[m])),
          React.createElement('button', {
            className: 'dsth-btn',
            title: '恢复该主题全部颜色的初始值',
            onClick: () => resetEdits(palette),
          }, '重置修改')
        ),
        EDITOR_GROUPS.map((group) => React.createElement('div', { key: group.id, className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, group.title),
          group.tokens.map(([token, label]) => {
            const value = palette[editMode][token] || ''
            const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
            return React.createElement('div', { key: token, className: 'dsth-editrow' },
              React.createElement('span', { className: 'dsth-editlabel' }, label),
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
          ? '使用中'
          : lightActive ? '浅色'
          : darkActive ? '暗色'
          : null
        return React.createElement('div', {
          key: palette.id,
          className: 'dsth-card' + (badge ? ' dsth-selected' : ''),
        },
          React.createElement('div', { className: 'dsth-card-name', onClick: () => applyPalette(palette), title: '应用主题(保持当前外观模式)' },
            React.createElement('span', { className: 'dsth-card-label', title: palette.label }, palette.label),
            badge ? React.createElement('span', { className: 'dsth-badge' }, badge) : null,
            extra || null
          ),
          renderVariantRow(palette, 'light', palette.lightVariants),
          renderVariantRow(palette, 'dark', palette.darkVariants)
        )
      }

      const renderVariantRow = (palette, mode, variants) =>
        React.createElement(VariantRow, { key: mode, palette, mode, variants, active: ownerOf(mode).id === palette.id })

      const renderEditButton = (p) => React.createElement('button', { className: 'dsth-btn dsth-edit-btn', onClick: () => openEditor(p) }, '修改')
      const renderCopyButton = (p) => React.createElement('button', { className: 'dsth-btn dsth-edit-btn', onClick: () => copyTheme(p) }, '复制')

      const renderCustomGrid = store.custom.length > 0
        ? React.createElement('div', { className: 'dsth-grid' },
            store.custom.map((p) => renderCard(p,
              React.createElement('div', { className: 'dsth-actions' },
                renderEditButton(p),
                React.createElement('button', { className: 'dsth-del', onClick: () => removeCustom(p.id) }, '删除')
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
              }, busy === entry.path ? '导入中…' : '导入')
            ))
          )
        : null

      if (editing) return renderEditor(editing)
      return React.createElement('div', { className: 'dsth-page' },
        React.createElement('div', { className: 'dsth-title' }, '主题'),
        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '外观模式'),
          React.createElement('div', { className: 'dsth-moderow' },
            ['system', 'light', 'dark'].map((m) => React.createElement('button', {
              key: m,
              className: 'dsth-modechip' + (preference === m ? ' dsth-modechip-active' : ''),
              onClick: () => theme.setTheme(m),
            }, MODE_LABELS[m])),
            React.createElement('button', {
              className: 'dsth-btn',
              onClick: () => { clearAll(); theme.setTheme('system') },
            }, '恢复默认主题')
          )
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '搜索安装(Open VSX)'),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('input', {
              className: 'dsth-input',
              placeholder: '搜索主题扩展,如 dracula、one dark…',
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
            }),
            React.createElement('button', { className: 'dsth-btn', disabled: busy !== '', onClick: runSearch },
              busy === 'search' ? '搜索中…' : '搜索'
            )
          ),
          searchResults && searchResults.length > 0
            ? React.createElement('div', { className: 'dsth-list' },
                searchResults.map((ext) => {
                  const detailUrl = ext.url || 'https://open-vsx.org/extension/' + ext.namespace + '/' + ext.name
                  const meta = [
                    '作者 ' + ext.author,
                    ext.license ? ext.license : '',
                    'v' + ext.version,
                    fmtCount(ext.downloadCount) + ' 次下载',
                    fmtRating(ext.rating, ext.reviewCount),
                    ext.timestamp ? '更新 ' + fmtDate(ext.timestamp) : '',
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
                          title: '打开扩展详情',
                          onClick: () => openLink(detailUrl),
                          onError: (e) => { e.target.style.display = 'none' },
                        })
                      : null,
                    React.createElement('div', { className: 'dsth-listitem-main' },
                      React.createElement('span', {
                        className: 'dsth-listitem-name dsth-ext-click',
                        title: '打开扩展详情',
                        onClick: () => openLink(detailUrl),
                      }, ext.displayName + ' · ' + ext.namespace + '.' + ext.name),
                      ext.description
                        ? React.createElement('span', { className: 'dsth-ext-desc' },
                            ext.description.slice(0, 160) + (ext.description.length > 160 ? '…' : '')
                          )
                        : null,
                      React.createElement('span', { className: 'dsth-listitem-path' }, meta),
                      React.createElement('div', { className: 'dsth-ext-links' },
                        React.createElement('button', { className: 'dsth-tip-link', onClick: () => openLink(detailUrl) }, '扩展详情'),
                        ext.repository
                          ? React.createElement('button', { className: 'dsth-tip-link', onClick: () => openLink(ext.repository) }, '主页/仓库')
                          : null
                      )
                    ),
                  React.createElement('button', {
                    className: 'dsth-btn',
                    disabled: busy !== '',
                    onClick: () => importExt(ext),
                  }, busy === 'import-' + ext.name ? '导入中…' : '导入')
                  )
                })
              )
            : null
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '内置调色板'),
          React.createElement('div', { className: 'dsth-grid' }, PALETTES.map((p) => renderCard(p, renderCopyButton(p))))
        ),

        store.custom.length > 0
          ? React.createElement('div', { className: 'dsth-section' },
              React.createElement('div', { className: 'dsth-section-title' }, '导入的主题'),
              renderCustomGrid
            )
          : null,

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '从 VS Code 导入'),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('input', {
              className: 'dsth-input',
              placeholder: '扩展目录(可选,默认 ~/.vscode/extensions 等)',
              value: scanRoot,
              onChange: (e) => setScanRoot(e.target.value),
            }),
            React.createElement('button', { className: 'dsth-btn', disabled: busy === 'scan', onClick: runScan },
              busy === 'scan' ? '扫描中…' : '扫描本地扩展'
            )
          ),
          scanList,
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('input', {
              className: 'dsth-input',
              placeholder: '主题 JSON 的 URL(如 GitHub raw)',
              value: url,
              onChange: (e) => setUrl(e.target.value),
            }),
            React.createElement('button', { className: 'dsth-btn', disabled: busy === 'url', onClick: fetchUrl },
              busy === 'url' ? '获取中…' : '获取并导入'
            )
          ),
          React.createElement('textarea', {
            className: 'dsth-textarea',
            placeholder: '或直接粘贴 *-color-theme.json 内容…',
            value: pasteText,
            onChange: (e) => setPasteText(e.target.value),
          }),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('button', { className: 'dsth-btn', onClick: pasteImport }, '解析并导入'),
            React.createElement('span', { className: 'dsth-sub' }, '提示:VS Code 扩展主题位于 ~/.vscode/extensions/<发布者>.<名称>/themes/ 下')
          )
        ),

        message ? React.createElement('div', { className: 'dsth-msg dsth-msg-' + message.kind }, message.text) : null,

        React.createElement('div', { className: 'dsth-foot' },
          React.createElement('span', { className: 'dsth-note' }, '调色板与导入主题为运行时状态,停止插件后自动恢复默认外观。')
        )
      )
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'dsh-themes', order: 12, label: '主题' },
      () => React.createElement(ThemesPage)
    ))

    // 从持久化存储恢复主题库(异步;完成后自动应用覆盖层并触发重渲染)
    hydrate()
    })
  },
}
