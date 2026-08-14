# dsh-themes

[English](README_EN.md) | 中文

DSH(DeepSeek Harness)外观与主题插件。

## 安装

```bash
dsh plugin --profile web add dsh-themes
```

重启 dsh web 后在 **设置 → 主题** 中使用。

## 功能

- 内置调色板(DSH 默认 / t3 chat / Grove / Ocean / Ember / Iris),明/暗独立归属,缺省一侧由默认主题兜底
- Open VSX 搜索一键导入主题扩展;VS Code 扩展 / URL / 粘贴 JSON 导入
- 颜色详细参数编辑器:明暗切换 + 分组 token 色块与 hex 编辑,即时生效,支持改名与重置
- 主题持久化(`~/.dsh/dsh-themes.json`)

## 开发

源码: https://github.com/MangMax/dsh-themes

```bash
bash scripts/install.sh    # 构建 + 组装 + 安装
```
