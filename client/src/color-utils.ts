// 颜色工具:RGB/HSL 混合、WCAG 对比度求解、双种子调色板生成(受 t3code 主题引擎启发)
export function parseHex(value, fallback) {
      const match = /^#?([0-9a-f]{6})$/i.exec(String(value).trim())
      if (!match) return fallback
      const n = parseInt(match[1], 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }


export function rgbToHex(c) {
      const ch = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
      return '#' + ch(c.r) + ch(c.g) + ch(c.b)
    }


export function rgbToHsl(c) {
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


export function hslToRgb(hsl) {
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


export function luminance(c) {
      const lin = (v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      const r = lin(c.r / 255), g = lin(c.g / 255), b = lin(c.b / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }


export function contrastRatio(a, b) {
      const la = luminance(a), lb = luminance(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }


export function mixRgb(a, b, amount) {
      return {
        r: a.r + (b.r - a.r) * amount,
        g: a.g + (b.g - a.g) * amount,
        b: a.b + (b.b - a.b) * amount,
      }
    }


export const LIGHT_FG = { r: 255, g: 250, b: 255 }

export const DARK_FG = { r: 36, g: 21, b: 35 }

export const WHITE_FG = { r: 255, g: 255, b: 255 }

export const BLACK_FG = { r: 0, g: 0, b: 0 }


export function readableForeground(bg) {
      const lightContrast = contrastRatio(bg, LIGHT_FG)
      const darkContrast = contrastRatio(bg, DARK_FG)
      if (Math.max(lightContrast, darkContrast) >= 4.5) {
        return lightContrast >= darkContrast ? LIGHT_FG : DARK_FG
      }
      return contrastRatio(bg, WHITE_FG) >= contrastRatio(bg, BLACK_FG) ? WHITE_FG : BLACK_FG
    }


export function readableText(bg, fg, amount, minimumRatio) {
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


export function mutedText(bg, fg) {
      const target = luminance(bg) < 0.179 ? 5.082 : 4.705
      return readableText(bg, fg, 1, target)
    }

    // ---- 双种子调色板生成器(managed palette) ----


export const STATUS_STANDARD = {
      light: { error: '#fb2c36', warning: '#fe9a00' },
      dark: { error: '#fb414a', warning: '#fe9a00' },
    }

export const SUCCESS_STANDARD = { light: '#22c55e', dark: '#4ed17e' }


export function statusColors(canvasRgb) {
      const appearance = luminance(canvasRgb) < 0.179 ? 'dark' : 'light'
      const std = STATUS_STANDARD[appearance]
      return { error: std.error, warning: std.warning, success: SUCCESS_STANDARD[appearance] }
    }

    /** 由两个种子生成 13-token 调色板(exactSeeds = 种子原样使用,不做可读性包络校正)。 */

export function managedBackground(value, appearance) {
      const hsl = rgbToHsl(parseHex(value, { r: 250, g: 245, b: 250 }))
      return hslToRgb({
        h: hsl.h,
        s: Math.min(hsl.s, appearance === 'dark' ? 0.3 : 0.2),
        l: appearance === 'dark'
          ? Math.min(0.13, Math.max(0.07, hsl.l))
          : Math.min(0.985, Math.max(0.94, hsl.l)),
      })
    }


export function managedAccent(value, appearance, background) {
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


/** 由核心色值派生 DSH 设计平台的扩展 token(表面层级、文字层级、交互反馈、
     * Markdown、状态补充、滚动条、浮层与品牌静态色)。core 为 RGB 对象:
     * { canvas, accent, text, textMuted, dark, surfaceRaised, surfaceOverlay,
     *   border, input, accentForeground, buttonHover, error, warn, success }。
     * 中性覆盖层(遮罩/反白边框/工具栏)保持 DSH 平台常量,其余按语义混合派生。 */
export function deriveExtendedTokens(core) {
      const { canvas, accent, text, textMuted, dark } = core
      const { surfaceRaised, surfaceOverlay, border, input, accentForeground, buttonHover } = core
      const { error, warn, success } = core
      const hex = (c) => rgbToHex(c)
      const mix = (a, b, amount) => mixRgb(a, b, amount)
      const rgbaOf = (c, alpha) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`
      const towardText = (amount) => mix(canvas, text, amount)
      const layer3 = dark ? towardText(0.14) : surfaceRaised
      const modulePlatform = towardText(dark ? 0.14 : 0.03)
      return {
        '--dsw-alias-bg-layer-3': hex(layer3),
        '--dsw-alias-bg-module-platform': hex(modulePlatform),
        '--dsw-alias-bg-multi-select': hex(modulePlatform),
        '--dsw-alias-bg-skeleton': dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
        '--dsw-alias-bg-mask-1': dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.24)',
        '--dsw-alias-bg-mask-2': dark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.12)',
        '--dsw-alias-bg-mask-3': 'rgba(0, 0, 0, 0.48)',
        '--dsw-alias-bg-mask-drop': dark ? 'rgba(39, 39, 48, 0.7)' : 'rgba(255, 255, 255, 0.7)',
        '--dsw-alias-bg-mask-photo': 'rgba(0, 0, 0, 0.88)',
        '--dsw-alias-border-l3': hex(mix(border, text, 0.25)),
        '--dsw-alias-border-l4': hex(mix(border, text, 0.4)),
        '--dsw-alias-border-l2-darkmode-thin': hex(dark ? border : input),
        '--dsw-alias-border-inverted': dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0)',
        '--dsw-alias-border-inverted2': dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0)',
        '--dsw-alias-brand-text': hex(text),
        '--dsw-alias-brand-primary-invert': hex(accent),
        '--dsw-alias-brand-primary-new-colorprimary-new-color': hex(accent),
        '--dsw-alias-button-primary-fill': hex(accent),
        '--dsw-alias-button-primary-hover': hex(buttonHover),
        '--dsw-alias-button-primary-dimmed': hex(mix(accent, canvas, dark ? 0.72 : 0.85)),
        '--dsw-alias-button-contrast-fill': hex(dark ? text : textMuted),
        '--dsw-alias-button-elevated-fill': hex(dark ? surfaceOverlay : canvas),
        '--dsw-alias-button-floating-fill': hex(dark ? surfaceRaised : canvas),
        '--dsw-alias-button-floating-hover': hex(dark ? layer3 : towardText(0.045)),
        '--dsw-alias-button-ghost-active-fill': hex(towardText(dark ? 0.19 : 0.08)),
        '--dsw-alias-button-ghost-active-border': hex(towardText(0.45)),
        '--dsw-alias-button-ghost-active-hover': hex(towardText(dark ? 0.33 : 0.09)),
        '--dsw-alias-button-tool-bar-fill': 'rgba(84, 85, 87, 0.5)',
        '--dsw-alias-button-tool-bar-fill-invisible': 'rgba(31, 31, 31, 0.36)',
        '--dsw-alias-button-tool-bar-hover': 'rgba(84, 85, 87, 0.6)',
        '--dsw-alias-interactive-bg-hover': dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
        '--dsw-alias-interactive-bg-active': dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.1)',
        '--dsw-alias-interactive-bg-hover-accent': dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(0, 0, 0, 0.14)',
        '--dsw-alias-interactive-bg-hover-danger': rgbaOf(error, dark ? 0.15 : 0.05),
        '--dsw-alias-interactive-bg-hover-solid': hex(dark ? layer3 : towardText(0.045)),
        '--dsw-alias-label-tertiary': hex(mix(textMuted, canvas, 0.15)),
        '--dsw-alias-label-caption': hex(mix(textMuted, canvas, 0.5)),
        '--dsw-alias-label-dimmed': hex(mix(textMuted, canvas, 0.75)),
        '--dsw-alias-label-primary-dimmed': hex(text),
        '--dsw-alias-label-primary-foreground': hex(accentForeground),
        '--dsw-alias-label-primary-inverted': hex(accentForeground),
        '--dsw-alias-label-primary-bluish': hex(dark ? mix(accent, WHITE_FG, 0.15) : mix(accent, BLACK_FG, 0.3)),
        '--dsw-alias-markdown-code-block': hex(towardText(0.03)),
        '--dsw-alias-markdown-code-block-banner': hex(dark ? surfaceRaised : towardText(0.03)),
        '--dsw-alias-markdown-inline-code': hex(towardText(dark ? 0.12 : 0.08)),
        '--dsw-alias-markdown-citation': hex(towardText(dark ? 0.14 : 0.08)),
        '--dsw-alias-markdown-placeholder': hex(towardText(dark ? 0.12 : 0.04)),
        '--dsw-alias-markdown-tag': hex(towardText(dark ? 0.12 : 0.055)),
        '--dsw-alias-markdown-code-segment-selected': hex(dark ? layer3 : canvas),
        '--dsw-alias-markdown-code-segment-unselected': hex(towardText(dark ? 0.03 : 0.055)),
        '--dsw-alias-scrollbar-bg-l1': hex(towardText(dark ? 0.16 : 0.1)),
        '--dsw-alias-scrollbar-bg-l2': hex(towardText(dark ? 0.16 : 0.1)),
        '--dsw-alias-scrollbar-hover-l1': hex(towardText(dark ? 0.28 : 0.18)),
        '--dsw-alias-scrollbar-hover-l2': hex(towardText(dark ? 0.28 : 0.18)),
        '--dsw-alias-state-error-secondary': hex(dark ? error : mix(error, canvas, 0.35)),
        '--dsw-alias-state-warn-label': hex(mix(warn, BLACK_FG, 0.13)),
        '--dsw-alias-state-warn-secondary': hex(dark ? mix(warn, WHITE_FG, 0.15) : mix(warn, canvas, 0.15)),
        '--dsw-alias-state-warn-tertiary': hex(mix(warn, canvas, 0.92)),
        '--dsw-alias-state-success-secondary': hex(dark ? mix(success, WHITE_FG, 0.2) : mix(success, canvas, 0.2)),
        '--dsw-alias-state-success-tertiary': hex(mix(success, canvas, 0.8)),
        '--dsw-alias-toast-bg': hex(towardText(dark ? 0.2 : 0.85)),
        '--dsw-alias-tooltip-bg': hex(towardText(dark ? 0.2 : 0.87)),
        '--dsw-specific-menu': hex(layer3),
        '--dsw-specific-selector': hex(towardText(dark ? 0.14 : 0.04)),
        '--dsw-specific-input-major': hex(dark ? surfaceRaised : canvas),
        '--dsw-specific-login-input': hex(towardText(dark ? 0.03 : 0.025)),
        '--dsw-specific-tip': hex(towardText(dark ? 0.14 : 0.04)),
        '--dsw-specific-sidebar-nav-item-hover': hex(dark ? surfaceRaised : towardText(0.055)),
        '--dsw-static-blue-400': hex(mix(accent, WHITE_FG, 0.2)),
        '--dsw-static-blue-450': hex(mix(accent, WHITE_FG, 0.1)),
        '--dsw-static-blue-500': hex(accent),
      }
    }


export function createManagedColors(appearance, bgSeed, accentSeed, exactSeeds) {
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
      // ---- 品牌色:由 accent 派生(发送按钮、tab 选中、侧栏选中、气泡、状态动画) ----
      const bubble = mixRgb(canvas, accent, dark ? 0.14 : 0.08)
      const bubbleHighlight = mixRgb(canvas, accent, dark ? 0.22 : 0.14)
      const businessTertiary = mixRgb(canvas, accent, dark ? 0.2 : 0.1)
      const navActive = mixRgb(sidebar, accent, dark ? 0.24 : 0.18)
      const navActiveAccent = mixRgb(sidebar, accent, dark ? 0.16 : 0.12)
      const accentForeground = readableForeground(accent)
      const hoverMix = accentForeground === LIGHT_FG || accentForeground === WHITE_FG ? BLACK_FG : WHITE_FG
      const buttonHover = mixRgb(accent, hoverMix, 0.12)
      const shimmerLight = mixRgb(accent, WHITE_FG, 0.65)
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
        '--dsw-alias-button-info-fill': rgbToHex(accent),
        '--dsw-alias-button-info-hover': rgbToHex(buttonHover),
        '--dsw-alias-state-business-primary': rgbToHex(accent),
        '--dsw-alias-state-business-tertiary': rgbToHex(businessTertiary),
        '--dsw-specific-sidebar-nav-item-active': rgbToHex(navActive),
        '--dsw-specific-sidebar-nav-item-active-accent': rgbToHex(navActiveAccent),
        '--dsw-static-deepseek-500': rgbToHex(accent),
        '--dsw-static-deepseek-200': rgbToHex(shimmerLight),
        '--dsw-static-deepseek-450': rgbToHex(accent),
        '--dsw-specific-bubble': rgbToHex(bubble),
        '--dsw-specific-bubble-highlight': rgbToHex(bubbleHighlight),
        ...deriveExtendedTokens({
          canvas, accent, text, textMuted, dark,
          surfaceRaised, surfaceOverlay, border, input,
          accentForeground, buttonHover,
          error: parseHex(status.error, { r: 236, g: 19, b: 19 }),
          warn: parseHex(status.warning, { r: 245, g: 158, b: 11 }),
          success: parseHex(status.success, { r: 34, g: 197, b: 94 }),
        }),
      }
    }

    // ---- OKLCH 感知引擎(移植自 t3code createVividThemeColors,用于 VS Code 导入派生) ----


