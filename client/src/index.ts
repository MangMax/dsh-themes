// DSH 主题 (dsh-themes) — Client 入口
// 本文件由 VitePlus(vp pack)打包为 IIFE 并包装成插件函数体。
// 调色板引擎(语义角色映射、双种子生成、对比度求解)与 VS Code 导入映射的
// 架构灵感来自 t3code(https://github.com/pingdotgg/t3code),详见仓库 README。
import { DEFAULT_THEME, TOKEN_NAMES, PALETTES, DEFAULT_PALETTE, CORE_TOKEN_NAMES } from './palette.js'
import { humanizeName, parseVsCodeTheme, slugify } from './vs-import.js'
import { STYLES_CSS } from './styles.js'
export const PLUGIN_NAME = 'dsh-themes'
export default {
  apply(ctx) {
    const theme = ctx.get('theme')
    if (theme === undefined) return
    const slots = ctx.get('slots')
    if (slots === undefined) return

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
      host.call('persist-themes', {
        payload: { current: store.current, mixed: store.mixed, custom: store.custom },
      }).catch(() => {})
    }

    /** 统一应用覆盖层:明暗混合优先,其次当前调色板,否则清除。 */
    function applyLayers() {
      const hasMixed = !!(store.mixed.light || store.mixed.dark)
      if (hasMixed) {
        const lightPalette = paletteById(store.mixed.light)
        const darkPalette = paletteById(store.mixed.dark)
        const pairs = {}
        for (const name of TOKEN_NAMES) {
          pairs[name] = {
            light: lightPalette ? lightPalette.light[name] : DEFAULT_PALETTE.light[name],
            dark: darkPalette ? darkPalette.dark[name] : DEFAULT_PALETTE.dark[name],
          }
        }
        layerDisposer = theme.overrideTokens('dsh-themes', pairs)
      } else if (store.current) {
        const palette = paletteById(store.current)
        if (!palette) {
          store.current = null
          store.emit()
          return
        }
        const pairs = {}
        for (const name of TOKEN_NAMES) pairs[name] = { light: palette.light[name], dark: palette.dark[name] }
        layerDisposer = theme.overrideTokens('dsh-themes', pairs)
      } else {
        if (layerDisposer) { layerDisposer(); layerDisposer = null }
      }
      store.emit()
    }

    function applyPalette(palette) {
      store.current = palette ? palette.id : null
      applyLayers()
      persist()
    }

    function removeCustom(id) {
      store.custom = store.custom.filter((p) => p.id !== id)
      if (store.current === id) store.current = 'dsh-default'
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
        const res = await host.call('load-themes', {})
        if (res && res.ok && res.data) {
          const d = res.data
          if (Array.isArray(d.custom)) store.custom = d.custom.filter((p) => isValidPalette(p)).map((p) => fillPalette(p))
          if (typeof d.current === 'string' && paletteById(d.current)) store.current = d.current
          // 旧版的显式明暗混合(mixed)不再恢复:明暗变体选择已内置到主题卡片
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
      if (mode === 'light') palette.light = variant.tokens
      else palette.dark = variant.tokens
      if (store.current !== palette.id) store.current = palette.id
      applyLayers()
      persist()
      theme.setTheme(mode)
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
      const disposeCss = styles.insert(STYLES_CSS)
      return () => {
        if (layerDisposer) { try { layerDisposer() } catch { /* ignore */ } layerDisposer = null }
        disposeCss()
      }
    })

    // ---- 设置页 ----

    const SWATCH_TOKENS = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-2', '--dsw-alias-brand-primary', '--dsw-alias-state-business-primary', '--dsw-alias-label-primary', '--dsw-specific-sidebar-fill']
    const MODE_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' }

    /** 明暗槽变体选择器:融合色球列表,选中放大,溢出时显示左右导航箭头,悬停显示变体名。 */
    function VariantRow({ palette, mode, variants }) {
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
              className: 'dsth-ball' + (i === activeIdx ? ' dsth-ball-active' : '') + (dark ? ' dsth-ball-dark' : ''),
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
      React.useEffect(() => ctx.on('theme/change', (next) => setSnapshot(next)), [])
      React.useEffect(() => store.subscribe(() => setTick((n) => n + 1)), [])
      const preference = snapshot.preference

      const runScan = async () => {
        setBusy('scan')
        setMessage(null)
        try {
          const res = await host.call('scan-vscode-themes', { root: scanRoot })
          if (res && res.ok) {
            setScanResults(res.themes || [])
            if ((res.themes || []).length === 0) setMessage({ kind: 'error', text: '未找到主题文件(扫描了 ' + res.roots + ' 个候选目录)' })
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '扫描失败' })
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
          const res = await host.call('read-theme-file', { path: entry.path })
          if (res && res.ok) {
            doImport(res.text, entry.label)
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '读取失败' })
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
          const res = await host.call('fetch-theme-url', { url: url.trim() })
          if (res && res.ok) {
            doImport(res.text, url.trim().split('/').pop() || 'remote')
            setUrl('')
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '获取失败' })
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
          const res = await host.call('search-open-vsx', { query: searchQuery.trim() })
          if (res && res.ok) {
            const list = res.list || []
            setSearchResults(list)
            // 作者/许可证需详情接口,后台异步补充,不阻塞搜索展示
            if (list.length > 0) {
              Promise.all(list.map((ext) => host.call('open-vsx-detail', { namespace: ext.namespace, name: ext.name }).then((d) => {
                if (d && d.ok) {
                  setSearchResults((prev) => prev.map((e) => e === ext ? { ...e, author: d.author || e.author, license: d.license || e.license, url: d.url || e.url || '', repository: d.repository || '' } : e))
                }
              }).catch(() => {})))
            }
            if (list.length === 0) setMessage({ kind: 'error', text: '没有找到匹配的主题扩展' })
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '搜索失败' })
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
          const res = await host.call('install-open-vsx', {
            namespace: ext.namespace,
            name: ext.name,
            downloadUrl: ext.downloadUrl,
            version: ext.version,
          })
          if (res && res.ok) {
            const themes = res.themes || []
            if (themes.length === 0) {
              setMessage({ kind: 'error', text: '「' + res.extension + '」未贡献颜色主题' })
            } else {
              const summary = importBatchThemes(
                themes.map((t) => ({ text: t.text, label: t.label })),
                { id: 'ovx-' + ext.namespace + '.' + ext.name, label: ext.displayName }
              )
              setMessage({ kind: 'ok', text: summary })
            }
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '导入失败' })
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

      const paletteBadge = (palette) => {
        if (store.current === palette.id) return '使用中'
        return null
      }

      const renderCard = (palette, extra) => {
        const badge = paletteBadge(palette)
        return React.createElement('div', {
          key: palette.id,
          className: 'dsth-card' + (badge ? ' dsth-selected' : ''),
        },
          React.createElement('div', { className: 'dsth-card-name', onClick: () => applyPalette(palette), title: '应用主题(保持当前外观模式)' },
            palette.label,
            badge ? React.createElement('span', { className: 'dsth-badge' }, badge) : null,
            extra || null
          ),
          renderVariantRow(palette, 'light', palette.lightVariants),
          renderVariantRow(palette, 'dark', palette.darkVariants)
        )
      }

      const renderVariantRow = (palette, mode, variants) =>
        React.createElement(VariantRow, { key: mode, palette, mode, variants })

      const renderCustomGrid = store.custom.length > 0
        ? React.createElement('div', { className: 'dsth-grid' },
            store.custom.map((p) => renderCard(p,
              React.createElement('button', { className: 'dsth-del', onClick: () => removeCustom(p.id) }, '删除')
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

      return React.createElement('div', { className: 'dsth-page' },
        React.createElement('div', { className: 'dsth-title' }, '主题'),
        React.createElement('p', { className: 'dsth-sub' },
          '内置主题 × 明/暗变体,支持跟随系统;可从 Open VSX 搜索安装、VS Code 扩展、URL 或粘贴 JSON 导入主题。'
        ),

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
              onClick: () => { applyPalette(DEFAULT_THEME); theme.setTheme('system') },
            }, '恢复默认主题')
          )
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '内置调色板'),
          React.createElement('div', { className: 'dsth-grid' }, PALETTES.map((p) => renderCard(p, null)))
        ),

        store.custom.length > 0
          ? React.createElement('div', { className: 'dsth-section' },
              React.createElement('div', { className: 'dsth-section-title' }, '导入的主题'),
              renderCustomGrid
            )
          : null,

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
          React.createElement('div', { className: 'dsth-sub' }, '点击「导入」一步完成下载、解析与聚合导入;重复导入走缓存,秒开。'),
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
      { name: 'settings.section', id: 'dsh-themes', order: 12, label: '🎨 主题' },
      () => React.createElement(ThemesPage)
    ))

    // 从持久化存储恢复主题库(异步;完成后自动应用覆盖层并触发重渲染)
    hydrate()
  },
}
