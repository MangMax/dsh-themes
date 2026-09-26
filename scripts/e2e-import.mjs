#!/usr/bin/env node
// 端到端导入回归测试(不依赖 DSH 运行时,直接在 node 里驱动构建产物)。
//
// 为什么需要它:导入 Tokyo Night 报「未贡献颜色主题」的根因是
// 「VS Code 主题是 JSONC」+「浅色变体被文件自带的 type:dark 误判」。
// 这两个都是**集成层**缺陷,单测某个函数证明不了链路是通的。
// 本脚本用真实的 enkia.tokyo-night VSIX 跑完整条
// 「下载缓存 → 过滤解压 → 宽松解析 → include 合并 → 白名单压缩 → 客户端映射」
// 链路,并打印可核对的证据。
//
// 用法:
//   export PATH=/Users/mang/.nvm/versions/node/v24.18.0/bin:$PATH
//   /Users/mang/AI/Deepseek/dsh-linear/node_modules/.bin/vp pack   # 先构建
//   node scripts/e2e-import.mjs
//
// 退出码 0 = 全部通过;1 = 有失败(逐条打印)。
//
// 注意:本脚本需要网络。冷缓存用例在网络不可用时**硬失败**而不是静默跳过——
// 「静默跳过」正是当初让冷缓存缺陷溜过去的盲点(见下方冷缓存用例的注释)。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { createRequire, register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = join(ROOT, 'dist/host/index.cjs')

let failures = 0
let checks = 0
const ok = (label, extra = '') => { checks += 1; console.log('  ✔ ' + label + (extra ? '  ' + extra : '')) }
const bad = (label, extra = '') => { checks += 1; failures += 1; console.log('  ✘ ' + label + (extra ? '  ' + extra : '')) }
const check = (cond, label, extra = '') => (cond ? ok(label, extra) : bad(label, extra))
const section = (title) => console.log('\n── ' + title)

// ─────────────────────────────────────────────────────────────
// 1. 把构建产物按「插件函数体」加载(与 scripts/install.sh 的加载方式一致)
// ─────────────────────────────────────────────────────────────
if (!existsSync(HOST_BUNDLE)) {
  console.error('缺少 dist/host/index.cjs,请先运行 vp pack')
  process.exit(1)
}

/** 假 ctx:只实现本插件用到的最小面(fs + connection.fetch.register + effect)。 */
function makeCtx() {
  const routes = new Map()
  const nodeFs = createRequire(import.meta.url)('node:fs')
  const fakeFs = {
    async resolve(p, opts) {
      const cwd = opts && opts.cwd ? opts.cwd : process.cwd()
      return resolvePath(cwd, p)
    },
    async stat(p) {
      try {
        const st = nodeFs.statSync(p)
        return { type: st.isDirectory() ? 'directory' : 'file' }
      } catch { return undefined }
    },
    async listDir(p) {
      try {
        return nodeFs.readdirSync(p, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' }))
      } catch { return [] }
    },
    async readText(p) { return nodeFs.readFileSync(p, 'utf8') },
  }
  return {
    routes,
    get(name) { return name === 'fs' ? fakeFs : undefined },
    effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route.fetch)
          return () => routes.delete(route.path)
        },
      },
    },
  }
}

const ctx = makeCtx()
const hostSource = readFileSync(HOST_BUNDLE, 'utf8')
const plugin = new Function('require', hostSource)(createRequire(import.meta.url))
plugin.apply(ctx)

const route = ctx.routes.get('/api/dsh-themes')
if (typeof route !== 'function') {
  console.error('插件未注册 /api/dsh-themes 路由')
  process.exit(1)
}

let rpcSeq = 0
async function rpc(method, args) {
  rpcSeq += 1
  const request = new Request('http://127.0.0.1/api/dsh-themes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-' + rpcSeq, payload: { method, args } }),
  })
  const response = await route(request)
  const body = await response.json()
  return body.result
}

// ─────────────────────────────────────────────────────────────
// 2. 客户端映射半区(纯逻辑)
//    用 node 自带的类型擦除 + scripts/ts-import-hook.mjs 直接 import .ts,
//    不再现场调打包器 —— rolldown 只是 tsdown 的传递依赖,pnpm 不保证在每个
//    平台上都生成它的 .bin 入口(CI/ubuntu 上就 ENOENT,本地 macOS 却有)。
// ─────────────────────────────────────────────────────────────
const work = join(tmpdir(), 'dsh-themes-e2e')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
let parseVsCodeTheme = null
try {
  register('./scripts/ts-import-hook.mjs', pathToFileURL(ROOT + '/'))
  parseVsCodeTheme = (await import('file://' + join(ROOT, 'client/src/vs-import.ts'))).parseVsCodeTheme
  ok('客户端映射模块加载成功(直接 import .ts)')
} catch (e) {
  bad('客户端映射模块加载失败', String(e && e.message ? e.message : e).slice(0, 200))
}

// ─────────────────────────────────────────────────────────────
// 3. JSONC 解析(经真实 RPC read-theme-file)
// ─────────────────────────────────────────────────────────────
section('JSONC 宽松解析(read-theme-file)')
const tmpThemeDir = join(work, 'themes')
mkdirSync(tmpThemeDir, { recursive: true })

async function importLocalTheme(fileName, content, uiTheme) {
  const p = join(tmpThemeDir, fileName)
  writeFileSync(p, content)
  return rpc('read-theme-file', { path: p, uiTheme: uiTheme || '' })
}

const base = (colors) => JSON.stringify({ name: 'T', type: 'dark', colors })

// 3.1 行注释 + 尾随逗号(Tokyo Night 的真实形态)
{
  const text = `{
    "name": "Commented",
    "type": "dark",
    "colors": {
        "editor.background": "#1a1b26",
        //"activityBar.activeBorder": "#3b3e52",
        "editor.foreground": "#c0caf5", // 尾注
    },
  }`
  const res = await importLocalTheme('comments.json', text)
  check(res && res.ok, '行注释 + 尾随逗号可解析', res && res.ok ? '' : JSON.stringify(res && res.error))
  check(res && res.ok && res.value.theme.colors['editor.background'] === '#1a1b26', '画布色正确取到')
  check(res && res.ok && res.value.theme.colors['editor.foreground'] === '#c0caf5', '注释掉的键被忽略、保留键有效')
}

// 3.2 `//` 出现在字符串值里(朴素的「正则去注释」实现会在这里出错)
{
  const text = base({ 'editor.background': '#101010', 'textLink.foreground': '#ff0000' })
    .replace('"type": "dark"', '"type": "dark", "$schema": "https://example.com//deep//a.json"')
  const res = await importLocalTheme('url-in-string.json', text)
  check(res && res.ok, '字符串内的 // 不被当作注释', res && res.ok ? '' : JSON.stringify(res && res.error))
}

// 3.3 块注释
{
  const text = '{\n "type": "dark",\n /* 块注释 */ "colors": { "editor.background": "#202020" }\n}'
  const res = await importLocalTheme('block.json', text)
  check(res && res.ok && res.value.theme.colors['editor.background'] === '#202020', '块注释可解析')
}

// 3.4 UTF-8 BOM
{
  const text = '\ufeff' + base({ 'editor.background': '#303030' })
  const res = await importLocalTheme('bom.json', text)
  check(res && res.ok && res.value.theme.colors['editor.background'] === '#303030', '带 BOM 的主题可解析')
}

// 3.5 真·坏 JSON 仍必须失败(不能把错误吞掉)
{
  const res = await importLocalTheme('broken.json', '{ "colors": { not json } }')
  check(res && res.ok === false && res.error && res.error.code === 'read.parse-failed', '非法 JSON 报 read.parse-failed',
    res && res.error ? res.error.code : '')
}

// 3.6 缺 editor.background → read.no-background
{
  const res = await importLocalTheme('nobg.json', base({ 'editor.foreground': '#fff' }))
  check(res && res.ok === false && res.error.code === 'read.no-background', '缺画布色报 read.no-background',
    res && res.error ? res.error.code : '')
}

// 3.7 include 继承(两层,且基类也带注释)
{
  writeFileSync(join(tmpThemeDir, 'base.json'), '{\n // base\n "type": "dark",\n "colors": { "editor.background": "#0b0b0b" }\n}')
  const res = await importLocalTheme('child.json', JSON.stringify({ include: './base.json', colors: { 'editor.foreground': '#eee' } }))
  check(res && res.ok && res.value.theme.colors['editor.background'] === '#0b0b0b' && res.value.theme.colors['editor.foreground'] === '#eee',
    'include 继承 + 覆盖生效', res && res.ok ? '' : JSON.stringify(res && res.error))
}

// 3.8 循环 include 不挂死
{
  writeFileSync(join(tmpThemeDir, 'loop-a.json'), JSON.stringify({ include: './loop-b.json', colors: { 'editor.background': '#111' } }))
  writeFileSync(join(tmpThemeDir, 'loop-b.json'), JSON.stringify({ include: './loop-a.json', colors: { 'editor.foreground': '#222' } }))
  const res = await importLocalTheme('loop-main.json', JSON.stringify({ include: './loop-a.json', colors: { 'editor.foreground': '#333' } }))
  check(res && res.ok, '循环 include 被防住(不无限递归)')
}

// 3.9 清单 uiTheme 覆盖文件自带的错误 type
{
  const text = base({ 'editor.background': '#d5d6db', 'editor.foreground': '#343b58' })
  const asDeclared = await importLocalTheme('light-lie.json', text, '')
  const asManifest = await importLocalTheme('light-lie-2.json', text, 'vs')
  check(asDeclared && asDeclared.ok && asDeclared.value.theme.type === 'dark', '无清单提示时沿用文件 type')
  check(asManifest && asManifest.ok && asManifest.value.theme.type === 'light', '清单 uiTheme=vs 覆盖文件的 type:dark')
}

// ─────────────────────────────────────────────────────────────
// 4. 真实 Tokyo Night VSIX 端到端
// ─────────────────────────────────────────────────────────────
section('真实 enkia.tokyo-night VSIX 端到端导入')
// 基线:三个主题文件 JSON 的**最小化**载荷之和(Σ len(JSON.stringify(theme))),
// 即「不裁剪、不丢 tokenColors」时客户端要收到的字节数。独立测量值 117679。
// 用它作为分母,断言压缩后的载荷至少小一个数量级。
const FULL_FIDELITY_BASELINE_BYTES = 117679
const cachedVsix = join(tmpdir(), 'dsh-themes', 'enkia.tokyo-night', '1.1.2', 'ext.vsix')
const DOWNLOAD_URL = 'https://open-vsx.org/api/enkia/tokyo-night/1.1.2/file/enkia.tokyo-night-1.1.2.vsix'
const useCache = existsSync(cachedVsix)
if (!useCache) console.log('  (未找到本地 VSIX 缓存,本次走真实网络下载)')

const t0 = Date.now()
const installed = await rpc('install-open-vsx', {
  namespace: 'enkia',
  name: 'tokyo-night',
  downloadUrl: DOWNLOAD_URL,
  version: '1.1.2',
})
const elapsed = Date.now() - t0

if (!installed || !installed.ok) {
  bad('install-open-vsx 成功', JSON.stringify(installed && installed.error))
} else {
  ok('install-open-vsx 成功', (useCache ? '[缓存命中]' : '[网络下载]') + ' ' + elapsed + 'ms')
  check(installed.value.cached === useCache, 'cached 标志与来源一致', 'cached=' + installed.value.cached)
  const themes = installed.value.themes || []
  check(themes.length === 3, '解出 3 个主题', '得到 ' + themes.length)

  const byLabel = Object.fromEntries(themes.map((t) => [t.label, t.theme]))
  check(!!byLabel['Tokyo Night'], '包含 Tokyo Night')
  check(!!byLabel['Tokyo Night Storm'], '包含 Tokyo Night Storm')
  check(!!byLabel['Tokyo Night Light'], '包含 Tokyo Night Light')

  for (const t of themes) {
    const bg = t.theme && t.theme.colors && t.theme.colors['editor.background']
    check(typeof bg === 'string' && /^#[0-9a-f]{3,8}$/i.test(bg), '「' + t.label + '」画布色有效', String(bg))
  }

  // 上游 bug:Tokyo Night Light 文件里写的是 type:"dark",只有清单 uiTheme:"vs" 说得对
  check(byLabel['Tokyo Night'] && byLabel['Tokyo Night'].type === 'dark', 'Tokyo Night 判为深色')
  check(byLabel['Tokyo Night Storm'] && byLabel['Tokyo Night Storm'].type === 'dark', 'Tokyo Night Storm 判为深色')
  check(byLabel['Tokyo Night Light'] && byLabel['Tokyo Night Light'].type === 'light', 'Tokyo Night Light 判为浅色(清单 uiTheme 覆盖文件 type)')

  // tokenColors 必须被丢掉,只留白名单键
  for (const t of themes) {
    const c = t.theme.colors
    check(!('tokenColors' in t.theme) && !('semanticTokenColors' in t.theme), '「' + t.label + '」不含 tokenColors 等重载荷')
    check(Object.keys(c).length > 10 && Object.keys(c).length < 60, '「' + t.label + '」颜色键已白名单裁剪', Object.keys(c).length + ' 键')
  }

  const payload = JSON.stringify(installed.value)
  check(payload.length < 8000, 'RPC 载荷显著缩小', payload.length + ' 字节 vs 未压缩基线 ' + FULL_FIDELITY_BASELINE_BYTES + ' 字节')
  check(payload.length * 20 < FULL_FIDELITY_BASELINE_BYTES, '压缩后小于基线的 1/20',
    (100 * payload.length / FULL_FIDELITY_BASELINE_BYTES).toFixed(2) + '% 于基线')

  // 4.1 压缩载荷喂给客户端映射器:必须能产出完整 token 表
  if (parseVsCodeTheme) {
    const dark = parseVsCodeTheme(byLabel['Tokyo Night'])
    const light = parseVsCodeTheme(byLabel['Tokyo Night Light'])
    check(dark.appearance === 'dark', '映射器:Tokyo Night → dark')
    check(light.appearance === 'light', '映射器:Tokyo Night Light → light')
    check(Object.keys(dark.dark).length >= 95, '映射器输出完整 token 表', Object.keys(dark.dark).length + ' 个 token')
    check(dark.dark['--dsw-alias-bg-base'] === byLabel['Tokyo Night'].colors['editor.background'], 'bg-base 等于主题画布色',
      dark.dark['--dsw-alias-bg-base'])
    check(typeof dark.dark['--dsw-alias-label-primary'] === 'string' && /^#/.test(dark.dark['--dsw-alias-label-primary']), '文字主色为十六进制')
    // 白名单必须覆盖映射器读取的所有键:抽查几个非画布键确实被用上了
    check(dark.dark['--dsw-alias-brand-primary'] !== dark.dark['--dsw-alias-bg-base'], '强调色来自 button/focusBorder 而非画布色')
  }
}

// 4.1 冷缓存(首次导入):用与上面不同的 version 让缓存键落在全新目录上。
// 这条用例是回归防线:曾经把「bytes === null 时先下载」那一步漏掉,导致
// 冷缓存下解压拿到 null、报 install.bad-zip,而且缓存永远建不起来——
// 而只跑缓存命中的用例完全发现不了。
{
  const COLD_VERSION = 'e2e-cold-cache'
  const coldDir = join(tmpdir(), 'dsh-themes', 'enkia.tokyo-night', COLD_VERSION)
  rmSync(coldDir, { recursive: true, force: true })
  const t1 = Date.now()
  const cold = await rpc('install-open-vsx', { namespace: 'enkia', name: 'tokyo-night', downloadUrl: DOWNLOAD_URL, version: COLD_VERSION })
  const coldMs = Date.now() - t1
  if (!cold || !cold.ok) {
    bad('冷缓存(无本地 VSIX)也能下载并导入', JSON.stringify(cold && cold.error))
  } else {
    ok('冷缓存(无本地 VSIX)也能下载并导入', coldMs + 'ms')
    check(cold.value.cached === false, '冷缓存标记 cached=false')
    check((cold.value.themes || []).length === 3, '冷缓存下载后解出 3 个主题', '得到 ' + (cold.value.themes || []).length)
    check(existsSync(join(coldDir, 'ext.vsix')), '冷缓存下载后写入了字节缓存')
    const warm = await rpc('install-open-vsx', { namespace: 'enkia', name: 'tokyo-night', downloadUrl: DOWNLOAD_URL, version: COLD_VERSION })
    check(warm && warm.ok && warm.value.cached === true, '同一版本再来一次命中刚建立的缓存')
  }
  rmSync(coldDir, { recursive: true, force: true })
}

// 4.2 重复导入应命中字节缓存(第二次更快,且 cached=true)
{
  const again = await rpc('install-open-vsx', { namespace: 'enkia', name: 'tokyo-night', downloadUrl: DOWNLOAD_URL, version: '1.1.2' })
  check(again && again.ok && again.value.cached === true, '重复导入命中 VSIX 字节缓存')
}

// ─────────────────────────────────────────────────────────────
// 5. 其他协议面
// ─────────────────────────────────────────────────────────────
section('协议面')
{
  const scan = await rpc('scan-vscode-themes', { root: join(tmpThemeDir, '..') })
  check(scan && scan.ok && Array.isArray(scan.value.themes), 'scan-vscode-themes 正常返回')
}
{
  const s = await rpc('search-open-vsx', { query: 'tokyo night' })
  if (s && s.ok) {
    check(Array.isArray(s.value.list), 'search-open-vsx 返回列表', s.value.list.length + ' 项')
    check(s.value.list.length > 0, '搜索结果非空(否则下面的缓存断言没有意义)', s.value.list.length + ' 项')
    const cached = await rpc('search-open-vsx', { query: 'tokyo night' })
    check(cached && cached.ok && cached.value.list.length > 0 && cached.value.list.length === s.value.list.length,
      '搜索结果 TTL 缓存命中', (cached && cached.ok ? cached.value.list.length : '?') + ' 项')
    const items = s.value.list.slice(0, 3).map((e) => ({ namespace: e.namespace, name: e.name }))
    if (items.length > 0) {
      const d = await rpc('open-vsx-details', { items })
      check(d && d.ok && d.value.details && Object.keys(d.value.details).length > 0, 'open-vsx-details 批量详情返回', Object.keys(d.value.details || {}).length + ' 项')
    }
  } else {
    console.log('  ⚠ 网络不可用,跳过 Open VSX 搜索检查:' + JSON.stringify(s && s.error))
  }
}
{
  const missing = await rpc('read-theme-file', { path: '' })
  check(missing && missing.ok === false && missing.error.code === 'read.no-path', '空路径报 read.no-path')
  const unknown = await rpc('no-such-method', {})
  check(unknown && unknown.ok === false && unknown.error.code === 'unknown-method', '未知方法报 unknown-method')
}

console.log('\n' + (failures === 0 ? '✔ 全部通过' : '✘ 失败 ' + failures + ' 项') + '  (' + checks + ' 项检查)')
process.exit(failures === 0 ? 0 : 1)
