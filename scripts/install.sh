#!/usr/bin/env bash
# 一键构建 + 组装 npm 插件包 + 安装到 DSH profile
# 用法: bash scripts/install.sh [--pack-only]
# 目标 profile:默认 web,可用 DSH_PLUGIN_PROFILE=desktop 等覆盖。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKG_NAME="dsh-themes"
# 版本单一来源:从 package.json 读取。此前这里硬编码,和 package.json 会漂移;
# 自动发版时 tag / package.json / 组装出的包三者版本必须完全一致。
PKG_VER="$(node -p "require('./package.json').version")"
if [ -z "$PKG_VER" ]; then
  echo "错误:无法从 package.json 读取 version" >&2
  exit 1
fi
PROFILE="${DSH_PLUGIN_PROFILE:-web}"
BUILD_DIR="$ROOT/.npm-package/$PKG_NAME"

# vp(vite-plus)解析:优先用本地 devDependency。CI 里没有全局 vp,
# 干净的开发环境也不该依赖全局安装,所以只认 ./node_modules/.bin/vp,
# 退而求其次才用 PATH 上的 vp。
if [ -x "$ROOT/node_modules/.bin/vp" ]; then
  VP="$ROOT/node_modules/.bin/vp"
elif command -v vp >/dev/null 2>&1; then
  VP="vp"
else
  echo "错误:未找到 vp(vite-plus)。请先在项目根目录运行 pnpm install(devDependencies 已声明 vite-plus)" >&2
  exit 1
fi

echo "==> [1/4] vp pack 构建($VP)"
rm -rf dist
"$VP" pack

echo "==> [2/4] 组装插件包 $PKG_NAME@$PKG_VER"
rm -rf .npm-package
mkdir -p "$BUILD_DIR/lib"

# host 产物 -> 以「函数体」语义加载(产物是 var module/exports + return 插件对象的函数体)
cp dist/host/index.cjs "$BUILD_DIR/lib/index.cjs"
cat > "$BUILD_DIR/lib/index.js" <<'EOF'
// dsh-themes host 入口(ESM wrapper):产物按函数体执行,返回值即插件对象。
// 注入 createRequire 产物作为 require:打包器(esbuild/tsdown)的 CJS interop
// 助手(如 require("module"))在纯函数体作用域里没有 require,注入后才能运行。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const src = readFileSync(new URL('./index.cjs', import.meta.url), 'utf8')
const plugin = new Function('require', src)(createRequire(import.meta.url))
export const name = 'dsh-themes'
export const apply = plugin.apply
export const inject = plugin.inject
export const Config = plugin.Config
EOF

# client 产物 -> __ModuleLoader__ 格式:产物自带顶层 return,即 factory 返回值。
# 静态 client 无全局 React:在 factory 顶部注入 seed word require(factory 的
# require 参数由 __ModuleLoader__ 提供,"react" 是平台静态模块表种子词)。
{
  echo "// dsh-themes client 入口(__ModuleLoader__ 格式)"
  echo "window.__ModuleLoader__.load({"
  echo "  id: 'dsh-themes',"
  echo "  factory: (require) => {"
  echo "    const React = require('react');"
  cat "$ROOT/dist/client/index.cjs"
  echo "  }"
  echo "});"
} > "$BUILD_DIR/lib/client.js"

# cordis.patch.yml(声明 bundle patch,安装命令据此把本包加入 dsh.profile.bundles)
cat > "$BUILD_DIR/cordis.patch.yml" <<'EOF'
# dsh-themes bundle patch — 安装命令据此把本包加入 dsh.profile.bundles
- insert:
    - id: dsh-themes
      name: 'dsh-themes'
EOF

# package.json
cat > "$BUILD_DIR/package.json" <<EOF
{
  "name": "$PKG_NAME",
  "version": "$PKG_VER",
  "description": "DSH 外观与主题插件:内置调色板、Open VSX 搜索导入、颜色参数编辑器、明暗独立归属",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "README_EN.md"],
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/MangMax/dsh-themes.git" },
  "homepage": "https://github.com/MangMax/dsh-themes#readme",
  "bugs": { "url": "https://github.com/MangMax/dsh-themes/issues" },
  "publishConfig": { "access": "public" },
  "keywords": ["dsh", "deepseek-harness", "plugin", "theme", "themes", "color", "palette", "appearance"],
  "engines": { "node": ">=22.3.0" },
  "peerDependencies": {},
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-theme"
      ],
      "platform": "web"
    }
  }
}
EOF

# peerDependencies 单一来源:从根 package.json 注入,避免这里硬编码后与根声明漂移
# (DSH 的兼容性门禁读的正是这一份,漂移会直接导致插件被判 incompatible)。
node - "$BUILD_DIR/package.json" "$ROOT/package.json" <<'NODE'
const fs = require('node:fs')
const [target, source] = process.argv.slice(2)
const root = JSON.parse(fs.readFileSync(source, 'utf8'))
const built = JSON.parse(fs.readFileSync(target, 'utf8'))
built.peerDependencies = root.peerDependencies
fs.writeFileSync(target, JSON.stringify(built, null, 2) + '\n')
NODE

# 包内 README:单一真相来源,不再内联硬编码。
#   · 版本事实(peer 区间 / 已验证版本 / UI 语义 token 覆盖数)由根 package.json 的
#     peerDependencies + dshCompat 程序化生成;
#   · 正文(功能 / 使用 / 卸载)从根 README 的 <!-- npm-readme:start --> … <!-- npm-readme:end -->
#     标记区间抽取 —— 根 README 装了仓库开发向内容,不能整份拷进 npm 包。
# 生成前会拿生成的兼容性行逐行核对根 README:根 README 与 package.json 说法不一致
# 就直接失败,从根上杜绝「根 README 和 npm 包 README 各写各的」。
node - "$ROOT" "$BUILD_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const [root, buildDir] = process.argv.slice(2)
const die = (msg) => { console.error('错误:' + msg); process.exit(1) }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const peers = pkg.peerDependencies || {}
const compat = pkg.dshCompat || {}
const peerRange = peers['@deepseek-ai/dsh-client-ui-theme']
const verified = Array.isArray(compat.verified) ? compat.verified : []
const latest = compat.latest
const tokenCount = compat.uiSemanticTokenCount

if (!peerRange) die('根 package.json 缺少 peerDependencies["@deepseek-ai/dsh-client-ui-theme"]')
if (!latest) die('根 package.json 缺少 dshCompat.latest')
if (verified.length === 0) die('根 package.json 缺少 dshCompat.verified')
if (!verified.includes(latest)) die('dshCompat.latest(' + latest + ') 必须出现在 dshCompat.verified 里')

const others = verified.filter((v) => v !== latest)
const enOthers = others.length === 0 ? ''
  : others.length === 1 ? others[0]
    : others.slice(0, -1).join(', ') + ', and ' + others[others.length - 1]

// ── 兼容性列表 = 唯一真相来源。根 README 必须逐行包含这些行(见下方校验)。──
const compatZh = [
  '- 需要 DSH `' + peerRange + '`(通过 `peerDependencies` 声明,DSH 的插件兼容性门禁据此判定)',
  '- 已在 **' + latest + '**(当前最新)' + (others.length ? '、' + others.join('、') : '') + ' 上验证',
  tokenCount ? '- 对 DSH 0.2.0 界面实际消费的 **' + tokenCount + ' 个语义 token 全覆盖**(含 `--dsw-alias-state-idle-primary`),不再露出 DSH 原生色' : null,
  '- 客户端 Toast 使用 DSH 平台 seed word 模块 `@deepseek-ai/dsh-client-ui-primitives`(无需额外安装)',
  '- Host 半区用 `connection.fetch.register` 注册精确 Fetch 路由 `/api/dsh-themes`,由 DSH 自有的 `/api` 前置路由转发并附带 trusted-host 检查与浏览器会话鉴权',
  '- **不需要** 再在 profile 的 `cordis.patch.yml` 里给 `connection` 行补 `inject: [webRuntime, webServer]`(0.1.5 时代的临时绕行补丁,0.1.9 起可删除)',
  '- 构建期守卫 `scripts/check-dsh-compat.mjs`(已接入 `pnpm check`)校验核心 token 集合、UI 语义 token 覆盖率与 `peerDependencies` 区间,防止再次漂移',
].filter(Boolean).join('\n')

const compatEn = [
  '- Requires DSH `' + peerRange + '` (declared through `peerDependencies`, which DSH\'s plugin compatibility gate evaluates)',
  '- Verified on **' + latest + '** (current latest)' + (enOthers ? ', ' + enOthers : ''),
  tokenCount ? '- Full coverage of the **' + tokenCount + ' semantic tokens** DSH 0.2.0\'s UI actually consumes (including `--dsw-alias-state-idle-primary`), so no native DSH colors leak through' : null,
  '- Client toasts use the DSH platform seed-word module `@deepseek-ai/dsh-client-ui-primitives` (nothing extra to install)',
  '- The Host half registers the exact Fetch route `/api/dsh-themes` through `connection.fetch.register`, so DSH\'s own `/api` prefix route forwards it with the trusted-host fence and browser-session authentication attached',
  '- The old `inject: [webRuntime, webServer]` addition on the `connection` row in a profile\'s `cordis.patch.yml` is **no longer needed** and can be removed since 0.1.9',
  '- The build-time guard `scripts/check-dsh-compat.mjs` (wired into `pnpm check`) validates the core token set, semantic-token coverage and the `peerDependencies` range so this can\'t silently drift again',
].filter(Boolean).join('\n')

const MARK_START = '<!-- npm-readme:start'
const MARK_END = '<!-- npm-readme:end -->'

/** 抽 <!-- npm-readme:start … --> 与 <!-- npm-readme:end --> 之间的正文。 */
function regionOf(text, file) {
  const s = text.indexOf(MARK_START)
  const e = text.indexOf(MARK_END)
  if (s < 0 || e < 0 || e < s) die(file + ' 缺少 npm-readme 标记区间(' + MARK_START + ' … ' + MARK_END + ')')
  const afterStartTag = text.indexOf('-->', s)
  if (afterStartTag < 0) die(file + ' 的 npm-readme:start 注释没有闭合 -->')
  return text.slice(afterStartTag + 3, e).replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n'
}

function renderZh(region) {
  return [
    '# dsh-themes',
    '',
    '[English](README_EN.md) | 中文',
    '',
    'DSH(DeepSeek Harness)运行时的**外观与主题**插件:内置调色板、明 / 暗 / 跟随系统外观模式、Open VSX 搜索安装、VS Code 主题导入,主题库持久化。',
    '',
    '## 安装',
    '',
    '```bash',
    'dsh plugin --profile web add dsh-themes',
    '```',
    '',
    '重启 dsh web 后在 **设置 → 主题** 中使用。本地开发也可以用 `bash scripts/install.sh` 一键构建并安装。',
    '',
    '## 兼容性',
    '',
    compatZh,
    '',
    '## 开发',
    '',
    '源码:https://github.com/MangMax/dsh-themes',
    '',
    '```bash',
    'bash scripts/install.sh    # 构建 + 组装 + 安装',
    '```',
    '',
    region,
  ].join('\n')
}

function renderEn(region) {
  return [
    '# dsh-themes',
    '',
    'English | [中文](README.md)',
    '',
    'A **look & theme** plugin for DSH (DeepSeek Harness): built-in palettes, light / dark / follow-system appearance modes, Open VSX search & install, VS Code theme import, persisted theme library.',
    '',
    '## Install',
    '',
    '```bash',
    'dsh plugin --profile web add dsh-themes',
    '```',
    '',
    'Restart dsh web, then use it under **Settings → Themes**. For local development, `bash scripts/install.sh` builds, assembles and installs in one go.',
    '',
    '## Compatibility',
    '',
    compatEn,
    '',
    '## Development',
    '',
    'Source: https://github.com/MangMax/dsh-themes',
    '',
    '```bash',
    'bash scripts/install.sh    # build + assemble + install',
    '```',
    '',
    region,
  ].join('\n')
}

const variants = [
  { source: 'README.md', target: 'README.md', compat: compatZh, render: renderZh },
  { source: 'README_EN.md', target: 'README_EN.md', compat: compatEn, render: renderEn },
]

for (const v of variants) {
  const srcPath = path.join(root, v.source)
  if (!fs.existsSync(srcPath)) die('找不到根 ' + v.source)
  const text = fs.readFileSync(srcPath, 'utf8')

  // 逐行核对:根 README 的兼容性段必须包含生成的每一行(防止两处漂移)。
  const missing = v.compat.split('\n').filter((line) => line && !text.includes(line))
  if (missing.length > 0) {
    console.error('错误:' + v.source + ' 的「兼容性 / Compatibility」段与 package.json(peerDependencies + dshCompat)不一致,缺少:')
    for (const line of missing) console.error('  期望包含: ' + line)
    console.error('  → 同步修改 ' + v.source + ' 的兼容性段,或更新 package.json 的 dshCompat,再重新组装')
    process.exit(1)
  }

  const region = regionOf(text, v.source)
  fs.writeFileSync(path.join(buildDir, v.target), v.render(region))
  console.log('    ' + v.target + ' ← ' + v.source + ' 标记区间 + package.json 生成的头部(' + (region.split('\n').length - 1) + ' 行正文)')
}
console.log('    peer 区间: ' + peerRange)
console.log('    已验证: ' + verified.join(', ') + '(最新 ' + latest + ')')
NODE

echo "==> [3/4] 打包 tarball"
TGZ_PATH="$ROOT/.npm-package/$PKG_NAME-$PKG_VER.tgz"
rm -f "$TGZ_PATH"
cd "$BUILD_DIR"
if command -v pnpm >/dev/null 2>&1; then
  pnpm pack --pack-destination "$ROOT/.npm-package" >/dev/null
elif command -v npm >/dev/null 2>&1; then
  npm pack --silent >/dev/null
  mv "$BUILD_DIR/$PKG_NAME-$PKG_VER.tgz" "$TGZ_PATH"
else
  echo "错误:未找到 pnpm 或 npm,无法打包 tarball" >&2
  exit 1
fi
cd "$ROOT"
[ -f "$TGZ_PATH" ] || { echo "错误:打包未生成 $TGZ_PATH" >&2; exit 1; }
echo "    包: $TGZ_PATH"

if [ "${1:-}" = "--pack-only" ]; then
  echo "==> 完成(pack-only,未安装)"
  exit 0
fi

echo "==> [4/4] dsh plugin 安装到 $PROFILE profile"
dsh plugin --profile "$PROFILE" add "$TGZ_PATH"

echo ""
echo "✔ 安装完成!请重启 dsh($PROFILE profile,结束当前进程后重新运行)使其挂载。"
