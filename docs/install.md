# 安装指南

本插件是 DSH 的**动态 Cordis 插件**(运行时扩展,进程内生效,不修改部署配置)。两个半区的代码分别在 `plugin/host.js` 与 `plugin/client.js`。

## 方式一:通过 AI 助手定义(推荐)

在 DSH 会话中直接要求助手:

> 读取本仓库 `plugin/host.js` 与 `plugin/client.js`,用 `cordis_define` 定义插件(名称「DSH 主题」,host 半区用 host.js,client 半区用 client.js),然后 `cordis_run` 运行。

助手会完成定义与运行,批准后即可在 **设置 → 主题** 页面使用。

## 方式二:手动定义

1. 打开 `plugin/host.js`,将文件内容作为 `cordis_define` 的 `code.host`;
2. 打开 `plugin/client.js`,将文件内容作为 `cordis_define` 的 `code.client`;
3. `plugin` 传 `{ kind: "new", idPrefix: "dsthe" }`(3–6 个字母);
4. 定义成功后 `cordis_run` 激活。

两个文件都是**纯 JavaScript 函数体**(返回 Cordis Plugin 对象),无 TypeScript / JSX / import,可直接使用。

## 使用

- **外观模式**:跟随系统 / 浅色 / 深色,写的是 DSH 内置主题偏好(`theme.setTheme`),与设置 → 外观 行同步并持久化;
- **内置调色板**:DSH 默认、Chat、Grove、Ocean、Ember、Iris,每套含明暗变体;点击卡片标题仅应用调色板,点击变体按钮同时切换外观模式;
- **从 VS Code 导入**:
  - 扫描本地扩展:默认扫描 `~/.vscode/extensions`、`~/.vscode-insiders/extensions`、`~/.cursor/extensions`(经 `$HOME` 发现),也可手动填写目录;
  - URL 获取:任意返回原始主题 JSON 的 http(s) 地址;
  - 粘贴 JSON:直接粘贴 `*-color-theme.json` 内容。

导入的主题进入「导入的主题」区,可切换、删除。

## 卸载

在 DSH 中对该插件执行 `cordis_stop`(暂停)或 `cordis_undefine`(永久移除)。停止后调色板覆盖层自动移除,外观恢复默认。
