#!/usr/bin/env node
// 字典守卫:中英文词典必须逐键对齐,且宿主新增的错误码都必须有本地化文案。
//
// 为什么需要它:`errorText()` 用 `error.<code>` 查字典,查不到就原样显示键名
// (界面出现 `error.install.no-themes` 这种字符串)。宿主新增错误码时忘了补字典,
// 只有真的踩到那条错误路径才会暴露——所以放到构建期检查。
//
// 用法:node scripts/check-locales.mjs   (退出码 1 = 有缺口)
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
let checks = 0
const check = (cond, label, extra = '') => {
  checks += 1
  if (cond) console.log('  ✔ ' + label + (extra ? '  ' + extra : ''))
  else { failed += 1; console.log('  ✘ ' + label + (extra ? '  ' + extra : '')) }
}

// locales.ts 没有 import,可以直接被 node 的类型擦除加载
const { ZH_DICT, EN_DICT, LOCALES } = await import('file://' + join(ROOT, 'client/src/locales.ts'))

const zhKeys = Object.keys(ZH_DICT)
const enKeys = Object.keys(EN_DICT)
check(zhKeys.length === enKeys.length, '中英文字典键数一致', zhKeys.length + ' / ' + enKeys.length)
const missingEn = zhKeys.filter((k) => !(k in EN_DICT))
const missingZh = enKeys.filter((k) => !(k in ZH_DICT))
check(missingEn.length === 0, '中文有的键英文也有', missingEn.join(', '))
check(missingZh.length === 0, '英文有的键中文也有', missingZh.join(', '))
check(Object.keys(LOCALES).length === 2 && !!LOCALES.zh && !!LOCALES.en, 'LOCALES 同时导出 zh 与 en')

// 宿主返回的所有错误码都必须能本地化:从 host 源码里机械提取 fail('code', …)
const { readFileSync } = await import('node:fs')
const hostSource = readFileSync(join(ROOT, 'host/src/index.ts'), 'utf8')
const codes = new Set()
for (const m of hostSource.matchAll(/fail\(\s*'([^']+)'/g)) codes.add(m[1])
const unmapped = [...codes].filter((c) => !('error.' + c in ZH_DICT) || !('error.' + c in EN_DICT))
check(codes.size > 10, '从宿主源码提取到错误码', codes.size + ' 个')
check(unmapped.length === 0, '每个宿主错误码都有中英文文案', unmapped.join(', '))

// 占位符一致性:{name} 这类占位符两侧必须相同
const placeholderDiff = []
for (const key of zhKeys) {
  if (!(key in EN_DICT)) continue
  const ph = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',')
  if (ph(ZH_DICT[key]) !== ph(EN_DICT[key])) placeholderDiff.push(key + ' (zh:' + ph(ZH_DICT[key]) + ' en:' + ph(EN_DICT[key]) + ')')
}
check(placeholderDiff.length === 0, '两侧占位符一致', placeholderDiff.join('; '))

console.log('\n' + (failed === 0 ? '✔ 字典检查全部通过' : '✘ 失败 ' + failed + ' 项') + '  (' + checks + ' 项检查)')
process.exit(failed === 0 ? 0 : 1)
