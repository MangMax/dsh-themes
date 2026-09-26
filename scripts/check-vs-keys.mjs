#!/usr/bin/env node
// 白名单覆盖守卫:确保 shared/vs-colors.ts 的 VS_THEME_COLOR_KEYS
// 覆盖 client/src/vs-import.ts 映射逻辑读取的**每一个** VS Code 颜色键。
//
// 为什么需要它:宿主端会把主题压成「只含白名单键」的最小载荷(体积 -96%)。
// 映射器以后新增一个 pick('some.newKey'),而白名单忘了加,导入就会**静默降级**
// 成派生色——不会报错,只会颜色不对。这个脚本机械地从映射源码里提取键并比对,
// 把静默降级变成构建期失败。
//
// 用法:node scripts/check-vs-keys.mjs   (退出码 1 = 有未覆盖的键)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const MAPPER = join(ROOT, 'client/src/vs-import.ts')
const WHITELIST = join(ROOT, 'shared/vs-colors.ts')

/** 从映射源码里抽出 pick/solidOver/readableOn 调用中出现的字符串字面量。 */
function extractReadKeys(source) {
  const keys = new Set()
  const callPattern = /\b(pick|solidOver|readableOn)\s*\(/g
  let match
  while ((match = callPattern.exec(source)) !== null) {
    let depth = 1
    let i = callPattern.lastIndex
    const start = i
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      else if (ch === "'") {
        let j = i + 1
        let lit = ''
        while (j < source.length && source[j] !== "'") {
          if (source[j] === '\\') { lit += source[j + 1]; j += 2; continue }
          lit += source[j]
          j += 1
        }
        // 只收 VS Code workbench 颜色键:可能是 `a.b.c` 形状,也可能是
        // `foreground` / `focusBorder` / `errorForeground` 这类**无点**的键。
        // 排除本地化字典键(`--dsw-*` 用中括号访问,这里不会出现)与含空格的散文。
        if (/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(lit) && lit.length > 2 && !lit.startsWith('--')) keys.add(lit)
        i = j + 1
        continue
      }
      i += 1
    }
    void start
  }
  return keys
}

/** 从白名单源码里抽出 VS_THEME_COLOR_KEYS 数组的字面量。 */
function extractWhitelist(source) {
  const start = source.indexOf('export const VS_THEME_COLOR_KEYS')
  if (start < 0) throw new Error('shared/vs-colors.ts 里找不到 VS_THEME_COLOR_KEYS')
  const open = source.indexOf('[', start)
  const close = source.indexOf('\n]', open)
  if (open < 0 || close < 0) throw new Error('VS_THEME_COLOR_KEYS 数组解析失败')
  const body = source.slice(open, close)
  const keys = []
  for (const m of body.matchAll(/'([^']+)'/g)) keys.push(m[1])
  return keys
}

const mapperSource = readFileSync(MAPPER, 'utf8')
const whitelistSource = readFileSync(WHITELIST, 'utf8')
const used = extractReadKeys(mapperSource)
const whitelist = extractWhitelist(whitelistSource)
const whiteSet = new Set(whitelist)

const duplicates = whitelist.filter((k, i) => whitelist.indexOf(k) !== i)
const missing = [...used].filter((k) => !whiteSet.has(k)).sort()
const unused = whitelist.filter((k) => !used.has(k)).sort()

console.log('映射器读取的 VS Code 颜色键:' + used.size)
console.log('白名单条目:' + whitelist.length)
console.log('白名单中未被映射器直接读取(t3code 同款超集,保留):' + unused.length)
if (unused.length > 0) console.log('  ' + unused.join(', '))

let failed = false
if (missing.length > 0) {
  failed = true
  console.error('\n✘ 以下键被映射器读取但不在白名单里,导入会静默降级:')
  for (const k of missing) console.error('  - ' + k)
}
if (duplicates.length > 0) {
  failed = true
  console.error('\n✘ 白名单存在重复条目:' + duplicates.join(', '))
}
if (used.size < 20) {
  failed = true
  console.error('\n✘ 只从映射器里提取到 ' + used.size + ' 个键,提取逻辑很可能失效了(应 ≥ 20)')
}
if (whitelist.length < used.size) {
  failed = true
  console.error('\n✘ 白名单比映射器读取的键还少')
}

if (failed) process.exit(1)
console.log('\n✔ 白名单完全覆盖映射器读取的所有颜色键')
