// 调色板目录:token 清单、DSH 默认外观、内置主题(含默认主题卡片)
import { createManagedColors } from './color-utils.js'
import { chatTokens } from './chat.js'
export const TOKEN_NAMES = [
      '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
      '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
      '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
      '--dsw-alias-state-error-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-success-primary',
      '--dsw-specific-sidebar-fill',
      '--dsw-alias-button-info-fill', '--dsw-alias-button-info-hover',
      '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary',
      '--dsw-specific-sidebar-nav-item-active', '--dsw-specific-sidebar-nav-item-active-accent',
      '--dsw-static-deepseek-500', '--dsw-static-deepseek-200', '--dsw-static-deepseek-450',
      '--dsw-specific-bubble', '--dsw-specific-bubble-highlight',
    ]

    /** 旧版主题库中的核心 token 子集(升级兼容:仅校验这些,缺失的品牌 token 用默认值补齐)。 */

export const CORE_TOKEN_NAMES = [
      '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
      '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
      '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
      '--dsw-alias-state-error-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-success-primary',
      '--dsw-specific-sidebar-fill',
    ]

    /** DSH 内置外观的 token 默认值(明暗混合缺半与旧库补齐时的兜底)。 */

export const DEFAULT_PALETTE = {
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
        '--dsw-alias-button-info-fill': '#4176e6',
        '--dsw-alias-button-info-hover': '#679efe',
        '--dsw-alias-state-business-primary': '#4176e6',
        '--dsw-alias-state-business-tertiary': '#e4edfd',
        '--dsw-specific-sidebar-nav-item-active': '#ebedf2',
        '--dsw-specific-sidebar-nav-item-active-accent': '#e4edfd',
        '--dsw-static-deepseek-500': '#4176e6',
        '--dsw-static-deepseek-200': '#d3e2ff',
        '--dsw-static-deepseek-450': '#5686fe',
        '--dsw-specific-bubble': '#edf3fe',
        '--dsw-specific-bubble-highlight': '#d3e2ff',
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
        '--dsw-alias-button-info-fill': '#679efe',
        '--dsw-alias-button-info-hover': '#4176e6',
        '--dsw-alias-state-business-primary': '#679efe',
        '--dsw-alias-state-business-tertiary': '#34415b',
        '--dsw-specific-sidebar-nav-item-active': '#43454a',
        '--dsw-specific-sidebar-nav-item-active-accent': '#353536',
        '--dsw-static-deepseek-500': '#4176e6',
        '--dsw-static-deepseek-200': '#d3e2ff',
        '--dsw-static-deepseek-450': '#5686fe',
        '--dsw-specific-bubble': '#2c2c2e',
        '--dsw-specific-bubble-highlight': '#43454a',
      },
    }

    /** 内置主题统一为带明/暗变体槽的结构(与导入主题一致)。 */

export const withVariants = (p) => ({
      ...p,
      lightVariants: [{ label: '浅色', tokens: p.light }],
      darkVariants: [{ label: '深色', tokens: p.dark }],
    })

    /** 默认主题 = DSH 原生外观(恢复默认即应用此卡片)。 */

export const DEFAULT_THEME = withVariants({ id: 'dsh-default', label: 'DSH 默认', light: DEFAULT_PALETTE.light, dark: DEFAULT_PALETTE.dark })


export const PALETTES = [
      DEFAULT_THEME,
      withVariants({ id: 'dsh-chat', label: 't3 chat', light: chatTokens('light'), dark: chatTokens('dark') }),
      withVariants({ id: 'grove', label: 'Grove', light: createManagedColors('light', '#f2f8f4', '#19734a'), dark: createManagedColors('dark', '#1d2b24', '#69d69a') }),
      withVariants({ id: 'ocean', label: 'Ocean', light: createManagedColors('light', '#f2f7fb', '#2878b8'), dark: createManagedColors('dark', '#1b2938', '#70b9ee') }),
      withVariants({ id: 'ember', label: 'Ember', light: createManagedColors('light', '#fff6ef', '#c4602f'), dark: createManagedColors('dark', '#30231e', '#f39a62') }),
      withVariants({ id: 'iris', label: 'Iris', light: createManagedColors('light', '#f7f4fc', '#7254b9'), dark: createManagedColors('dark', '#29243b', '#ad92f5') }),
    ]

    // ---- 调色板覆盖层状态 ----


