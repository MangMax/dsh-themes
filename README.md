<p align="center">
  <img src="assets/hero.svg" alt="dsh-themes hero" width="100%">
</p>

# dsh-themes

[English](README_EN.md) | 中文

[![npm version](https://img.shields.io/npm/v/dsh-themes.svg)](https://www.npmjs.com/package/dsh-themes)
[![license](https://img.shields.io/npm/l/dsh-themes.svg)](https://github.com/MangMax/dsh-themes)

DSH(DeepSeek Harness)运行时的**外观与主题**插件:内置调色板、明 / 暗 / 跟随系统外观模式、Open VSX 搜索安装、VS Code 主题导入,主题库持久化。

> 主题引擎(语义角色映射、双种子生成、对比度求解、OKLCH 感知导入映射)的架构灵感来自
> [t3code](https://github.com/pingdotgg/t3code)

![screenshot](assets/screenshot.png)

## 功能

- **主题卡片模型**:每个主题含明色/暗色两个变体槽,槽内聚合全部明色/暗色变体可选;导入的扩展聚合为一个主题卡片
- **默认主题卡片**:DSH 原生外观也是可选主题;删除使用中的导入主题或点击「恢复默认主题」均回退到它
- **变体选择器**:多色融合球列表(参照 t3code ThemePreviewCircle),选中放大(固定槽位不跳动)、溢出左右箭头导航、悬停显示变体名
- **外观模式**:跟随系统 / 浅色 / 深色,明暗变体随模式自动切换
- **搜索安装(Open VSX)**:单请求搜索,展示图标/作者/许可证/评分/更新时间;悬浮名称或图标查看详情卡片,点击打开扩展页或仓库;「导入」一步完成下载、解析(include 合并)与聚合导入,版本化缓存重复导入秒开
- **VS Code 导入**:本地扩展扫描、URL 获取、粘贴 JSON;OKLCH 感知引擎派生表面,workbench 指定值对比度门控,操作色独立于 accent
- **状态动画色**:运行状态点阵(`--dsh-state-ongoing` → `--dsw-static-deepseek-450`)跟随主题
- **持久化**:主题库保存到 `~/.dsh/dsh-themes.json`,重启后恢复

## 开发

源码为 **TypeScript 模块**,由 **VitePlus(`vp`)打包**为 DSH 插件函数体(`vite.config.ts` 的 `pack` 块负责构建)。

```bash
bash scripts/install.sh             # 一键:vp pack 构建 → 组装 npm 插件包 → dsh plugin 安装到 web profile
bash scripts/install.sh --pack-only # 只构建并打包,不安装
vp pack          # 仅构建 dist/client/index.cjs 与 dist/host/index.cjs
vp check         # 语法检查
```

### 结构

```
client/src/        # 浏览器半区(设置页 UI、调色板引擎)
  color-utils.ts   #   RGB/HSL/WCAG 对比度、双种子调色板
  oklch.ts         #   OKLCH 感知引擎(导入派生)
  chat.ts          #   t3 chat 调色板(t3.chat 界面取色,颜色保持原样)
  vs-import.ts     #   VS Code 主题解析与映射
  palette.ts       #   token 清单、默认外观、内置主题
  styles.ts        #   设置页样式
  index.ts         #   入口:状态/覆盖层/设置页/编辑器/注册
host/src/          # Node 半区(RPC)
  util.ts          #   shell/curl 工具工厂
  index.ts         #   入口:扫描/读取/搜索/详情/安装/持久化
scripts/
  install.sh       #   一键构建 + 组装 npm 插件包 + 安装
```

## 安装

方式一(从 npm registry,已发布后):

```bash
dsh plugin --profile web add dsh-themes
```

方式二(本地一键构建安装,适合开发迭代):

```bash
bash scripts/install.sh
```

两种方式安装后均需**重启 dsh web**,然后进入 **设置 → 主题** 使用。

## 使用

- **外观模式**:跟随系统 / 浅色 / 深色;主题库默认未指定时由 DSH 默认主题兜底
- **明暗独立归属**:点击变体只设置该侧外观的主题,不切换外观模式;浅色与暗色可来自不同主题;点击卡片名称则明暗两侧同时使用该主题
- **颜色编辑器**:主题卡片「修改」进入二级页面——改名、明暗切换、分组 token 色块与 hex 编辑(即时生效)、重置修改
- **内置主题「复制」**:复制为自定义副本后再编辑,内置主题不可直接修改
- **从 VS Code 导入**:扫描本地扩展(`~/.vscode/extensions`、`~/.vscode-insiders/extensions`、`~/.cursor/extensions`)、URL 获取、粘贴 JSON;导入主题可修改、删除
- **搜索安装(Open VSX)**:搜索、查看卡片内简介与链接、一键导入(缓存秒开)

## 卸载

移除插件:

```bash
dsh plugin --profile web remove dsh-themes
```

或删除 profile 依赖后重启 dsh web。卸载后调色板覆盖层自动移除,外观恢复默认。
