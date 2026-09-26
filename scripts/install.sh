#!/usr/bin/env bash
# 一键构建 + 组装 npm 插件包 + 安装到 DSH profile
# 用法: bash scripts/install.sh [--pack-only]
# 目标 profile:默认 web,可用 DSH_PLUGIN_PROFILE=desktop 等覆盖。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKG_NAME="dsh-themes"
PKG_VER="0.2.0"
PROFILE="${DSH_PLUGIN_PROFILE:-web}"
BUILD_DIR="$ROOT/.npm-package/$PKG_NAME"

echo "==> [1/4] vp pack 构建"
rm -rf dist
vp pack

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
  "keywords": ["dsh", "deepseek-harness", "plugin", "theme", "themes", "color", "palette", "appearance"],
  "engines": { "node": ">=22.3.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.0",
    "@deepseek-ai/dsh-client-connection": "^0.1.5-rc.1",
    "@deepseek-ai/dsh-client-locale": "^0.1.5-rc.1",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.5-rc.1",
    "@deepseek-ai/dsh-client-ui-renderer": "^0.1.5-rc.1",
    "@deepseek-ai/dsh-client-ui-theme": "^0.1.5-rc.1"
  },
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

# 包 README(中文默认 + 英文版)
cat > "$BUILD_DIR/README.md" <<'EOF'
# dsh-themes

[English](README_EN.md) | 中文

DSH(DeepSeek Harness)外观与主题插件。

## 安装

```bash
dsh plugin --profile web add dsh-themes
```

重启 dsh web 后在 **设置 → 主题** 中使用。

## 兼容性

- 需要 DSH `>=0.1.5-rc.1 <0.2.0`(peerDependencies 声明),已在 **0.1.7-rc.2** 上验证
- 客户端 Toast 使用 DSH 平台 seed word 模块 `@deepseek-ai/dsh-client-ui-primitives`(无需额外安装)
- Host 半区用 `connection.fetch.register` 注册精确 Fetch 路由 `/api/dsh-themes`,
  由 DSH 自有的 `/api` 前置路由转发并附带 Host/Origin 信任检查与浏览器会话鉴权
- **不需要**再在 profile 的 `cordis.patch.yml` 里给 `connection` 行补
  `inject: [webRuntime, webServer]`(那是 0.1.5 时代绕开
  `cannot get property "webServer" without inject` 的临时补丁,0.1.9 起可删除)

## 功能

- 内置调色板(DSH 默认 / t3 chat / Grove / Ocean / Ember / Iris),明/暗独立归属,缺省一侧由默认主题兜底
- Open VSX 搜索一键导入主题扩展(搜索动画 + 缓存);VS Code 扩展 / URL / 粘贴 JSON 导入
- 主题文件按 **JSONC** 解析(注释 / 尾随逗号 / BOM),并用清单 `uiTheme` 校正明暗变体
- 导入提速:VSIX 按需解压、颜色白名单压缩载荷(Tokyo Night 三主题实测 117,679 → 4,412 字节)、详情一次批量补齐
- 成功 / 失败提示使用 DSH 原生 Toast(顶部居中,位于所有面板之上)
- 颜色详细参数编辑器:明暗切换 + 分组 token 色块与 hex 编辑,即时生效,支持改名与重置
- 完整覆盖 DSH 设计平台 95 个颜色 token(表面/文字/交互/状态/Markdown/滚动条/浮层等)
- 主题持久化(`~/.dsh/dsh-themes.json`)

## 开发

源码: https://github.com/MangMax/dsh-themes

```bash
bash scripts/install.sh    # 构建 + 组装 + 安装
```
EOF

cat > "$BUILD_DIR/README_EN.md" <<'EOF'
# dsh-themes

English | [中文](README.md)

A look & theme plugin for DSH (DeepSeek Harness).

## Install

```bash
dsh plugin --profile web add dsh-themes
```

Restart dsh web, then use it under **Settings → Themes**.

## Compatibility

- Requires DSH `>=0.1.5-rc.1 <0.2.0` (declared via peerDependencies); verified on **0.1.7-rc.2**
- Client toasts use the DSH platform seed-word module `@deepseek-ai/dsh-client-ui-primitives` (nothing extra to install)
- The Host half registers the exact Fetch route `/api/dsh-themes` through
  `connection.fetch.register`, so DSH's own `/api` prefix route forwards it with the
  Host/Origin trust fence and browser-session authentication attached
- The old workaround — adding `inject: [webRuntime, webServer]` to the `connection`
  row in the profile's `cordis.patch.yml` to dodge
  `cannot get property "webServer" without inject` — is **no longer needed** since 0.1.9

## Features

- Built-in palettes (DSH Default / t3 chat / Grove / Ocean / Ember / Iris) with independent light/dark owners; unspecified sides fall back to the default theme
- One-click Open VSX search & import (animated search + caching); VS Code extension / URL / paste-JSON import
- Theme files parsed as **JSONC** (comments / trailing commas / BOM); the manifest `uiTheme` corrects light/dark variants
- Faster imports: on-demand VSIX unzip, color-whitelisted compact payloads (117,679 → 4,412 bytes on Tokyo Night's three themes), batched detail calls
- Success/failure notices use DSH's native Toast (top-center, above every panel)
- Color editor: light/dark tabs, grouped token pickers + hex inputs with instant effect, rename and reset support
- Full coverage of the DSH design platform's 95 color tokens (surfaces / labels / interactive / status / markdown / scrollbars / overlays, etc.)
- Persisted theme library (`~/.dsh/dsh-themes.json`)

## Development

Source: https://github.com/MangMax/dsh-themes

```bash
bash scripts/install.sh    # build + assemble + install
```
EOF

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
