# dsh-themes

DSH(DeepSeek Harness)运行时的**外观与主题**插件:内置调色板、明 / 暗 / 跟随系统外观模式、Open VSX 搜索安装、VS Code 主题导入,主题库持久化。

> 主题引擎(语义角色映射、双种子生成、对比度求解、OKLCH 感知导入映射)的架构灵感来自
> [t3code](https://github.com/pingdotgg/t3code);品牌与命名均为 DSH 自有。

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

源码为 **TypeScript 模块**,由 **VitePlus(`vp`)打包**为 DSH 插件函数体(平台要求单文件,`vite.config.ts` 的 `pack` 块负责 IIFE 构建与函数体包装)。

```bash
vp pack          # 构建 dist/client/index.js 与 dist/host/index.js(即插件函数体)
vp check         # 语法检查
```

### 结构

```
client/src/        # 浏览器半区(设置页 UI、调色板引擎)
  color-utils.ts   #   RGB/HSL/WCAG 对比度、双种子调色板
  oklch.ts         #   OKLCH 感知引擎(导入派生)
  chat.ts          #   Chat 调色板(t3.chat 界面取色,颜色保持原样)
  vs-import.ts     #   VS Code 主题解析与映射
  palette.ts       #   token 清单、默认外观、内置主题
  styles.ts        #   设置页样式
  index.ts         #   入口:状态/覆盖层/设置页/注册
host/src/          # Node 半区(RPC)
  util.ts          #   shell/curl 工具工厂
  index.ts         #   入口:扫描/读取/搜索/详情/安装/持久化
```

## 安装

在 DSH 中运行插件:`cordis_define` 的 `code.host`/`code.client` 分别取 `dist/host/index.js` 与 `dist/client/index.js`。
