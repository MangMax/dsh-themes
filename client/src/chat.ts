// Chat 调色板(手调字面色值,取自 t3.chat 界面的取色记录;颜色保持原样,不冠 DSH 品牌)
import { parseHex, readableForeground, deriveExtendedTokens } from './color-utils.js'
export function chatTokens(mode) {
      const dark = mode === 'dark'
      const base = dark
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
            '--dsw-alias-button-info-fill': '#a3004c',
            '--dsw-alias-button-info-hover': '#a2004c',
            '--dsw-alias-state-business-primary': '#fbd0e8',
            '--dsw-alias-state-business-tertiary': '#37152b',
            '--dsw-specific-sidebar-nav-item-active': '#261922',
            '--dsw-specific-sidebar-nav-item-active-accent': '#463753',
            '--dsw-static-deepseek-500': '#a3004c',
            '--dsw-static-deepseek-200': '#a36691',
            '--dsw-static-deepseek-450': '#a3004c',
            '--dsw-specific-bubble': '#2b2431',
            '--dsw-specific-bubble-highlight': '#362d3d',
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
            '--dsw-alias-button-info-fill': '#db2777',
            '--dsw-alias-button-info-hover': '#c12269',
            '--dsw-alias-state-business-primary': '#db2777',
            '--dsw-alias-state-business-tertiary': '#f3e6f5',
            '--dsw-specific-sidebar-nav-item-active': '#f3e6f5',
            '--dsw-specific-sidebar-nav-item-active-accent': '#eccfe3',
            '--dsw-static-deepseek-500': '#db2777',
            '--dsw-static-deepseek-200': '#f2b3cf',
            '--dsw-static-deepseek-450': '#db2777',
            '--dsw-specific-bubble': '#f7def2',
            '--dsw-specific-bubble-highlight': '#f1c4e6',
          }
      // 扩展 token 由手调核心值按同一派生引擎补齐,保持与其它主题一致的覆盖范围
      const C = (token) => parseHex(base[token], { r: 128, g: 128, b: 128 })
      const accent = C('--dsw-alias-brand-primary')
      return {
        ...base,
        ...deriveExtendedTokens({
          canvas: C('--dsw-alias-bg-base'),
          accent,
          text: C('--dsw-alias-label-primary'),
          textMuted: C('--dsw-alias-label-secondary'),
          dark,
          surfaceRaised: C('--dsw-alias-bg-layer-2'),
          surfaceOverlay: C('--dsw-alias-bg-overlay'),
          border: C('--dsw-alias-border-l1'),
          input: C('--dsw-alias-border-l2'),
          accentForeground: readableForeground(accent),
          buttonHover: C('--dsw-alias-button-info-hover'),
          error: C('--dsw-alias-state-error-primary'),
          warn: C('--dsw-alias-state-warn-primary'),
          success: C('--dsw-alias-state-success-primary'),
        }),
      }
    }

    // ---- VS Code 主题导入(映射逻辑受 t3code vscodeThemeImport 启发) ----


