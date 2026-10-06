#!/usr/bin/env node
// DSH 兼容性守卫:把「插件对 DSH 平台契约的依赖」变成构建期可失败的检查。
//
// 为什么需要它:插件与 DSH 之间有三处**隐式契约**,过去全靠人工比对,
// 每次上游发版都可能静默漂移:
//
//  1. 核心 token 集合 —— plugin 的 CORE_TOKEN_NAMES 是「判定一份主题库是否
//     可用」的必填字段清单。DSH 的 BUILTIN_INSPECT_TOKENS 是官方权威目录。
//     两者必须是同一组:少了任何一个,该 token 就永远不会被主题覆盖。
//     (0.2.0 的真实缺陷:`--dsw-alias-state-idle-primary` 在官方目录里,
//      但不在插件清单里 → StateDot 的 idle 状态恒为 DSH 原生灰。)
//
//  2. UI 实际消费的语义 token —— DSH 各 UI 包 CSS 里 var(--dsw-alias-*) 的
//     并集。插件没覆盖的,主题化后就会露出 DSH 原生色(视觉割裂)。
//
//  3. peerDependencies 版本区间 —— DSH 的插件兼容性门禁据此判定。
//     必须真的能匹配当前已安装/已验证的 DSH 版本,否则插件被判 incompatible。
//
// 数据来源:优先读**真实 DSH 运行时**(npm 上装的那份),而不是本仓库的
// devDependencies —— 前者才是用户实际跑的东西,后者可能落后好几个版本。
// 找不到运行时时退回 node_modules 里的 @deepseek-ai 包;都没有则跳过并说明。
//
// 用法:node scripts/check-dsh-compat.mjs
//       退出码 0 = 全部通过;1 = 有漂移(逐条打印怎么修)。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const PALETTE = join(ROOT, 'client/src/palette.ts')
const PKG = join(ROOT, 'package.json')

let failures = 0
const ok = (label, extra = '') => console.log('  ✔ ' + label + (extra ? '  ' + extra : ''))
const bad = (label, extra = '') => { failures += 1; console.log('  ✘ ' + label + (extra ? '  ' + extra : '')) }
const section = (t) => console.log('\n── ' + t)
const skip = (t) => console.log('  … ' + t)

/**
 * 定位真实 DSH 安装。返回 { root, version, sources } 或 null。
 * 顺序:显式环境变量 → 全局 dsh CLI 自带的 node_modules → 本仓库 node_modules。
 */
function locateDsh() {
  const candidates = []
  if (process.env.DSH_RUNTIME_DIR) candidates.push(process.env.DSH_RUNTIME_DIR)

  // 全局 @deepseek-ai/dsh 包内的 node_modules 是最完整的运行时快照
  const globals = [
    join(homedir(), '.vite-plus/js_runtime'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ]
  for (const g of globals) {
    if (!existsSync(g)) continue
    // js_runtime 下按 node 版本分层,逐层找 lib/node_modules/@deepseek-ai/dsh
    const walk = (dir, depth) => {
      if (depth > 4) return
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const p = join(dir, e.name)
        if (e.name === 'dsh' && existsSync(join(p, 'node_modules/@deepseek-ai/dsh-client-ui-theme'))) {
          candidates.push(join(p, 'node_modules'))
          continue
        }
        if (e.name === '@deepseek-ai' && existsSync(join(p, 'dsh'))) {
          const nm = join(p, 'dsh/node_modules')
          if (existsSync(join(nm, '@deepseek-ai/dsh-client-ui-theme'))) { candidates.push(nm); continue }
        }
        walk(p, depth + 1)
      }
    }
    walk(g, 0)
  }

  candidates.push(join(ROOT, 'node_modules'))

  for (const root of candidates) {
    const themePkg = join(root, '@deepseek-ai/dsh-client-ui-theme/package.json')
    if (existsSync(themePkg)) {
      let version = ''
      try { version = JSON.parse(readFileSync(themePkg, 'utf8')).version } catch { /* ignore */ }
      return { root, version, isRealRuntime: root !== join(ROOT, 'node_modules') }
    }
  }
  return null
}

const dsh = locateDsh()

section('定位 DSH 契约来源')
if (!dsh) {
  skip('未找到任何 DSH 安装(既无全局运行时也无 node_modules/@deepseek-ai)')
  skip('跳过兼容性检查。装好 DSH 或设置 DSH_RUNTIME_DIR 后重跑。')
  process.exit(0)
}
console.log('  来源: ' + dsh.root)
console.log('  版本: ' + (dsh.version || '(未知)') + (dsh.isRealRuntime ? '  [真实运行时]' : '  [仓库 node_modules]'))

// ─────────────────────────────────────────────────────────────
// 从插件源码里抽出 token 清单
// ─────────────────────────────────────────────────────────────
const paletteSrc = readFileSync(PALETTE, 'utf8')

/**
 * 取某个导出数组的源码片段(从 `[` 到配平的 `]`)。
 * 必须做括号配平而不能找第一个 `]`:TOKEN_NAMES 是
 * `[...BASE_TOKEN_NAMES, ...EXTENDED_TOKEN_NAMES]` 这种展开写法,
 * 简单切片会漏掉全部字面量。
 */
function arrayBody(name) {
  const start = paletteSrc.indexOf('export const ' + name + ' ')
  if (start < 0) throw new Error('palette.ts 里找不到 ' + name)
  const open = paletteSrc.indexOf('[', start)
  if (open < 0) throw new Error(name + ' 缺少 [')
  let depth = 0
  for (let i = open; i < paletteSrc.length; i += 1) {
    const ch = paletteSrc[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return paletteSrc.slice(open, i + 1)
    }
  }
  throw new Error(name + ' 的数组没有配平的 ]')
}

/** 解析一个导出数组 → token 集合。展开引用(...OTHER)递归展开,保证不漏。 */
function extractArray(name, seen = new Set()) {
  if (seen.has(name)) return new Set()
  seen.add(name)
  const body = arrayBody(name)
  const out = new Set([...body.matchAll(/'(--dsw-[a-z0-9-]+)'/g)].map((m) => m[1]))
  for (const m of body.matchAll(/\.\.\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    for (const t of extractArray(m[1], seen)) out.add(t)
  }
  return out
}
const oursAll = extractArray('TOKEN_NAMES')
const oursCore = extractArray('CORE_TOKEN_NAMES')

// ─────────────────────────────────────────────────────────────
// 1. 核心 token 集合 vs DSH 官方 BUILTIN_INSPECT_TOKENS
// ─────────────────────────────────────────────────────────────
section('1. 核心 token 集合 vs DSH 官方目录(BUILTIN_INSPECT_TOKENS)')
const themeClient = join(dsh.root, '@deepseek-ai/dsh-client-ui-theme/lib/client.js')
if (!existsSync(themeClient)) {
  skip('找不到 dsh-client-ui-theme/lib/client.js,跳过')
} else {
  const src = readFileSync(themeClient, 'utf8')
  const s = src.indexOf('const BUILTIN_INSPECT_TOKENS')
  const e = s < 0 ? -1 : src.indexOf('];', s)
  if (s < 0 || e < 0) {
    skip('未找到 BUILTIN_INSPECT_TOKENS(上游可能重构了这个内部结构)')
  } else {
    const block = src.slice(s, e)
    const official = [...new Set([...block.matchAll(/name:\s*"(--dsw-[a-z0-9-]+)"/g)].map((m) => m[1]))]
    if (official.length === 0) {
      skip('官方目录解析结果为空,跳过')
    } else {
      const missingCore = official.filter((t) => !oursCore.has(t))
      const extraCore = [...oursCore].filter((t) => !official.includes(t))
      if (missingCore.length === 0 && extraCore.length === 0) {
        ok('CORE_TOKEN_NAMES 与官方目录完全一致  ' + oursCore.size + ' 个')
      }
      if (missingCore.length > 0) {
        bad('官方目录有 ' + missingCore.length + ' 个 token 不在 CORE_TOKEN_NAMES 里')
        for (const t of missingCore) console.log('      + ' + t)
        console.log('      → 这些 token 永远不会被主题覆盖(isValidPalette 不校验它们)')
      }
      // 官方没列但插件多收的:不算错(插件可以更严格),但值得提醒
      if (extraCore.length > 0) {
        console.log('      ℹ CORE_TOKEN_NAMES 额外包含 ' + extraCore.length + ' 个官方未列出的 token(允许):')
        for (const t of extraCore) console.log('      · ' + t)
      }
      // 官方目录必须全部在完整覆盖清单里 —— 否则覆盖层不会写这些 token
      const notCovered = official.filter((t) => !oursAll.has(t))
      if (notCovered.length === 0) {
        ok('官方目录的 token 全部在 TOKEN_NAMES 覆盖清单里')
      } else {
        bad(notCovered.length + ' 个官方核心 token 不在 TOKEN_NAMES 覆盖清单里')
        for (const t of notCovered) console.log('      + ' + t)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 2. DSH UI 实际消费的语义 token 覆盖率
// ─────────────────────────────────────────────────────────────
section('2. DSH UI 实际消费的语义 token 覆盖率')
/** 递归收集目录下所有文件。 */
function walkFiles(dir, out = []) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}
const consumed = new Set()
for (const entry of ['dsh-client-ui-theme', 'dsh-client-ui-layout', 'dsh-client-ui-primitives',
  'dsh-client-ui-conversation', 'dsh-client-ui-chat', 'dsh-client-ui-tool', 'dsh-client-ui-settings',
  'dsh-client-ui-goal', 'dsh-client-ui-trajectory', 'dsh-web-frontend', 'dsh-client-ui-deliverables']) {
  const base = join(dsh.root, '@deepseek-ai', entry)
  if (!existsSync(base)) continue
  for (const f of walkFiles(base)) {
    if (!/\.(css|js)$/.test(f)) continue
    let text = ''
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const m of text.matchAll(/var\(\s*(--dsw-(?:alias|specific)-[a-z0-9-]+)\s*[,)]/g)) consumed.add(m[1])
  }
}
if (consumed.size === 0) {
  skip('未从 UI 包 CSS 中提取到语义 token,跳过')
} else {
  // 只关心「可主题化」的语义别名/专用 token;排除我们有意不覆盖的
  const uncovered = [...consumed].filter((t) => !oursAll.has(t)).sort()
  const covered = consumed.size - uncovered.length
  if (uncovered.length === 0) {
    ok('全部覆盖  ' + covered + '/' + consumed.size)
  } else {
    const pct = ((covered / consumed.size) * 100).toFixed(1)
    bad('有 ' + uncovered.length + ' 个 UI 消费的语义 token 未覆盖(覆盖 ' + covered + '/' + consumed.size + ' = ' + pct + '%)')
    for (const t of uncovered) console.log('      + ' + t)
    console.log('      → 未覆盖的 token 会露出 DSH 原生色,造成主题化后的视觉割裂')
  }
}

// ─────────────────────────────────────────────────────────────
// 3. peerDependencies 版本区间 vs 实际 DSH 版本
// ─────────────────────────────────────────────────────────────
section('3. peerDependencies 兼容区间')
const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const peers = pkg.peerDependencies || {}
const targetRange = peers['@deepseek-ai/dsh-client-ui-theme']
if (!targetRange) {
  bad('package.json 未声明 @deepseek-ai/dsh-client-ui-theme 的 peerDependency')
} else if (!dsh.version) {
  skip('无法确定 DSH 版本,跳过区间校验')
} else {
  // 用与 DSH 门禁**同语义**的判定。DSH 的判定是
  //   semver.satisfies(runtimeVersion, range, { includePrerelease: true })
  // (见 dsh-app-boot 的 evaluatePluginCompatibility)。这里刻意不引入 semver
  // 依赖(它不是本仓库的可解析依赖,硬编码 pnpm 内部路径在 CI 上会挂),
  // 因此自己实现——但必须严格复刻 caret 规则,否则守卫会放过真实的不兼容。
  //
  // caret 上界(关键):`^a.b.c` 允许到「最左侧非零位」不越界
  //   ^0.2.3  → >=0.2.3 <0.3.0    (major=0 且 minor≠0 ⇒ 锁 minor)
  //   ^0.0.3  → >=0.0.3 <0.0.4    (major=0 且 minor=0 ⇒ 锁 patch)
  //   ^1.2.3  → >=1.2.3 <2.0.0
  // 只比 major 是不够的:0.2.0-rc.1 与 0.3.0 的 major 都是 0,
  // 漏掉 minor 上界就会把 0.3.0 误判为兼容。
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim())
    if (!m) return null
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null }
  }
  /** 比较主版本三元组:a<b 返回负,a>b 返回正,相等返回 0。 */
  const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch

  /**
   * 复刻 npm 的「预发布版本是否落在区间内」规则(includePrerelease: true)。
   * 开启 includePrerelease 后,预发布版本可以命中区间的下界,但**不得越过上界**;
   * 且同 [major,minor,patch] 的更高预发布序号视为满足(0.2.0-rc.1 接受 0.2.0-rc.2)。
   */
  const satisfiesCaret = (range, v) => {
    const r = parse(String(range).replace(/^\^/, ''))
    const t = parse(v)
    if (!r || !t) return false
    // 下界:必须 >= 区间基线
    if (cmp(t, r) < 0) return false
    // 上界:按 caret 规则锁到最左侧非零位
    let upper
    if (r.major !== 0) upper = { major: r.major + 1, minor: 0, patch: 0 }
    else if (r.minor !== 0) upper = { major: 0, minor: r.minor + 1, patch: 0 }
    else upper = { major: 0, minor: 0, patch: r.patch + 1 }
    if (cmp(t, upper) >= 0) return false
    // 同三元组时,预发布也算满足(includePrerelease),无需额外排除
    return true
  }
  const ranges = targetRange.split('||').map((s) => s.trim()).filter(Boolean)
  const satisfied = ranges.some((r) => satisfiesCaret(r, dsh.version))
  if (satisfied) {
    ok('peerDependency ' + targetRange + ' 接受当前 DSH ' + dsh.version)
  } else {
    bad('peerDependency ' + targetRange + ' 不接受当前 DSH ' + dsh.version)
    console.log('      → DSH 的插件兼容性门禁会据此判定 incompatible;请扩宽区间')
  }
  // 上界自检:caret 必须锁住 minor,否则 0.3.0 这种「未来次版本」会被误判兼容。
  // 这是一条对守卫自身的测试,防止上面的实现退化成「只比 major」。
  const boundary = [
    ['0.2.0-rc.2', true], ['0.1.7-rc.2', true], ['0.2.1-alpha.1', true],
    ['0.1.4', false], ['0.3.0', false], ['1.0.0', false], ['0.2.0', true],
  ]
  const wrong = boundary.filter(([v, want]) => ranges.some((r) => satisfiesCaret(r, v)) !== want)
  if (wrong.length === 0) {
    ok('caret 上界自检通过(0.3.0 / 1.0.0 被正确拒绝)')
  } else {
    bad('caret 上界自检失败,守卫的区间判定不可信')
    for (const [v, want] of wrong) console.log('      · ' + v + ' 期望 ' + want + ',实际 ' + !want)
  }
}

console.log('')
if (failures === 0) {
  console.log('✔ DSH 兼容性检查全部通过')
  process.exit(0)
}
console.log('✘ DSH 兼容性检查失败(' + failures + ' 项)')
process.exit(1)
