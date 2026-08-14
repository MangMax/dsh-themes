#!/usr/bin/env bash
# 一键构建 + 组装 npm 插件包 + 安装到 DSH web profile
# 用法: bash scripts/install.sh [--pack-only]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKG_NAME="dsh-themes"
PKG_VER="0.1.0"
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
// dsh-themes host 入口(ESM wrapper):产物按函数体执行,返回值即插件对象
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('./index.cjs', import.meta.url), 'utf8')
const plugin = new Function(src)()
export const name = 'dsh-themes'
export const apply = plugin.apply
export const inject = plugin.inject
export const Config = plugin.Config
EOF

# client 产物 -> __ModuleLoader__ 格式:产物自带顶层 return,即 factory 返回值
{
  echo "// dsh-themes client 入口(__ModuleLoader__ 格式)"
  echo "window.__ModuleLoader__.load({"
  echo "  id: 'dsh-themes',"
  echo "  factory: (require) => {"
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
  "files": ["lib", "cordis.patch.yml"],
  "license": "MIT",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime"],
      "platform": "web"
    }
  }
}
EOF

echo "==> [3/4] npm pack"
TGZ="$(cd .npm-package && npm pack ./$PKG_NAME --silent | tail -1)"
TGZ_PATH="$ROOT/.npm-package/$TGZ"
echo "    包: $TGZ_PATH"

if [ "${1:-}" = "--pack-only" ]; then
  echo "==> 完成(pack-only,未安装)"
  exit 0
fi

echo "==> [4/4] dsh plugin 安装到 web profile"
dsh plugin --profile web add "$TGZ_PATH"

echo ""
echo "✔ 安装完成!请重启 dsh web(结束当前 dsh web 进程后重新运行)使其挂载。"
