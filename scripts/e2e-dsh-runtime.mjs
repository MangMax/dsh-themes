#!/usr/bin/env node
// DSH 0.2.0 真运行时契约测试:把**构建产物**接到**真实 DSH 运行时**的
// 契约面上跑一遍,证明插件适配的是用户实际在跑的那份 DSH。
//
// 与 scripts/e2e-import.mjs 的分工:
//   e2e-import.mjs  —— 用**假 ctx**跑业务链路(导入/解析/持久化),证明逻辑对;
//   本脚本          —— 用**真 DSH 包**校验契约面(主题服务 API、token 目录、
//                      connection fetch 路由、locale 服务),证明接口对。
// 两者互补:逻辑对但接口漂移,插件一样是坏的(这正是 0.2.0 之前发生的事)。
//
// 检查项(全部读真实 DSH 运行时的 .d.ts / client.js / CSS,不靠人工记忆):
//   A. 主题服务 API:overrideTokens / getTheme / setTheme / on('theme/change') 存在
//   B. 官方 token 目录 vs 插件 CORE_TOKEN_NAMES(必须是同一组)
//   C. 插件覆盖层写的每个 token 都必须是 DSH 认识的 token(不能写错名字)
//   D. connection.fetch.register 契约(精确路由 + methods + requestBody + fetch)
//   E. client locale 服务面(register / bind / subscribe / getLocale)
//   F. seed word 模块导出的每个符号都真实存在(Toast / Icon*)
//   G. 客户端产物只 require 平台已知的 seed word(release 期解析失败会白屏)
//
// 用法:node scripts/e2e-dsh-runtime.mjs   (退出码 0 = 通过)
// 需要先 `pnpm build`。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)

let checks = 0
let failures = 0
const ok = (label, extra = '') => { checks += 1; console.log('  ✔ ' + label + (extra ? '  ' + extra : '')) }
const bad = (label, extra = '') => { checks += 1; failures += 1; console.log('  ✘ ' + label + (extra ? '  ' + extra : '')) }
const check = (cond, label, extra = '') => (cond ? ok(label, extra) : bad(label, extra))
const section = (t) => console.log('\n── ' + t)
const skip = (t) => console.log('  … ' + t)

// ─────────────────────────────────────────────────────────────
// 0. 定位真实 DSH 运行时(与 check-dsh-compat.mjs 同策略)
// ─────────────────────────────────────────────────────────────
function locateDsh() {
  const out = []
  if (process.env.DSH_RUNTIME_DIR) out.push(process.env.DSH_RUNTIME_DIR)
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const p = join(dir, e.name)
      if (e.name === 'dsh' && existsSync(join(p, 'node_modules/@deepseek-ai/dsh-client-ui-theme'))) {
        out.push(join(p, 'node_modules'))
        continue
      }
      if (e.name === '@deepseek-ai' && existsSync(join(p, 'dsh/node_modules/@deepseek-ai/dsh-client-ui-theme'))) {
        out.push(join(p, 'dsh/node_modules'))
        continue
      }
      walk(p, depth + 1)
    }
  }
  const g = join(homedir(), '.vite-plus/js_runtime')
  if (existsSync(g)) walk(g, 0)
  out.push(join(ROOT, 'node_modules'))
  return out.find((r) => existsSync(join(r, '@deepseek-ai/dsh-client-ui-theme/package.json'))) || null
}

const dshRoot = locateDsh()
section('0. 运行时来源')
if (!dshRoot) {
  skip('未找到 DSH 运行时,跳过真运行时契约测试')
  process.exit(0)
}
const pkgOf = (name) => JSON.parse(readFileSync(join(dshRoot, '@deepseek-ai', name, 'package.json'), 'utf8'))
const themePkg = pkgOf('dsh-client-ui-theme')
console.log('  来源: ' + dshRoot)
console.log('  dsh-client-ui-theme: ' + themePkg.version)
const isReal = dshRoot !== join(ROOT, 'node_modules')
console.log('  性质: ' + (isReal ? '真实 DSH 运行时(用户实际在跑的)' : '仓库 node_modules(可能是旧版)'))

/** 读某包的 client 入口源码(插件实际会加载的那份)。 */
const readClient = (name) => {
  const p = join(dshRoot, '@deepseek-ai', name, 'lib/client.js')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

// ─────────────────────────────────────────────────────────────
// A. 主题服务 API 面
// ─────────────────────────────────────────────────────────────
section('A. 主题服务 API(--dsh-client-ui-theme)')
const themeClient = readClient('dsh-client-ui-theme')
if (!themeClient) {
  skip('缺少 dsh-client-ui-theme/lib/client.js')
} else {
  // 插件依赖的四个面:overrideTokens / getTheme / setTheme / theme/change 事件
  check(/overrideTokens\s*\(/.test(themeClient), 'overrideTokens 存在(插件覆盖层的入口)')
  check(/getTheme\s*\(/.test(themeClient), 'getTheme 存在(插件读快照)')
  check(/setTheme\s*\(/.test(themeClient), 'setTheme 存在(插件切明暗/系统)')
  check(/theme\/change/.test(themeClient), "theme/change 事件存在(插件订阅重渲染)")
  // overrideTokens 的第二个参数必须是 {token: {light,dark}} 形状 —— 插件按这个形状传
  check(/light/.test(themeClient) && /dark/.test(themeClient), '覆盖层 light/dark 双值模型存在')
  // 快照里必须真的有 preference 字段(插件读 snapshot.preference 渲染模式按钮)
  const snapshotHasPreference = /preference/.test(themeClient)
  check(snapshotHasPreference, '快照含 preference 字段(插件模式按钮依赖)')
}

// ─────────────────────────────────────────────────────────────
// B. 官方 token 目录 vs 插件 CORE_TOKEN_NAMES
// ─────────────────────────────────────────────────────────────
section('B. 官方核心 token 目录')
const paletteSrc = readFileSync(join(ROOT, 'client/src/palette.ts'), 'utf8')
function arrayBody(name) {
  const start = paletteSrc.indexOf('export const ' + name + ' ')
  if (start < 0) throw new Error('找不到 ' + name)
  const open = paletteSrc.indexOf('[', start)
  let depth = 0
  for (let i = open; i < paletteSrc.length; i += 1) {
    if (paletteSrc[i] === '[') depth += 1
    else if (paletteSrc[i] === ']') { depth -= 1; if (depth === 0) return paletteSrc.slice(open, i + 1) }
  }
  throw new Error(name + ' 未配平')
}
function extractArray(name, seen = new Set()) {
  if (seen.has(name)) return new Set()
  seen.add(name)
  const body = arrayBody(name)
  const out = new Set([...body.matchAll(/'(--dsw-[a-z0-9-]+)'/g)].map((m) => m[1]))
  for (const m of body.matchAll(/\.\.\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) for (const t of extractArray(m[1], seen)) out.add(t)
  return out
}
const oursAll = extractArray('TOKEN_NAMES')
const oursCore = extractArray('CORE_TOKEN_NAMES')

if (!themeClient) {
  skip('缺少 client.js,无法提取官方目录')
} else {
  const s = themeClient.indexOf('const BUILTIN_INSPECT_TOKENS')
  const e = s < 0 ? -1 : themeClient.indexOf('];', s)
  if (s < 0 || e < 0) {
    skip('未找到 BUILTIN_INSPECT_TOKENS')
  } else {
    const official = [...new Set([...themeClient.slice(s, e).matchAll(/name:\s*"(--dsw-[a-z0-9-]+)"/g)].map((m) => m[1]))]
    check(official.length > 0, '解析出官方核心 token 目录', official.length + ' 个')
    const missing = official.filter((t) => !oursCore.has(t))
    check(missing.length === 0, 'CORE_TOKEN_NAMES 覆盖官方目录全部 token',
      missing.length === 0 ? '' : '缺: ' + missing.join(', '))
    const notCovered = official.filter((t) => !oursAll.has(t))
    check(notCovered.length === 0, '官方目录 token 全在 TOKEN_NAMES 覆盖清单',
      notCovered.length === 0 ? '' : '缺: ' + notCovered.join(', '))
  }
}

// ─────────────────────────────────────────────────────────────
// C. 插件覆盖层写的 token 名必须都是 DSH 认识的
//    (写错名字不会报错,只会静默无效 —— 和 state-idle 那类缺陷同源)
// ─────────────────────────────────────────────────────────────
section('C. 覆盖层 token 名有效性')
if (!themeClient) {
  skip('缺少 client.js')
} else {
  // DSH «认识»的 token = 它在自己样式表里**定义**过的(token: value)。
  // 注意不能把「被消费」也算作认识:DSH 有若干 token 是 var(--x) 引用但从未
  // 定义(例如 --dsw-alias-bg-layer-4 / --dsw-alias-label-error /
  // --dsw-alias-separator-primary),它们本来就是靠插件/主题来提供的。
  const defined = new Set()
  for (const m of themeClient.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) defined.add(m[1])

  // 扫描面:DSH 各 UI 包 + 前端产物。CI 上只有 5 个 dsh-client-* 包在场,
  // 因此这里同时记录「哪些在场」,供下方判断证据是否充分(见 fullSurface)。
  const SCAN_SURFACE = ['dsh-client-ui-theme', 'dsh-client-ui-layout', 'dsh-client-ui-primitives',
    'dsh-client-ui-conversation', 'dsh-client-ui-chat', 'dsh-client-ui-tool', 'dsh-client-ui-settings',
    'dsh-client-ui-goal', 'dsh-client-ui-trajectory', 'dsh-web-frontend', 'dsh-client-ui-deliverables',
    'dsh-client-ui-settings-subagent']
  const present = SCAN_SURFACE.filter((e) => existsSync(join(dshRoot, '@deepseek-ai', e)))
  const fullSurface = present.length === SCAN_SURFACE.length

  // 扫描面内被消费的 token(var(--x) 或 var(--x, fallback))
  const consumed = new Set()
  for (const entry of present) {
    const base = join(dshRoot, '@deepseek-ai', entry)
    const walkCss = (dir) => {
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walkCss(p)
        else if (/\.(css|js)$/.test(e.name)) {
          let t = ''
          try { t = readFileSync(p, 'utf8') } catch { continue }
          for (const m of t.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*[,)]/g)) consumed.add(m[1])
        }
      }
    }
    walkCss(base)
  }

  // DEFAULT_PALETTE 里出现的 token 才是插件真正会写进覆盖层的
  const defaultPalette = paletteSrc.slice(paletteSrc.indexOf('export const DEFAULT_PALETTE'))
  const written = new Set([...defaultPalette.matchAll(/'(--dsw-[a-z0-9-]+)'\s*:/g)].map((m) => m[1]))
  check(written.size > 0, 'DEFAULT_PALETTE 解析出待写入 token', written.size + ' 个')

  // 真正的错误:写了一个 DSH 既不定义、也不消费的 token 名(纯粹的错字/臆造)。
  //
  // ⚠ 这个判定依赖「扫描面覆盖了整个 DSH」才成立。CI 上只装了 5 个
  //   dsh-client-* 包(没有 dsh-web-frontend / dsh-client-ui-chat 等),
  //   此时某些 token 会因为「引用它的那个包没装」而显得没人认识 ——
  //   那是扫描面不全,不是插件写错。所以扫描面不全时降级为提示,
  //   只在完整运行时下才硬失败,避免把环境缺包误报成代码缺陷。
  //   (SCAN_SURFACE / present / fullSurface 已在上方计算。)
  const bogus = [...written].filter((t) => !defined.has(t) && !consumed.has(t))
  if (bogus.length === 0) {
    ok('插件写入的 token 名均被 DSH 定义或消费(无臆造名)')
  } else if (fullSurface) {
    bad('插件写入的 token 名均被 DSH 定义或消费(无臆造名)',
      'DSH 既不定义也不消费: ' + bogus.join(', '))
  } else {
    // 扫描面不全:这些名字很可能是被没装的包引用的,不能据此判为缺陷。
    console.log('      ℹ 扫描面不完整(' + present.length + '/' + SCAN_SURFACE.length + ' 个 UI 包在场),'
      + '以下 token 在本机扫描面内未被引用,不能据此判定为臆造名:')
    for (const t of bogus) console.log('      · ' + t)
    console.log('      → 在完整 DSH 运行时(本机全局 dsh 安装)下此项会硬校验')
  }

  // 正向补位:DSH 消费但从不定义的 token,正好是插件应当在覆盖层提供的
  const suppliedGaps = [...written].filter((t) => !defined.has(t) && consumed.has(t))
  if (suppliedGaps.length > 0) {
    console.log('      ℹ 插件补位了 ' + suppliedGaps.length + " 个 DSH 只消费不定义的 token(DSH 自身样式表里没有,靠主题提供):")
    for (const t of suppliedGaps) console.log('      · ' + t)
  }

  // TOKEN_NAMES 与 DEFAULT_PALETTE 必须一致:否则 applyLayers 会写 undefined,
  // 内联 CSS 变量变成空值 → 该 token 回退到 DSH 原生色(静默失效)
  const inNamesNotDefault = [...oursAll].filter((t) => !written.has(t))
  check(inNamesNotDefault.length === 0, 'TOKEN_NAMES 的每个 token 都有默认值(不会写 undefined)',
    inNamesNotDefault.length === 0 ? '' : '无默认值: ' + inNamesNotDefault.join(', '))
}

// ─────────────────────────────────────────────────────────────
// D. connection.fetch 契约
// ─────────────────────────────────────────────────────────────
section('D. connection.fetch.register 契约')
const connTypes = join(dshRoot, '@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts')
if (!existsSync(connTypes)) {
  skip('缺少 dsh-client-connection 类型')
} else {
  const t = readFileSync(connTypes, 'utf8')
  check(/interface HostConnectionFetch/.test(t), 'HostConnectionFetch 存在')
  check(/register\s*\(\s*route:\s*ConnectionFetchRoute/.test(t), 'register(route) 签名存在')
  check(/interface ConnectionFetchRoute/.test(t), 'ConnectionFetchRoute 存在')
  for (const f of ['path', 'methods', 'requestBody', 'fetch']) {
    check(new RegExp('readonly\\s+' + f + '\\b').test(t), 'ConnectionFetchRoute.' + f + ' 字段存在')
  }
  // Host 插件调用 register 时的实参形状必须与之一致
  const hostSrc = readFileSync(join(ROOT, 'host/src/index.ts'), 'utf8')
  check(/connection\.fetch\.register\s*\(/.test(hostSrc), 'host 使用 connection.fetch.register')
  check(/methods:\s*\[\s*'POST'\s*\]/.test(hostSrc), "host 传 methods: ['POST']")
  check(/requestBody:\s*'buffered'/.test(hostSrc), "host 传 requestBody: 'buffered'")
  check(/path:\s*ROUTE_PATH|path:\s*'\/api\/dsh-themes'/.test(hostSrc), 'host 传精确 path')
}

// ─────────────────────────────────────────────────────────────
// E. client locale 服务面
// ─────────────────────────────────────────────────────────────
section('E. client locale 服务面')
const localeClient = readClient('dsh-client-locale')
if (!localeClient) {
  skip('缺少 dsh-client-locale/lib/client.js')
} else {
  for (const fn of ['register', 'bind', 'subscribe']) {
    check(new RegExp(fn + '\\s*\\(').test(localeClient), 'locale.' + fn + ' 存在')
  }
  check(/getLocale\s*\(/.test(localeClient), 'locale.getLocale 存在')
  check(/active/.test(localeClient), 'locale 快照含 active 字段(插件 fmtCount 依赖)')
}

// ─────────────────────────────────────────────────────────────
// F. seed word 模块导出的符号必须真实存在
// ─────────────────────────────────────────────────────────────
section('F. seed word(@deepseek-ai/dsh-client-ui-primitives)导出')
const primTypes = join(dshRoot, '@deepseek-ai/dsh-client-ui-primitives/lib/types')
const iconTypes = join(primTypes, 'icons/index.d.ts')
if (!existsSync(primTypes)) {
  skip('缺少 primitives 类型目录')
} else {
  let primSurface = ''
  const idx = join(primTypes, 'index.d.ts')
  if (existsSync(idx)) primSurface += readFileSync(idx, 'utf8')
  if (existsSync(iconTypes)) primSurface += readFileSync(iconTypes, 'utf8')
  // 插件从 seed word import 的符号(从源码机械提取)
  const sources = ['client/src/index.ts', 'client/src/toast.ts']
    .map((p) => join(ROOT, p)).filter(existsSync).map((p) => readFileSync(p, 'utf8')).join('\n')
  const imported = new Set()
  for (const m of sources.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/g)) {
    for (const sym of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) imported.add(sym)
  }
  check(imported.size > 0, '从源码提取到 seed word 导入符号', [...imported].join(', '))
  const missing = [...imported].filter((sym) => !new RegExp('export\\s+(?:declare\\s+)?(?:const|function|class|type|interface)\\s+' + sym + '\\b').test(primSurface)
    && !new RegExp('export\\s*\\{[^}]*\\b' + sym + '\\b').test(primSurface))
  check(missing.length === 0, 'seed word 导出的符号全部真实存在',
    missing.length === 0 ? '' : '上游不存在: ' + missing.join(', '))
}

// ─────────────────────────────────────────────────────────────
// G. 客户端产物只 require 平台已知模块
// ─────────────────────────────────────────────────────────────
section('G. 客户端产物 require 面')
const clientBundle = join(ROOT, 'dist/client/index.cjs')
if (!existsSync(clientBundle)) {
  skip('缺少 dist/client/index.cjs(先 pnpm build)')
} else {
  const src = readFileSync(clientBundle, 'utf8')
  const reqs = [...new Set([...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))]
  // 平台注入的只有 react 与 seed word;多个 require 会在 factory 里解析失败 → 白屏
  const allowed = new Set(['react', '@deepseek-ai/dsh-client-ui-primitives'])
  const unexpected = reqs.filter((r) => !allowed.has(r))
  check(unexpected.length === 0, '客户端产物只 require 平台注入的模块',
    unexpected.length === 0 ? '' : '未预期: ' + unexpected.join(', '))
  console.log('      require: ' + (reqs.join(', ') || '(无)'))
}

console.log('')
if (failures === 0) {
  console.log('✔ DSH 真运行时契约测试全部通过  (' + checks + ' 项)')
  process.exit(0)
}
console.log('✘ DSH 真运行时契约测试失败  (' + failures + '/' + checks + ' 项)')
process.exit(1)
