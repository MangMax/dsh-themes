// VS Code 主题的「颜色键白名单」与压缩载荷。
//
// 背景(参考 t3code 的 vscodeThemeImport):
//   VS Code 主题 JSON 的体积几乎全在 `tokenColors` / `semanticTokenColors` 上,
//   `colors` 本身也有 350+ 个 workbench 键,而本插件映射到 DSH token 时
//   只用其中几十个。t3code 在导入时用一个固定白名单把主题压成「只为调色板服务」
//   的最小载荷(见其 `Xi`:仅保留已知键,值必须为字符串且长度受限)。
//
// 实测 enkia.tokyo-night 三个主题文件(最小化 JSON 的 Σ 字节数):
//   完整 117,679 → 仅 colors 43,156 → 白名单后 4,412(减少 96.25%)。
// RPC 报文的序列化/解析、客户端的二次 JSON.parse、以及持久化到
// ~/.dsh/dsh-themes.json 的数据量都随之下降,这是导入提速的主要来源之一。
//
// ⚠️ 白名单必须覆盖 client/src/vs-import.ts 里所有 pick/solidOver/readableOn
// 读取的键,否则导入会静默降级为派生色。scripts/check-vs-keys.mjs 会机械地
// 从映射源码中提取键并与本表比对,防止后续改动漏加。
export const VS_THEME_COLOR_KEYS = [
  // ---- 画布 / 前景(vs-import 的 canvas / text / textMuted)----
  'editor.background',
  'editorPane.background',
  'editor.foreground',
  'foreground',
  'descriptionForeground',
  'disabledForeground',
  'icon.foreground',

  // ---- 品牌 / 强调(accent)----
  'focusBorder',
  'button.background',
  'button.foreground',
  'textLink.foreground',
  'activityBarBadge.background',
  'progressBar.background',
  'badge.background',

  // ---- 表面层级 ----
  'editorWidget.background',
  'dropdown.background',
  'dropdown.border',
  'menu.background',
  'quickInput.background',
  'panel.background',
  'terminal.background',
  'sideBar.background',
  'sideBar.border',
  'sideBar.foreground',
  'activityBar.background',
  'input.background',
  'input.border',
  'input.placeholderForeground',
  'textCodeBlock.background',

  // ---- 边框 ----
  'panel.border',
  'editorGroup.border',
  'contrastBorder',

  // ---- 交互反馈 ----
  'list.hoverBackground',
  'list.activeSelectionBackground',
  'list.inactiveSelectionBackground',

  // ---- 状态 ----
  'editorError.foreground',
  'errorForeground',
  'editorWarning.foreground',

  // ---- 选区 / 光标 / 滚动条(t3code 同款,供派生与前景求解)----
  'editor.selectionBackground',
  'editorCursor.foreground',
  'terminal.foreground',
  'terminal.selectionBackground',
  'terminalCursor.foreground',
  'scrollbarSlider.background',
]

/** 白名单查找表。 */
export const VS_THEME_COLOR_KEY_SET = new Set(VS_THEME_COLOR_KEYS)

/** 颜色值长度上限:超出视为脏数据丢弃(与 t3code 的 128 上限同量级)。 */
const MAX_VALUE_LENGTH = 256

/**
 * 是否像 VS Code 颜色主题:有 colors 且键带点(workbench 命名空间),或有 tokenColors。
 * (对应 t3code 的 `ei`)
 */
export function looksLikeVsTheme(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  if (Array.isArray(raw.tokenColors)) return true
  const colors = raw.colors
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return false
  for (const key of Object.keys(colors)) {
    if (key.indexOf('.') >= 0) return true
  }
  return false
}

/**
 * `contributes.themes[].uiTheme` → 主题明暗(id 语义与 VS Code 一致)。
 * 这是**权威**信号:t3code 用它覆盖主题文件里的 `type`。
 * 例:enkia.tokyo-night 的 Tokyo Night Light 文件里写的是 `"type": "dark"`,
 * 只有清单里的 `uiTheme: "vs"` 能揭示它是浅色主题。
 */
export function appearanceFromUiTheme(uiTheme) {
  if (uiTheme === 'vs') return 'light'
  if (uiTheme === 'vs-dark') return 'dark'
  if (uiTheme === 'hc-black') return 'hc-black'
  if (uiTheme === 'hc-light') return 'hc-light'
  return null
}

/** 压缩后的主题载荷:宿主 → 客户端的唯一主题形状。 */
export interface CompactVsTheme {
  /** 仅白名单内的 workbench 颜色键(值为字符串)。 */
  colors: Record<string, string>
  /** 明暗提示:优先取清单 uiTheme 的规范值,其次主题文件自带的 type。 */
  type?: string
  name?: string
  displayName?: string
}

/**
 * 把 VS Code 主题(含 include 已合并)压成最小载荷。
 * @param raw 已合并 include 的主题 JSON 对象
 * @param uiTheme 清单里的 uiTheme(可选,权威明暗来源)
 * @returns 压缩后的主题;输入不是对象时返回 null
 */
export function compactVsTheme(raw, uiTheme?): CompactVsTheme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const colors = {}
  const source = raw.colors && typeof raw.colors === 'object' && !Array.isArray(raw.colors) ? raw.colors : {}
  for (const key of Object.keys(source)) {
    if (!VS_THEME_COLOR_KEY_SET.has(key)) continue
    const value = source[key]
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VALUE_LENGTH) continue
    colors[key] = value
  }
  const out: CompactVsTheme = { colors }
  const fromManifest = appearanceFromUiTheme(uiTheme)
  if (fromManifest !== null) out.type = fromManifest
  else if (typeof raw.type === 'string' && raw.type.length > 0) out.type = raw.type
  if (typeof raw.name === 'string' && raw.name.length > 0) out.name = raw.name
  if (typeof raw.displayName === 'string' && raw.displayName.length > 0) out.displayName = raw.displayName
  return out
}
