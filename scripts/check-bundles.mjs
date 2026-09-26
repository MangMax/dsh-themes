#!/usr/bin/env node
// 产物守卫:检查 dist/client/index.cjs 与 dist/host/index.cjs 的**形状**,
// 而不是源码。有些缺陷只在打包后出现,靠看源码发现不了:
//
//  1. 依赖解析错了入口:jsonc-parser 的 `main` 是 UMD 产物,打包器一旦按 main 解析
//     就会把 AMD 包装与内部 require('./impl/format') 一起带进产物,运行期直接
//     抛 Cannot find module。→ 断言产物里没有 `define.amd`。
//  2. 该 external 的被内联:`@deepseek-ai/dsh-client-ui-primitives` 是
//     __ModuleLoader__ 的 seed word(由外壳提供),必须保留成 require(...) 调用;
//     一旦被内联进产物,体积暴涨且可能拿到第二份 React。→ 断言 require 存在。
//  3. 宿主的函数体里只能出现 node 内置 require。→ 断言宿主产物没有其它裸 require。
//  4. 动画/Toast 是否真的进了客户端产物。
//
// 用法:node scripts/check-bundles.mjs   (退出码 1 = 有失败)
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'dist/client/index.cjs')
const HOST = join(ROOT, 'dist/host/index.cjs')

let failed = 0
let checks = 0
const check = (cond, label, extra = '') => {
  checks += 1
  if (cond) console.log('  ✔ ' + label + (extra ? '  ' + extra : ''))
  else { failed += 1; console.log('  ✘ ' + label + (extra ? '  ' + extra : '')) }
}

for (const [label, file] of [['客户端', CLIENT], ['宿主', HOST]]) {
  if (!existsSync(file)) {
    console.error('缺少 ' + file + ',请先运行 vp pack')
    process.exit(1)
  }
  void label
}

const client = readFileSync(CLIENT, 'utf8')
const host = readFileSync(HOST, 'utf8')

console.log('── 产物形状')
check(!host.includes('define.amd'), '宿主产物未混入 UMD/AMD 包装(jsonc-parser 入口正确)')
check(!client.includes('define.amd'), '客户端产物未混入 UMD/AMD 包装')

// 裸 require:只允许 node 内置(宿主用到)与 seed word(客户端用到)
const bareRequires = (src) => {
  const out = new Set()
  for (const m of src.matchAll(/require\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g)) out.add(m[1])
  return [...out]
}
const hostRequires = bareRequires(host)
const clientRequires = bareRequires(client)
const nodeBuiltin = (id) => id.startsWith('node:') || ['module', 'fs', 'path', 'os', 'crypto', 'util', 'events', 'stream', 'buffer', 'url', 'zlib'].includes(id)
const clientOk = (id) => id === 'react' || id === '@deepseek-ai/dsh-client-ui-primitives'
const badHost = hostRequires.filter((id) => !nodeBuiltin(id))
const badClient = clientRequires.filter((id) => !clientOk(id))
check(badHost.length === 0, '宿主产物的裸 require 只有 node 内置模块', hostRequires.join(', ') || '(无)')
check(badClient.length === 0, '客户端产物的裸 require 只有 seed word', clientRequires.join(', ') || '(无)')

console.log('\n── 客户端:Toast 与动画')
check(client.includes('require("@deepseek-ai/dsh-client-ui-primitives")') || clientRequires.includes('@deepseek-ai/dsh-client-ui-primitives'),
  'Toast 走 seed word require(未被内联)')
check(client.includes('dsth-spin') || client.includes('dsth-'), '内联了 dsth-* 样式')
check(/@keyframes\s+dsth-/.test(client), '包含 dsth 动画关键帧')
check(client.includes('prefers-reduced-motion'), '包含 prefers-reduced-motion 处理')

console.log('\n── 宿主:JSONC 与压缩载荷')
// jsonc-parser 的 ESM 实现里 scanner 有这些可辨识的字符串
check(host.includes('InvalidSymbol') || host.includes('PropertyNameExpected') || host.includes('allowTrailingComma'),
  'jsonc-parser 已内联进宿主产物')
check(client.length > 1000 && host.length > 1000, '两份产物都非空')

console.log('\n' + (failed === 0 ? '✔ 产物形状检查全部通过' : '✘ 失败 ' + failed + ' 项') + '  (' + checks + ' 项检查)')
process.exit(failed === 0 ? 0 : 1)
