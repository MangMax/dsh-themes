// 容错 JSON 解析(JSONC)。
//
// VS Code 主题文件几乎都是 JSONC:带 `//`、`/* */` 注释与尾随逗号,
// 因为 VS Code 用 JSONC 解析器读取它们。严格 JSON.parse 会直接抛错——
// 这正是导入 Tokyo Night 报「未贡献颜色主题」的根因:
// enkia.tokyo-night 扩展内 3 个主题文件全部含 `//` 注释,
// 宿主端 install-open-vsx 逐个 JSON.parse 全部失败 → themes 为空 →
// 客户端显示 noColorThemes。
//
// 实现与 t3code 的 vscodeThemeImport 一致(t3code 用同一套 jsonc-parser):
//   parse(text, errors, { allowTrailingComma: true })
// 注释默认即被接受(jsonc-parser 的 disallowComments 默认为 false)。
// 刻意指向 ESM 构建:jsonc-parser 的 package.json 里 `main` 是 UMD 产物
// (`define([...'./impl/format'...])` + 内部 require),打包器按 main 解析时会把
// UMD 包装一起带进来,运行期再抛 `Cannot find module './impl/format'`。
// ESM 入口是纯 ESM 的静态 import,打包器能完整内联。
import { parse } from 'jsonc-parser/lib/esm/main.js'

/** UTF-8 BOM:VS Code 生态的 JSON 文件常见,jsonc-parser 不识别,先剥掉。 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * 宽松解析:接受注释与尾随逗号。
 * @returns 解析成功时返回值(可为 null/原始标量);任何语法错误返回 null。
 */
export function tryParseJson<T = any>(text): T | null {
  if (typeof text !== 'string') return null
  const src = stripBom(text)
  if (src.trim().length === 0) return null
  const errors = []
  const value = parse(src, errors, { allowTrailingComma: true })
  if (errors.length > 0) return null
  return value === undefined ? null : (value as T)
}

/**
 * 严格语义的宽松解析:解析失败时抛出带首个错误的说明。
 * @param what 出错信息里的主语(如 `主题文件`)
 */
export function parseJsonOrThrow<T = any>(text, what = 'JSON'): T {
  if (typeof text !== 'string') throw new Error(what + ' 不是字符串')
  const src = stripBom(text)
  if (src.trim().length === 0) throw new Error(what + ' 为空')
  const errors = []
  const value = parse(src, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const first = errors[0]
    throw new Error(what + ' 不是合法 JSON(第 ' + (first.offset + 1) + ' 字节:' + String(first.error) + ')')
  }
  if (value === undefined) throw new Error(what + ' 为空')
  return value as T
}
