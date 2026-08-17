// VS Code 主题导入(映射逻辑受 t3code vscodeThemeImport 启发)
import { luminance, contrastRatio, mixRgb, readableForeground, parseHex, rgbToHex, LIGHT_FG, WHITE_FG, BLACK_FG } from './color-utils.js'
import { createVividColors } from './oklch.js'
import { EXTENDED_TOKEN_NAMES } from './palette.js'
export function parseVsCodeColor(value) {
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


export function flattenOver(color, base) {
      if (color.a >= 1) return rgbToHex(color)
      return rgbToHex({
        r: color.r * color.a + base.r * (1 - color.a),
        g: color.g * color.a + base.g * (1 - color.a),
        b: color.b * color.a + base.b * (1 - color.a),
      })
    }


export function humanizeName(raw) {
      const trimmed = String(raw || '').trim()
      if (/\s/.test(trimmed) || !/[-_.]/.test(trimmed)) return trimmed
      return trimmed.split(/[-_.]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }


export function slugify(name) {
      const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
      return s || 'vsc-theme'
    }

    /** 解析 VS Code 颜色主题 JSON,输出 {light, dark} 两套 13-token 映射。 */

export function parseVsCodeTheme(raw) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('主题文件必须是 JSON 对象')
      const colors = raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors) ? raw.colors : {}
      const pick = (...keys) => { for (const k of keys) { const p = parseVsCodeColor(colors[k]); if (p && p.a > 0.02) return p } return null }
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
      const derived = createVividColors(appearance, canvasHex, mutedAccentHex)
      const derivedOpp = createVividColors(opposite, canvasHex, mutedAccentHex)
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
        // 操作色通道(对应 t3code messageAction = button.background):按钮/进度/tab/动画用按钮色,独立于 accent
        let actionHex = null
        let actionHoverHex = null
        const actionColor = pick('button.background', 'progressBar.background', 'activityBarBadge.background')
        if (actionColor) {
          actionHex = flattenOver(actionColor, canvasRgb)
          const ar = parseHex(actionHex, { r: 0, g: 0, b: 0 })
          const af = readableForeground(ar)
          actionHoverHex = rgbToHex(mixRgb(ar, (af === LIGHT_FG || af === WHITE_FG) ? BLACK_FG : WHITE_FG, 0.12))
        }
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
          '--dsw-alias-button-info-fill': actionHex || d['--dsw-alias-button-info-fill'],
          '--dsw-alias-button-info-hover': actionHoverHex || d['--dsw-alias-button-info-hover'],
          '--dsw-alias-state-business-primary': actionHex || d['--dsw-alias-state-business-primary'],
          '--dsw-alias-state-business-tertiary': d['--dsw-alias-state-business-tertiary'],
          '--dsw-specific-sidebar-nav-item-active': d['--dsw-specific-sidebar-nav-item-active'],
          '--dsw-specific-sidebar-nav-item-active-accent': d['--dsw-specific-sidebar-nav-item-active-accent'],
          '--dsw-static-deepseek-500': actionHex || d['--dsw-static-deepseek-500'],
          '--dsw-static-deepseek-200': d['--dsw-static-deepseek-200'],
          '--dsw-static-deepseek-450': actionHex || d['--dsw-static-deepseek-450'],
          '--dsw-specific-bubble': d['--dsw-specific-bubble'],
          '--dsw-specific-bubble-highlight': d['--dsw-specific-bubble-highlight'],
          // 扩展 token:优先取 VS Code workbench 指定值(对比度门控),缺失时用派生值
          ...Object.fromEntries(EXTENDED_TOKEN_NAMES.map((token) => [token, d[token]])),
          '--dsw-alias-bg-layer-3': solidOver(canvasRgb, 'editorWidget.background') || d['--dsw-alias-bg-layer-3'],
          '--dsw-specific-menu': solidOver(canvasRgb, 'menu.background', 'quickInput.background') || d['--dsw-specific-menu'],
          '--dsw-specific-selector': solidOver(canvasRgb, 'list.hoverBackground', 'dropdown.background') || d['--dsw-specific-selector'],
          '--dsw-specific-input-major': solidOver(canvasRgb, 'input.background') || d['--dsw-specific-input-major'],
          '--dsw-alias-interactive-bg-hover': solidOver(canvasRgb, 'list.hoverBackground') || d['--dsw-alias-interactive-bg-hover'],
          '--dsw-alias-interactive-bg-active': solidOver(canvasRgb, 'list.activeSelectionBackground') || d['--dsw-alias-interactive-bg-active'],
          '--dsw-alias-label-tertiary': readableOn(canvasHex, d['--dsw-alias-label-tertiary'], 'input.placeholderForeground', 'icon.foreground'),
          '--dsw-alias-label-caption': readableOn(canvasHex, d['--dsw-alias-label-caption'], 'disabledForeground'),
          '--dsw-alias-markdown-code-block': solidOver(canvasRgb, 'textCodeBlock.background') || d['--dsw-alias-markdown-code-block'],
          '--dsw-alias-markdown-inline-code': solidOver(canvasRgb, 'textCodeBlock.background') || d['--dsw-alias-markdown-inline-code'],
          '--dsw-alias-state-error-secondary': readableOn(canvasHex, d['--dsw-alias-state-error-secondary'], 'editorError.foreground'),
          '--dsw-alias-state-warn-label': readableOn(canvasHex, d['--dsw-alias-state-warn-label'], 'editorWarning.foreground'),
        }
      }
      return { light: buildTokens('light'), dark: buildTokens('dark'), appearance }
    }

    // ---- 调色板目录 ----


