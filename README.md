# DSH 主题 (dsh-themes)

DSH(DeepSeek Harness)运行时的**外观与主题**插件:5 套内置调色板、明 / 暗 / 跟随系统外观模式、明暗混合、Open VSX 搜索安装、VS Code 主题导入,主题库持久化。

> **灵感来源**:[t3code](https://github.com/pingdotgg/t3code) 的主题架构——语义色角色、双种子调色板生成、感知色对比度求解与 VS Code 主题导入映射。本仓库的实现、命名与品牌均为 DSH 自有。

## 功能

- **外观模式**:跟随系统 / 浅色 / 深色,与 DSH 内置「外观」设置双向同步
- **内置调色板**:DSH 默认、Chat、Grove、Ocean、Ember、Iris,每套含浅色与深色变体;调色板以 token 覆盖层应用,跟随系统时自动切换对应变体
- **品牌色跟随主题**:发送按钮、对话/轨迹 tab 选中、侧栏选中项与图标、用户气泡、思考状态动画等 DeepSeek 品牌色系,统一由主题的强调色派生
- **明暗混合**:为浅色与深色分别指定调色板(如浅色 Grove + 深色 Iris),缺半自动用 DSH 默认值兜底;跟随系统时按系统明暗切换
- **搜索安装(Open VSX)**:搜索主题扩展 → Host 下载 VSIX(≤20MB)→ 解压 → 列出扩展贡献的主题 → 一键导入
- **VS Code 主题导入**:
  - 扫描本地扩展目录(`~/.vscode/extensions`、`~/.vscode-insiders/extensions`、`~/.cursor/extensions`),读取扩展 `contributes.themes` 声明
  - 通过 URL 获取原始主题 JSON(如 GitHub raw)
  - 直接粘贴 `*-color-theme.json` 内容
  - 导入时自动:解析 VS Code 颜色(hex 3/4/6/8 位、`color(display-p3)`、alpha 扁平化)→ 以 `editor.background` 与强调色为种子派生完整调色板 → workbench 指定值经对比度门控(≥4.5)逐项采用 → 自动生成另一明暗模式的配套变体
- **持久化**:导入的主题、当前选择与明暗混合保存到 `~/.dsh/dsh-themes.json`,刷新或重启后自动恢复

## 安装

动态插件在 DSH 会话内通过 `cordis_define` 定义,详细步骤见 [docs/install.md](docs/install.md)。定义并运行后,在 **设置 → 主题** 页面使用。

## 架构

| 文件 | 说明 |
| --- | --- |
| `plugin/host.js` | Host 半区:本地扩展目录扫描、主题文件读取、URL 获取、Open VSX 搜索与 VSIX 安装(依赖 `curl`/`unzip`)、主题库持久化(经 `shell`/`fs`/`web` 服务) |
| `plugin/client.js` | Client 半区:调色板引擎、13 个 DSH alias token 覆盖层、明暗混合、设置页 UI、持久化恢复 |

主题通过 DSH 的 `theme.overrideTokens` 以单一覆盖层应用(每个 token 携带 `light`/`dark` 双值),停止插件后自动恢复默认外观。

## License

MIT
