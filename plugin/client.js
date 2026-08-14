// DSH 主题 (dsh-themes) — Client 半区
// 本文件内容即 cordis_define 的 code.client(纯 JavaScript 函数体,无 JSX/TS/import)。
//
// 调色板引擎(语义角色映射、双种子生成、对比度求解)与 VS Code 导入映射的
// 架构灵感来自 t3code(https://github.com/pingdotgg/t3code),详见仓库 README。
// 品牌与命名均为 DSH 自有。
//
// 实现要点:
//   - 13 个 DSH alias token 以 theme.overrideTokens 单覆盖层应用(每 token 携带
//     light/dark 双值),外观模式由 theme.setTheme('system'|'light'|'dark') 决定;
//   - 明暗混合:浅色与深色可分别指定调色板,缺半用 DSH 默认值兜底;
//   - 搜索安装:经 Open VSX 搜索扩展,Host 下载 VSIX 并解压列出贡献的主题;
//   - 持久化:主题库(导入、选择、混合)保存到 ~/.dsh/dsh-themes.json,重启后恢复;
//   - 设置页注册在 settings.section 槽位(id: dsh-themes)。
return {
  apply(ctx) {
    const theme = ctx.get('theme')
    if (theme === undefined) return
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // ============================================================
    // 颜色工具:RGB/HSL 混合 + WCAG 对比度求解
    // (受 t3code 主题引擎启发)
    // ============================================================

    function parseHex(value, fallback) {
      const match = /^#?([0-9a-f]{6})$/i.exec(String(value).trim())
      if (!match) return fallback
      const n = parseInt(match[1], 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }

    function rgbToHex(c) {
      const ch = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
      return '#' + ch(c.r) + ch(c.g) + ch(c.b)
    }

    function rgbToHsl(c) {
      const r = c.r / 255, g = c.g / 255, b = c.b / 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const l = (max + min) / 2
      if (max === min) return { h: 0, s: 0, l }
      const d = max - min
      const s = d / (1 - Math.abs(2 * l - 1))
      let h = 0
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      return { h: (h * 60 + 360) % 360, s, l }
    }

    function hslToRgb(hsl) {
      const h = ((hsl.h % 360) + 360) % 360
      const c = (1 - Math.abs(2 * hsl.l - 1)) * hsl.s
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m = hsl.l - c / 2
      let rgb
      if (h < 60) rgb = [c, x, 0]
      else if (h < 120) rgb = [x, c, 0]
      else if (h < 180) rgb = [0, c, x]
      else if (h < 240) rgb = [0, x, c]
      else if (h < 300) rgb = [x, 0, c]
      else rgb = [c, 0, x]
      return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 }
    }

    function luminance(c) {
      const lin = (v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      const r = lin(c.r / 255), g = lin(c.g / 255), b = lin(c.b / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    function contrastRatio(a, b) {
      const la = luminance(a), lb = luminance(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }

    function mixRgb(a, b, amount) {
      return {
        r: a.r + (b.r - a.r) * amount,
        g: a.g + (b.g - a.g) * amount,
        b: a.b + (b.b - a.b) * amount,
      }
    }

    const LIGHT_FG = { r: 255, g: 250, b: 255 }
    const DARK_FG = { r: 36, g: 21, b: 35 }
    const WHITE_FG = { r: 255, g: 255, b: 255 }
    const BLACK_FG = { r: 0, g: 0, b: 0 }

    function readableForeground(bg) {
      const lightContrast = contrastRatio(bg, LIGHT_FG)
      const darkContrast = contrastRatio(bg, DARK_FG)
      if (Math.max(lightContrast, darkContrast) >= 4.5) {
        return lightContrast >= darkContrast ? LIGHT_FG : DARK_FG
      }
      return contrastRatio(bg, WHITE_FG) >= contrastRatio(bg, BLACK_FG) ? WHITE_FG : BLACK_FG
    }

    function readableText(bg, fg, amount, minimumRatio) {
      const softened = mixRgb(fg, bg, amount)
      if (contrastRatio(softened, bg) >= minimumRatio) return softened
      let readable = fg, lower = 0, upper = amount
      for (let i = 0; i < 12; i += 1) {
        const candidateAmount = (lower + upper) / 2
        const candidate = mixRgb(fg, bg, candidateAmount)
        if (contrastRatio(candidate, bg) >= minimumRatio) {
          readable = candidate
          lower = candidateAmount
        } else {
          upper = candidateAmount
        }
      }
      return readable
    }

    function mutedText(bg, fg) {
      const target = luminance(bg) < 0.179 ? 5.082 : 4.705
      return readableText(bg, fg, 1, target)
    }

    // ---- 双种子调色板生成器(managed palette) ----

    function managedBackground(value, appearance) {
      const hsl = rgbToHsl(parseHex(value, { r: 250, g: 245, b: 250 }))
      return hslToRgb({
        h: hsl.h,
        s: Math.min(hsl.s, appearance === 'dark' ? 0.3 : 0.2),
        l: appearance === 'dark'
          ? Math.min(0.13, Math.max(0.07, hsl.l))
          : Math.min(0.985, Math.max(0.94, hsl.l)),
      })
    }

    function managedAccent(value, appearance, background) {
      const hsl = rgbToHsl(parseHex(value, { r: 168, g: 67, b: 112 }))
      const preferredLightness = appearance === 'dark'
        ? Math.min(0.72, Math.max(0.42, hsl.l))
        : Math.min(0.58, Math.max(0.35, hsl.l))
      const range = appearance === 'dark' ? [0.42, 0.82] : [0.22, 0.58]
      const saturation = Math.min(hsl.s, 0.82)
      let best = null
      for (let i = 0; i < 61; i += 1) {
        const lightness = range[0] + ((range[1] - range[0]) * i) / 60
        const color = hslToRgb({ h: hsl.h, s: saturation, l: lightness })
        const c = contrastRatio(color, background)
        const readable = c >= 4.7
        const dist = Math.abs(lightness - preferredLightness)
        if (
          best === null ||
          (readable && !best.readable) ||
          (readable === best.readable && dist < best.dist) ||
          (readable === best.readable && dist === best.dist && c > best.c)
        ) {
          best = { color, dist, c, readable }
        }
      }
      return best.color
    }

    const STATUS_STANDARD = {
      light: { error: '#fb2c36', warning: '#fe9a00' },
      dark: { error: '#fb414a', warning: '#fe9a00' },
    }
    const SUCCESS_STANDARD = { light: '#22c55e', dark: '#4ed17e' }

    function statusColors(canvasRgb) {
      const appearance = luminance(canvasRgb) < 0.179 ? 'dark' : 'light'
      const std = STATUS_STANDARD[appearance]
      return { error: std.error, warning: std.warning, success: SUCCESS_STANDARD[appearance] }
    }

    /** 由两个种子生成 13-token 调色板(exactSeeds = 种子原样使用,不做可读性包络校正)。 */
    function createManagedColors(appearance, bgSeed, accentSeed, exactSeeds) {
      const canvas = exactSeeds
        ? parseHex(bgSeed, { r: 250, g: 245, b: 250 })
        : managedBackground(bgSeed, appearance)
      const accent = exactSeeds
        ? parseHex(accentSeed, { r: 168, g: 67, b: 112 })
        : managedAccent(accentSeed, appearance, canvas)
      const text = readableForeground(canvas)
      const textMuted = mutedText(canvas, text)
      const dark = appearance === 'dark'
      const sidebar = mixRgb(canvas, accent, 0.08)
      const surfaceRaised = mixRgb(canvas, text, dark ? 0.12 : 0.035)
      const surfaceOverlay = mixRgb(canvas, text, dark ? 0.18 : 0.06)
      const border = mixRgb(mixRgb(canvas, accent, dark ? 0.22 : 0.1), text, 0.1)
      const input = mixRgb(mixRgb(canvas, accent, dark ? 0.3 : 0.14), text, dark ? 0.14 : 0.13)
      const status = statusColors(canvas)
      return {
        '--dsw-alias-bg-base': rgbToHex(canvas),
        '--dsw-alias-bg-layer-1': rgbToHex(canvas),
        '--dsw-alias-bg-layer-2': rgbToHex(surfaceRaised),
        '--dsw-alias-bg-overlay': rgbToHex(surfaceOverlay),
        '--dsw-alias-border-l1': rgbToHex(border),
        '--dsw-alias-border-l2': rgbToHex(input),
        '--dsw-alias-brand-primary': rgbToHex(accent),
        '--dsw-alias-label-primary': rgbToHex(text),
        '--dsw-alias-label-secondary': rgbToHex(textMuted),
        '--dsw-alias-state-error-primary': status.error,
        '--dsw-alias-state-warn-primary': status.warning,
        '--dsw-alias-state-success-primary': status.success,
        '--dsw-specific-sidebar-fill': rgbToHex(sidebar),
      }
    }

    // ---- DSH Chat 调色板(手调字面色值,取自 t3.chat 界面的取色记录) ----

    function chatTokens(mode) {
      return mode === 'dark'
        ? {
            '--dsw-alias-bg-base': '#1f1a24',
            '--dsw-alias-bg-layer-1': '#29232d',
            '--dsw-alias-bg-layer-2': '#2c2631',
            '--dsw-alias-bg-overlay': '#100a0e',
            '--dsw-alias-border-l1': '#27242c',
            '--dsw-alias-border-l2': '#302029',
            '--dsw-alias-brand-primary': '#a3004c',
            '--dsw-alias-label-primary': '#f9f8fb',
            '--dsw-alias-label-secondary': '#e7d0dd',
            '--dsw-alias-state-error-primary': '#9d174d',
            '--dsw-alias-state-warn-primary': '#f59e0b',
            '--dsw-alias-state-success-primary': '#4ed17e',
            '--dsw-specific-sidebar-fill': '#171018',
          }
        : {
            '--dsw-alias-bg-base': '#fdf7fd',
            '--dsw-alias-bg-layer-1': '#faf3fb',
            '--dsw-alias-bg-layer-2': '#fdfafd',
            '--dsw-alias-bg-overlay': '#ffffff',
            '--dsw-alias-border-l1': '#eee1ed',
            '--dsw-alias-border-l2': '#e7c1dc',
            '--dsw-alias-brand-primary': '#db2777',
            '--dsw-alias-label-primary': '#501854',
            '--dsw-alias-label-secondary': '#ac1668',
            '--dsw-alias-state-error-primary': '#f7086c',
            '--dsw-alias-state-warn-primary': '#f59e0b',
            '--dsw-alias-state-success-primary': '#22c55e',
            '--dsw-specific-sidebar-fill': '#f2e1f4',
          }
    }

    // ---- VS Code 主题导入(映射逻辑受 t3code vscodeThemeImport 启发) ----

    function parseVsCodeColor(value) {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      if (trimmed.startsWith('color(')) {
        const match = /^color\(\s*(display-p3|srgb)\s+([^)]+)\)$/i.exec(trimmed)
        if (!match) return null
        const space = match[1].toLowerCase()
        const parts = match[2].split('/')
        const channels = parts[0].trim().split(/\s+/).map((p) => p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p))
        if (channels.length !== 3 || channels.some((c) => !isFinite(c))) return null
        const alphaRaw = (parts[1] || '').trim()
        const alpha = alphaRaw === '' ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw)
        if (!isFinite(alpha)) return null
        const [r, g, b] = channels
        if (space === 'srgb') return { r: r * 255, g: g * 255, b: b * 255, a: Math.max(0, Math.min(1, alpha)) }
        const dg = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        const eg = (v) => { const c = Math.max(0, Math.min(1, v)); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055 }
        const srgb = [
          1.2249401762805 * dg(r) - 0.2249401762805 * dg(g),
          -0.042056961239 * dg(r) + 1.042056961239 * dg(g),
          -0.0196375547643 * dg(r) - 0.0786360655012 * dg(g) + 1.0982736202656 * dg(b),
        ].map((c) => eg(c) * 255)
        return { r: srgb[0], g: srgb[1], b: srgb[2], a: Math.max(0, Math.min(1, alpha)) }
      }
      const hex = trimmed.replace(/^#/, '')
      if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null
      const expand = (part) => part.length === 1 ? parseInt(part + part, 16) : parseInt(part, 16)
      if (hex.length <= 4) {
        return { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]), a: hex.length === 4 ? expand(hex[3]) / 255 : 1 }
      }
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      }
    }

    function flattenOver(color, base) {
      if (color.a >= 1) return rgbToHex(color)
      return rgbToHex({
        r: color.r * color.a + base.r * (1 - color.a),
        g: color.g * color.a + base.g * (1 - color.a),
        b: color.b * color.a + base.b * (1 - color.a),
      })
    }

    function humanizeName(raw) {
      const trimmed = String(raw || '').trim()
      if (/\s/.test(trimmed) || !/[-_.]/.test(trimmed)) return trimmed
      return trimmed.split(/[-_.]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }

    function slugify(name) {
      const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
      return s || 'vsc-theme'
    }

    /** 解析 VS Code 颜色主题 JSON,输出 {light, dark} 两套 13-token 映射。 */
    function parseVsCodeTheme(raw) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('主题文件必须是 JSON 对象')
      const colors = raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors) ? raw.colors : {}
      const pick = (...keys) => { for (const k of keys) { const p = parseVsCodeColor(colors[k]); if (p) return p } return null }
      const canvasColor = pick('editor.background', 'editorPane.background')
      if (!canvasColor) throw new Error('缺少 editor.background,无法构建调色板')
      const canvas = { r: canvasColor.r, g: canvasColor.g, b: canvasColor.b }
      const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : null
      const appearance = type === 'light' || type === 'hc-light'
        ? 'light'
        : type === 'dark' || type === 'hc-black'
          ? 'dark'
          : (luminance(canvas) < 0.179 ? 'dark' : 'light')
      const accentColor = pick('focusBorder', 'button.background', 'textLink.foreground', 'activityBarBadge.background', 'progressBar.background', 'badge.background')
      const canvasHex = rgbToHex(canvas)
      const accentHex = accentColor ? flattenOver(accentColor, canvas) : null
      const mutedAccentHex = accentHex
        ? flattenOver({ r: accentColor.r, g: accentColor.g, b: accentColor.b, a: 0.2 }, canvas)
        : canvasHex
      const opposite = appearance === 'light' ? 'dark' : 'light'
      const derived = createManagedColors(appearance, canvasHex, mutedAccentHex, true)
      const derivedOpp = createManagedColors(opposite, canvasHex, mutedAccentHex, true)
      const solidOver = (base, ...keys) => { const p = pick(...keys); return p ? flattenOver(p, base) : null }
      const readableOn = (surface, fallback, ...keys) => {
        const s = parseHex(surface, { r: 0, g: 0, b: 0 })
        const ok = (cand) => contrastRatio(parseHex(cand, { r: 0, g: 0, b: 0 }), s) >= 4.5
        const specified = solidOver(s, ...keys)
        if (specified && ok(specified)) return specified
        if (ok(fallback)) return fallback
        return luminance(s) < 0.179 ? '#ffffff' : '#000000'
      }
      const buildTokens = (mode) => {
        const d = mode === appearance ? derived : derivedOpp
        const canvasRgb = parseHex(canvasHex, { r: 0, g: 0, b: 0 })
        return {
          '--dsw-alias-bg-base': canvasHex,
          '--dsw-alias-bg-layer-1': solidOver(canvasRgb, 'editorWidget.background') || d['--dsw-alias-bg-layer-1'],
          '--dsw-alias-bg-layer-2': solidOver(canvasRgb, 'editorWidget.background', 'dropdown.background') || d['--dsw-alias-bg-layer-2'],
          '--dsw-alias-bg-overlay': solidOver(canvasRgb, 'menu.background', 'quickInput.background', 'dropdown.background') || d['--dsw-alias-bg-overlay'],
          '--dsw-alias-border-l1': solidOver(canvasRgb, 'panel.border', 'editorGroup.border', 'contrastBorder') || d['--dsw-alias-border-l1'],
          '--dsw-alias-border-l2': solidOver(canvasRgb, 'input.border', 'dropdown.border') || d['--dsw-alias-border-l2'],
          '--dsw-alias-brand-primary': accentHex || d['--dsw-alias-brand-primary'],
          '--dsw-alias-label-primary': readableOn(canvasHex, d['--dsw-alias-label-primary'], 'editor.foreground', 'foreground'),
          '--dsw-alias-label-secondary': readableOn(canvasHex, d['--dsw-alias-label-secondary'], 'descriptionForeground', 'disabledForeground'),
          '--dsw-alias-state-error-primary': readableOn(canvasHex, d['--dsw-alias-state-error-primary'], 'editorError.foreground', 'errorForeground'),
          '--dsw-alias-state-warn-primary': readableOn(canvasHex, d['--dsw-alias-state-warn-primary'], 'editorWarning.foreground'),
          '--dsw-alias-state-success-primary': d['--dsw-alias-state-success-primary'],
          '--dsw-specific-sidebar-fill': solidOver(canvasRgb, 'sideBar.background', 'activityBar.background') || d['--dsw-specific-sidebar-fill'],
        }
      }
      return { light: buildTokens('light'), dark: buildTokens('dark') }
    }

    // ---- 调色板目录 ----

    const TOKEN_NAMES = [
      '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
      '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
      '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
      '--dsw-alias-state-error-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-success-primary',
      '--dsw-specific-sidebar-fill',
    ]

    /** DSH 内置外观的 13 个 token 默认值(明暗混合缺半时的兜底)。 */
    const DEFAULT_PALETTE = {
      light: {
        '--dsw-alias-bg-base': '#ffffff',
        '--dsw-alias-bg-layer-1': '#ffffff',
        '--dsw-alias-bg-layer-2': '#ffffff',
        '--dsw-alias-bg-overlay': '#e9ecf2',
        '--dsw-alias-border-l1': 'rgba(0, 0, 0, 0.04)',
        '--dsw-alias-border-l2': 'rgba(0, 0, 0, 0.10)',
        '--dsw-alias-brand-primary': '#0f1115',
        '--dsw-alias-label-primary': '#0f1115',
        '--dsw-alias-label-secondary': '#61666b',
        '--dsw-alias-state-error-primary': '#ec1313',
        '--dsw-alias-state-warn-primary': '#f59e0b',
        '--dsw-alias-state-success-primary': '#22c55e',
        '--dsw-specific-sidebar-fill': '#f9fafb',
      },
      dark: {
        '--dsw-alias-bg-base': '#151517',
        '--dsw-alias-bg-layer-1': '#232324',
        '--dsw-alias-bg-layer-2': '#2c2c2e',
        '--dsw-alias-bg-overlay': '#61666b',
        '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.06)',
        '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.12)',
        '--dsw-alias-brand-primary': '#f9fafb',
        '--dsw-alias-label-primary': '#f9fafb',
        '--dsw-alias-label-secondary': '#cfd3d6',
        '--dsw-alias-state-error-primary': '#f25a5a',
        '--dsw-alias-state-warn-primary': '#f59e0b',
        '--dsw-alias-state-success-primary': '#22c55e',
        '--dsw-specific-sidebar-fill': '#1b1b1c',
      },
    }

    const PALETTES = [
      { id: 'dsh-chat', label: 'DSH Chat', light: chatTokens('light'), dark: chatTokens('dark') },
      { id: 'grove', label: 'Grove', light: createManagedColors('light', '#f2f8f4', '#19734a'), dark: createManagedColors('dark', '#1d2b24', '#69d69a') },
      { id: 'ocean', label: 'Ocean', light: createManagedColors('light', '#f2f7fb', '#2878b8'), dark: createManagedColors('dark', '#1b2938', '#70b9ee') },
      { id: 'ember', label: 'Ember', light: createManagedColors('light', '#fff6ef', '#c4602f'), dark: createManagedColors('dark', '#30231e', '#f39a62') },
      { id: 'iris', label: 'Iris', light: createManagedColors('light', '#f7f4fc', '#7254b9'), dark: createManagedColors('dark', '#29243b', '#ad92f5') },
    ]

    // ---- 调色板覆盖层状态 ----

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

    /** 设置明暗混合的一半;id 为空表示该半使用默认外观。 */
    function setMixed(mode, id) {
      store.mixed[mode] = id || null
      applyLayers()
      persist()
    }

    function removeCustom(id) {
      store.custom = store.custom.filter((p) => p.id !== id)
      if (store.current === id) store.current = null
      if (store.mixed.light === id) store.mixed.light = null
      if (store.mixed.dark === id) store.mixed.dark = null
      applyLayers()
      persist()
    }

    function isValidPalette(p) {
      return !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.label === 'string' &&
        p.light && typeof p.light === 'object' && p.dark && typeof p.dark === 'object' &&
        TOKEN_NAMES.every((t) => typeof p.light[t] === 'string' && typeof p.dark[t] === 'string')
    }

    /** 从持久化存储恢复主题库(异步、幂等)。 */
    async function hydrate() {
      try {
        const res = await host.call('load-themes', {})
        if (res && res.ok && res.data) {
          const d = res.data
          if (Array.isArray(d.custom)) store.custom = d.custom.filter((p) => isValidPalette(p))
          if (typeof d.current === 'string' && paletteById(d.current)) store.current = d.current
          if (d.mixed && typeof d.mixed === 'object') {
            if (typeof d.mixed.light === 'string' && paletteById(d.mixed.light)) store.mixed.light = d.mixed.light
            if (typeof d.mixed.dark === 'string' && paletteById(d.mixed.dark)) store.mixed.dark = d.mixed.dark
          }
        }
      } catch { /* 持久化不可用时静默降级为会话内状态 */ }
      store.loaded = true
      applyLayers()
      store.emit()
    }

    function importVsCodeTheme(text, sourceName) {
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
      const base = slugify(label)
      let id = 'vsc-' + base
      let n = 2
      while (store.custom.some((p) => p.id === id)) id = 'vsc-' + base + '-' + n++
      const palette = { id, label, light: tokens.light, dark: tokens.dark, imported: true }
      store.custom.push(palette)
      applyPalette(palette)
      return palette
    }

    // ---- 样式 ----

    ctx.effect(() => {
      const disposeCss = styles.insert(
        '.dsth-page{display:flex;flex-direction:column;gap:14px;max-width:760px}' +
        '.dsth-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px}' +
        '.dsth-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}' +
        '.dsth-section{display:flex;flex-direction:column;gap:8px}' +
        '.dsth-section-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;margin-top:4px}' +
        '.dsth-moderow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
        '.dsth-modechip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:4px 14px;font-size:12px;line-height:18px;cursor:pointer;font:inherit}' +
        '.dsth-modechip:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-modechip-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}' +
        '.dsth-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}' +
        '.dsth-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}' +
        '.dsth-card.dsth-selected{border-color:var(--dsw-alias-brand-primary)}' +
        '.dsth-card-name{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;cursor:pointer}' +
        '.dsth-badge{color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:400}' +
        '.dsth-modes{display:flex;gap:8px}' +
        '.dsth-mode{flex:1;display:flex;flex-direction:column;gap:6px;align-items:center;padding:8px 6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px}' +
        '.dsth-mode:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-swatches{display:flex;gap:4px}' +
        '.dsth-swatch{width:14px;height:14px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);box-sizing:border-box}' +
        '.dsth-row{display:flex;gap:8px;align-items:center}' +
        '.dsth-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12px;line-height:18px;min-width:0;flex:1;font:inherit}' +
        '.dsth-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}' +
        '.dsth-textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);resize:vertical;min-height:90px;width:100%}' +
        '.dsth-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:18px;cursor:pointer;flex:none;font:inherit}' +
        '.dsth-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
        '.dsth-btn:disabled{opacity:.5;cursor:default}' +
        '.dsth-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto}' +
        '.dsth-listitem{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;display:flex;gap:8px;align-items:center;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-1)}' +
        '.dsth-listitem-main{min-width:0;flex:1;display:flex;flex-direction:column}' +
        '.dsth-listitem-name{color:var(--dsw-alias-label-primary)}' +
        '.dsth-listitem-path{color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.dsth-msg{padding:6px 10px;border-radius:8px;font-size:12px;line-height:18px}' +
        '.dsth-msg-ok{color:var(--dsw-alias-state-success-primary)}' +
        '.dsth-msg-error{color:var(--dsw-alias-state-error-primary)}' +
        '.dsth-del{border:none;background:transparent;color:var(--dsw-alias-state-error-primary);cursor:pointer;font-size:11px;line-height:16px;padding:2px 6px;border-radius:6px;flex:none;font:inherit}' +
        '.dsth-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}' +
        '.dsth-foot{display:flex;align-items:center;gap:12px;padding-top:6px}' +
        '.dsth-note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}' +
        '.dsth-select{flex:none;min-width:150px}' +
        '.dsth-listitem-col{flex-direction:column;align-items:stretch;gap:6px}' +
        '.dsth-pair{display:flex;gap:8px;align-items:center}' +
        '.dsth-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
      )
      return () => {
        if (layerDisposer) { try { layerDisposer() } catch { /* ignore */ } layerDisposer = null }
        disposeCss()
      }
    })

    // ---- 设置页 ----

    const SWATCH_TOKENS = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-2', '--dsw-alias-brand-primary', '--dsw-alias-label-primary', '--dsw-specific-sidebar-fill']
    const MODE_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' }

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

      const runSearch = async () => {
        if (!searchQuery.trim()) { setMessage({ kind: 'error', text: '请输入搜索关键词' }); return }
        setBusy('search')
        setMessage(null)
        try {
          const res = await host.call('search-open-vsx', { query: searchQuery.trim() })
          if (res && res.ok) {
            setSearchResults(res.list || [])
            if ((res.list || []).length === 0) setMessage({ kind: 'error', text: '没有找到匹配的扩展' })
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '搜索失败' })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: '调用失败:' + String((e && e.message) || e) })
        }
        setBusy('')
      }

      const installExt = async (ext) => {
        setBusy('install-' + ext.name)
        setMessage(null)
        try {
          const res = await host.call('install-open-vsx', { namespace: ext.namespace, name: ext.name, downloadUrl: ext.downloadUrl })
          if (res && res.ok) {
            setSearchResults(searchResults.map((e) => e === ext ? { ...e, themes: res.themes || [], installedVersion: res.version } : e))
            setMessage({ kind: 'ok', text: '已获取「' + res.extension + '」,含 ' + (res.themes || []).length + ' 个主题' })
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '安装失败' })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      const importPath = async (t) => {
        setBusy(t.path)
        setMessage(null)
        try {
          const res = await host.call('read-theme-file', { path: t.path })
          if (res && res.ok) {
            doImport(res.text, t.label)
          } else {
            setMessage({ kind: 'error', text: (res && res.error) || '读取失败' })
          }
        } catch (e) {
          setMessage({ kind: 'error', text: String((e && e.message) || e) })
        }
        setBusy('')
      }

      // ---- 渲染 ----

      const paletteBadge = (palette) => {
        if (store.current === palette.id) return '使用中'
        if (store.mixed.light === palette.id && store.mixed.dark === palette.id) return '明暗'
        if (store.mixed.light === palette.id) return '浅色'
        if (store.mixed.dark === palette.id) return '深色'
        return null
      }

      const renderCard = (palette, extra) => {
        const badge = paletteBadge(palette)
        return React.createElement('div', {
          key: palette.id,
          className: 'dsth-card' + (badge ? ' dsth-selected' : ''),
        },
          React.createElement('div', { className: 'dsth-card-name', onClick: () => applyPalette(palette), title: '应用调色板(保持当前外观模式)' },
            palette.label,
            badge ? React.createElement('span', { className: 'dsth-badge' }, badge) : null,
            extra || null
          ),
          React.createElement('div', { className: 'dsth-modes' },
            ['light', 'dark'].map((mode) => React.createElement('button', {
              key: mode,
              className: 'dsth-mode',
              onClick: () => { applyPalette(palette); theme.setTheme(mode) },
            },
              React.createElement('span', null, MODE_LABELS[mode]),
              React.createElement('span', { className: 'dsth-swatches' },
                SWATCH_TOKENS.map((t) => React.createElement('span', { key: t, className: 'dsth-swatch', style: { background: palette[mode][t] } }))
              )
            ))
          )
        )
      }

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
          '5 套内置调色板 × 明/暗变体,支持跟随系统;可从 VS Code 扩展、URL 或粘贴 JSON 导入主题。'
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
              onClick: () => { applyPalette(null); theme.setTheme('system') },
            }, '清除调色板并恢复默认')
          )
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '明暗混合'),
          React.createElement('div', { className: 'dsth-row' },
            React.createElement('span', { className: 'dsth-sub' }, '浅色'),
            React.createElement('select', {
              className: 'dsth-input dsth-select',
              value: store.mixed.light || '',
              onChange: (e) => setMixed('light', e.target.value),
            },
              React.createElement('option', { value: '' }, '默认外观'),
              [...PALETTES, ...store.custom].map((p) => React.createElement('option', { key: p.id, value: p.id }, p.label))
            ),
            React.createElement('span', { className: 'dsth-sub' }, '深色'),
            React.createElement('select', {
              className: 'dsth-input dsth-select',
              value: store.mixed.dark || '',
              onChange: (e) => setMixed('dark', e.target.value),
            },
              React.createElement('option', { value: '' }, '默认外观'),
              [...PALETTES, ...store.custom].map((p) => React.createElement('option', { key: p.id, value: p.id }, p.label))
            )
          ),
          React.createElement('div', { className: 'dsth-sub' }, '为浅色与深色分别指定调色板;跟随系统时按系统明暗自动切换,固定模式时仅显示对应一半。')
        ),

        React.createElement('div', { className: 'dsth-section' },
          React.createElement('div', { className: 'dsth-section-title' }, '内置调色板'),
          React.createElement('div', { className: 'dsth-grid' }, PALETTES.map((p) => renderCard(p, null)))
        ),

        store.custom.length > 0
          ? React.createElement('div', { className: 'dsth-section' },
              React.createElement('div', { className: 'dsth-section-title' }, '导入的主题'),
              React.createElement('div', { className: 'dsth-grid' },
                store.custom.map((p) => renderCard(p,
                  React.createElement('button', { className: 'dsth-del', onClick: () => removeCustom(p.id) }, '删除')
                ))
              )
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
          searchResults && searchResults.length > 0
            ? React.createElement('div', { className: 'dsth-list' },
                searchResults.map((ext) => React.createElement('div', { key: ext.namespace + '.' + ext.name, className: 'dsth-listitem dsth-listitem-col' },
                  React.createElement('div', { className: 'dsth-row' },
                    React.createElement('div', { className: 'dsth-listitem-main' },
                      React.createElement('span', { className: 'dsth-listitem-name' }, ext.displayName + ' · ' + ext.namespace + '.' + ext.name),
                      React.createElement('span', { className: 'dsth-listitem-path' },
                        'v' + ext.version + ' · ' + fmtCount(ext.downloadCount) + ' 次下载' + (ext.installedVersion ? ' · 已获取 v' + ext.installedVersion : '')
                      )
                    ),
                    React.createElement('button', {
                      className: 'dsth-btn',
                      disabled: busy !== '',
                      onClick: () => installExt(ext),
                    }, busy === 'install-' + ext.name ? '获取中…' : (ext.themes ? '重新获取' : '获取'))
                  ),
                  ext.themes && ext.themes.length > 0
                    ? React.createElement('div', { className: 'dsth-list' },
                        ext.themes.map((t) => React.createElement('div', { key: t.path, className: 'dsth-listitem' },
                          React.createElement('div', { className: 'dsth-listitem-main' },
                            React.createElement('span', { className: 'dsth-listitem-name' }, t.label),
                            React.createElement('span', { className: 'dsth-listitem-path' }, t.uiTheme || '颜色主题')
                          ),
                          React.createElement('button', { className: 'dsth-btn', disabled: busy !== '', onClick: () => importPath(t) }, '导入')
                        ))
                      )
                    : null,
                  ext.themes && ext.themes.length === 0
                    ? React.createElement('div', { className: 'dsth-sub' }, '该扩展未贡献颜色主题')
                    : null
                ))
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
      { name: 'settings.section', id: 'dsh-themes', order: 12, label: '主题' },
      () => React.createElement(ThemesPage)
    ))

    // 从持久化存储恢复主题库(异步;完成后自动应用覆盖层并触发重渲染)
    hydrate()
  },
}
