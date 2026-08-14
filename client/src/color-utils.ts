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
      }
    }

    // ---- OKLCH 感知引擎(移植自 t3code createVividThemeColors,用于 VS Code 导入派生) ----


