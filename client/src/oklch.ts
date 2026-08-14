// OKLCH 感知引擎(移植自 t3code createVividThemeColors,用于 VS Code 导入派生)
import { luminance, contrastRatio, mixRgb, readableForeground, mutedText, parseHex, rgbToHex, LIGHT_FG, WHITE_FG, BLACK_FG } from './color-utils.js'
export function srgbToLinear(c) {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }


export function linearToSrgb(c) {
      const v = Math.min(1, Math.max(0, c))
      return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255)
    }


export function rgbToOklch(c) {
      const r = srgbToLinear(c.r), g = srgbToLinear(c.g), b = srgbToLinear(c.b)
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
      const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
      const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI }
    }


export function oklchToRgbUnclamped(color) {
      const hr = (color.h * Math.PI) / 180
      const a = color.C * Math.cos(hr), bb = color.C * Math.sin(hr)
      const l = Math.pow(color.L + 0.3963377774 * a + 0.2158037573 * bb, 3)
      const m = Math.pow(color.L - 0.1055613458 * a - 0.0638541728 * bb, 3)
      const s = Math.pow(color.L - 0.0894841775 * a - 1.291485548 * bb, 3)
      return {
        r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      }
    }


export function mapToSrgbGamut(color) {
      const inGamut = (C) => {
        const lin = oklchToRgbUnclamped({ ...color, C })
        return lin.r >= -0.0001 && lin.r <= 1.0001 && lin.g >= -0.0001 && lin.g <= 1.0001 && lin.b >= -0.0001 && lin.b <= 1.0001
      }
      if (inGamut(color.C)) return color
      let low = 0, high = color.C
      const steps = Math.max(1, Math.ceil(Math.log2(Math.max(color.C, 1e-6) / 1e-6)))
      for (let i = 0; i < steps; i += 1) {
        const mid = (low + high) / 2
        if (inGamut(mid)) low = mid
        else high = mid
      }
      return { ...color, C: low }
    }


export function oklchToRgb(color) {
      const lin = oklchToRgbUnclamped(mapToSrgbGamut(color))
      return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b) }
    }


export function oklchToHex(color) {
      return rgbToHex(oklchToRgb(color))
    }


export function solveOklchLightness(base, against, minContrast, direction) {
      let low = direction === 'lighter' ? base.L : 0
      let high = direction === 'lighter' ? 1 : base.L
      let candidate = { ...base }
      if (contrastRatio(oklchToRgb(candidate), against) >= minContrast) return candidate
      for (let step = 0; step < 18; step += 1) {
        const mid = (low + high) / 2
        candidate = { ...base, L: mid }
        if (contrastRatio(oklchToRgb(candidate), against) >= minContrast) {
          if (direction === 'lighter') high = mid
          else low = mid
        } else {
          if (direction === 'lighter') low = mid
          else high = mid
        }
      }
      return { ...base, L: direction === 'lighter' ? high : low }
    }

    /** 由两个种子派生完整 token 调色板:表面沿感知均匀的亮度斜坡携带 accent 色相(受 t3code createVividThemeColors 启发)。 */

export function createVividColors(appearance, bgSeed, accentSeed) {
      const dark = appearance === 'dark'
      const canvasRgb = parseHex(bgSeed, dark ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 })
      const accentRgb = parseHex(accentSeed, { r: 168, g: 67, b: 112 })
      const canvas = rgbToOklch(canvasRgb)
      const accent = rgbToOklch(accentRgb)
      const isDark = luminance(canvasRgb) < 0.179
      const hue = accent.C < 0.02 ? canvas.h : accent.h
      const tintC = Math.min(0.045, Math.max(0.008, accent.C * 0.22))
      const step = isDark ? 1 : -1
      const surfaceAt = (deltaL, chroma) => ({
        L: Math.min(0.98, Math.max(0.05, canvas.L + step * deltaL)),
        C: chroma !== undefined ? chroma : tintC,
        h: hue,
      })
      const toHex = (color) => oklchToHex(color)
      const textBase = { L: isDark ? 0.95 : 0.2, C: Math.min(0.035, accent.C * 0.25), h: hue }
      const text = solveOklchLightness(textBase, canvasRgb, 7, isDark ? 'lighter' : 'darker')
      const textRgb = oklchToRgb(text)
      const textMutedRgb = mutedText(canvasRgb, textRgb)
      const action = {
        L: Math.min(0.85, Math.max(0.35, accent.L + (isDark ? 0.06 : -0.02))),
        C: Math.max(accent.C * 0.9, 0.06),
        h: (hue + 50) % 360,
      }
      const actionHover = { ...action, L: action.L + (isDark ? 0.06 : -0.06) }
      const sidebar = surfaceAt(0.045, tintC * 1.4)
      const sidebarRgb = oklchToRgb(sidebar)
      const surfaceRaised = surfaceAt(0.05)
      const surfaceOverlay = surfaceAt(0.075)
      const border = surfaceAt(isDark ? 0.16 : 0.12, Math.min(0.07, accent.C * 0.35))
      const input = surfaceAt(isDark ? 0.21 : 0.16, Math.min(0.08, accent.C * 0.4))
      const accentSurface = surfaceAt(isDark ? 0.13 : 0.08, Math.min(0.11, accent.C * 0.55))
      const messageSurface = surfaceAt(isDark ? 0.16 : 0.1, Math.min(0.13, accent.C * 0.6))
      const foregroundOn = (surfaceRgb) => oklchToHex(solveOklchLightness(textBase, surfaceRgb, 4.6, isDark ? 'lighter' : 'darker'))
      const navActive = mixRgb(sidebarRgb, accentRgb, isDark ? 0.24 : 0.18)
      const navActiveAccent = mixRgb(sidebarRgb, accentRgb, isDark ? 0.16 : 0.12)
      const accentForeground = readableForeground(accentRgb)
      const hoverMix = accentForeground === LIGHT_FG || accentForeground === WHITE_FG ? BLACK_FG : WHITE_FG
      const buttonHover = mixRgb(accentRgb, hoverMix, 0.12)
      const shimmerLight = mixRgb(accentRgb, WHITE_FG, 0.65)
      const status = statusColors(canvasRgb)
      return {
        '--dsw-alias-bg-base': toHex(canvas),
        '--dsw-alias-bg-layer-1': toHex(surfaceAt(0.015)),
        '--dsw-alias-bg-layer-2': toHex(surfaceRaised),
        '--dsw-alias-bg-overlay': toHex(surfaceOverlay),
        '--dsw-alias-border-l1': toHex(border),
        '--dsw-alias-border-l2': toHex(input),
        '--dsw-alias-brand-primary': rgbToHex(accentRgb),
        '--dsw-alias-label-primary': rgbToHex(textRgb),
        '--dsw-alias-label-secondary': rgbToHex(textMutedRgb),
        '--dsw-alias-state-error-primary': status.error,
        '--dsw-alias-state-warn-primary': status.warning,
        '--dsw-alias-state-success-primary': status.success,
        '--dsw-specific-sidebar-fill': toHex(sidebar),
        '--dsw-alias-button-info-fill': rgbToHex(accentRgb),
        '--dsw-alias-button-info-hover': rgbToHex(buttonHover),
        '--dsw-alias-state-business-primary': rgbToHex(accentRgb),
        '--dsw-alias-state-business-tertiary': toHex(accentSurface),
        '--dsw-specific-sidebar-nav-item-active': rgbToHex(navActive),
        '--dsw-specific-sidebar-nav-item-active-accent': rgbToHex(navActiveAccent),
        '--dsw-static-deepseek-500': rgbToHex(accentRgb),
        '--dsw-static-deepseek-200': rgbToHex(shimmerLight),
        '--dsw-static-deepseek-450': rgbToHex(accentRgb),
        '--dsw-specific-bubble': toHex(messageSurface),
        '--dsw-specific-bubble-highlight': toHex(accentSurface),
      }
    }

    // ---- DSH Chat 调色板(手调字面色值,取自 t3.chat 界面的取色记录) ----


