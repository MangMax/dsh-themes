// DSH 主题 (dsh-themes) — Host 入口
// 本文件由 VitePlus(vp pack)打包为 IIFE 并包装成插件函数体。
// 以 profile bundle(静态插件)方式挂载:Host 侧通过 connection 服务注册
// package-private RPC channel `/dsh-themes`,供 Client 半区
// (connection.rpc.call('/dsh-themes', method, args))调用:
//   scan-vscode-themes  扫描本地 VS Code / Cursor 扩展目录中的主题文件
//   read-theme-file     读取单个主题 JSON 文件(解析 include 继承链)
//   fetch-theme-url     获取原始主题 JSON URL(宿主全局 fetch,不依赖 shell/web provider)
//   search-open-vsx     搜索 Open VSX 主题扩展(category=Themes 过滤,单次请求,含图标/评分/更新时间/描述)
//   open-vsx-detail     异步补充扩展作者、许可证、详情与仓库链接
//   install-open-vsx    下载 VSIX(版本缓存)、内存解压(fflate)并返回贡献主题的完整 JSON(include 合并)
//   persist-themes      持久化主题库到 ~/.dsh/dsh-themes.json(node fs 直写)
//   load-themes         读取持久化的主题库(node fs 直读)
//
// 跨平台说明:网络与本地文件全部在宿主进程内完成(全局 fetch + node 内置模块),
// 不再调用 shell 的 curl/mkdir/unzip 等 Unix 命令——这些命令在 Windows pwsh 下
// 不可用或行为不同,是此前 Windows 上搜索报错的根因(参考 dsh-market 的同样做法)。
import { makeShell } from './util.js'
import { unzipSync } from 'fflate'
export const PLUGIN_NAME = 'dsh-themes'
export default {
  inject: ['connection'],
  apply(ctx) {
    const { homeDir, tmpDir, joinPath, curlText, curlBinary, readFileSyncUtf8, readFileBytes, writeFileSyncUtf8, writeFileBytes, existsFile } = makeShell(ctx)
    // ---- 错误返回辅助:code 为稳定错误码(Client 侧据此本地化),message 为中文原文(日志/兜底详情) ----
    const fail = (code, message) => ({ ok: false, error: { code, message } })
    // ---- 各 RPC 方法体(与 Client 半区的 connection.rpc.call 配对) ----
    const handlers = {
      // ---- home directory discovery (for VS Code extension roots) ----
      'scan-vscode-themes': async (args) => {
        const fs = ctx.get('fs')
        if (fs === undefined) return fail('fs-unavailable', '文件系统服务不可用')
        const custom = args && typeof args.root === 'string' && args.root.trim() ? args.root.trim() : ''
        const roots = []
        if (custom) roots.push(custom)
        let home = null
        try { home = await homeDir() } catch { /* ignore */ }
        if (home) {
          roots.push(home + '/.vscode/extensions')
          roots.push(home + '/.vscode-insiders/extensions')
          roots.push(home + '/.cursor/extensions')
        }
        if (roots.length === 0) return fail('scan.no-root', '未找到扩展目录,请在输入框中填写扩展目录路径')
        const themes = []
        const seen = new Set()
        for (const root of roots) {
          if (themes.length >= 80) break
          let entries
          try {
            const target = await fs.resolve(root)
            const info = await fs.stat(target)
            if (info === undefined || info.type !== 'directory') continue
            entries = await fs.listDir(target)
          } catch { continue }
          for (const entry of entries) {
            if (themes.length >= 80) break
            if (entry.type !== 'directory') continue
            const base = root + '/' + entry.name
            let display = null
            let themePaths = null
            try {
              const pkgTarget = await fs.resolve('package.json', { cwd: base })
              const pkgInfo = await fs.stat(pkgTarget)
              if (pkgInfo !== undefined && pkgInfo.type === 'file') {
                const pkgText = await fs.readText(pkgTarget)
                let pkg = null
                try { pkg = JSON.parse(pkgText) } catch { /* tolerate */ }
                if (pkg) {
                  if (typeof pkg.displayName === 'string' && pkg.displayName.trim()) display = pkg.displayName.trim()
                  const contrib = pkg.contributes && pkg.contributes.themes
                  if (Array.isArray(contrib)) {
                    themePaths = contrib.map((t) => t && t.path).filter((p) => typeof p === 'string' && /\.json$/i.test(p))
                  }
                }
              }
            } catch { /* tolerate */ }
            const candidates = themePaths && themePaths.length > 0 ? themePaths : ['themes']
            for (const cand of candidates) {
              try {
                const tTarget = await fs.resolve(cand, { cwd: base })
                const tInfo = await fs.stat(tTarget)
                if (tInfo === undefined) continue
                const push = (path, label) => {
                  if (seen.has(path)) return
                  seen.add(path)
                  themes.push({
                    path,
                    label: (label || path.split('/').pop().replace(/\.json$/i, '') || path).slice(0, 80),
                    extension: display || entry.name,
                  })
                }
                if (tInfo.type === 'directory') {
                  const files = await fs.listDir(tTarget)
                  for (const file of files) {
                    if (file.type !== 'file' || !/\.json$/i.test(file.name)) continue
                    push(base + '/' + cand + '/' + file.name, file.name.replace(/\.json$/i, ''))
                  }
                } else if (tInfo.type === 'file') {
                  push(base + '/' + cand, cand.split('/').pop().replace(/\.json$/i, ''))
                }
              } catch { /* tolerate */ }
            }
          }
        }
        return { ok: true, home, roots: roots.length, themes }
      },

      // ---- read one theme file(解析 include 继承链,最多 8 层,防循环) ----
      'read-theme-file': async (args) => {
        const fs = ctx.get('fs')
        if (fs === undefined) return fail('fs-unavailable', '文件系统服务不可用')
        const path = args && typeof args.path === 'string' ? args.path : ''
        if (!path) return fail('read.no-path', '缺少文件路径')
        try {
          const target = await fs.resolve(path)
          const text = await fs.readText(target)
          if (text.length > 512 * 1024) return fail('read.too-large', '主题文件超过 512KB 限制')
          // VS Code 主题可用 "include" 继承基础文件,合并后返回
          const seen = new Set()
          const loadChain = async (currentPath, depth) => {
            if (depth > 8) throw new Error('include 嵌套过深')
            if (seen.has(currentPath)) throw new Error('include 存在循环引用')
            seen.add(currentPath)
            const t = await fs.resolve(currentPath)
            const rawText = await fs.readText(t)
            if (rawText.length > 512 * 1024) throw new Error('主题文件超过 512KB 限制')
            let raw = null
            try { raw = JSON.parse(rawText) } catch { return null }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
            if (typeof raw.include !== 'string') return raw
            const slash = currentPath.lastIndexOf('/')
            const dir = slash >= 0 ? currentPath.slice(0, slash) : '.'
            const includePath = raw.include.startsWith('./')
              ? dir + '/' + raw.include.slice(2)
              : dir + '/' + raw.include
            const base = await loadChain(includePath, depth + 1)
            if (!base) return raw
            return {
              ...base,
              ...raw,
              colors: { ...(base.colors || {}), ...(raw.colors || {}) },
            }
          }
          let finalText = text
          try {
            const merged = await loadChain(path, 0)
            if (merged) finalText = JSON.stringify(merged)
          } catch { /* include 解析失败时使用原始内容 */ }
          return { ok: true, text: finalText }
        } catch (e) {
          return fail('read.failed', '读取失败:' + ((e && e.message) || String(e)))
        }
      },

      // ---- fetch a raw theme JSON url (宿主全局 fetch;web 服务可能无可用 provider,不依赖它) ----
      'fetch-theme-url': async (args) => {
        const url = args && typeof args.url === 'string' ? args.url : ''
        if (!/^https?:\/\//i.test(url)) return fail('fetch.http-only', '仅支持 http(s) URL')
        try {
          const text = await curlText(url, 524288)
          return { ok: true, text }
        } catch (e) {
          return fail('fetch.failed', '获取失败:' + ((e && e.message) || String(e)))
        }
      },

      'search-open-vsx': async (args) => {
        const query = args && typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return fail('search.query-required', '请输入搜索关键词')
        try {
          // 单次搜索请求即返回(不再逐项 detail/manifest 预检;主题判断在导入时完成,速度优先)
          const url = 'https://open-vsx.org/api/-/search?query=' + encodeURIComponent(query) + '&category=Themes&size=12&sortBy=downloadCount&sortOrder=desc'
          const text = await curlText(url, 262144)
          const data = JSON.parse(text)
          const exts = Array.isArray(data.extensions) ? data.extensions : []
          const list = exts.map((e) => ({
            namespace: String(e.namespace || ''),
            name: String(e.name || ''),
            displayName: String(e.displayName || e.name || ''),
            version: String(e.version || ''),
            downloadCount: Number(e.downloadCount) || 0,
            downloadUrl: e.files && typeof e.files.download === 'string' ? e.files.download : null,
            icon: e.files && typeof e.files.icon === 'string' ? e.files.icon : null,
            author: typeof e.author === 'string' && e.author.trim() ? e.author.trim() : String(e.namespace || ''),
            license: typeof e.license === 'string' && e.license.trim() ? e.license.trim() : '',
            rating: Number(e.averageRating) || 0,
            reviewCount: Number(e.reviewCount) || 0,
            timestamp: typeof e.timestamp === 'string' ? e.timestamp : '',
            description: typeof e.description === 'string' && e.description.trim() ? e.description.trim() : '',
          })).filter((e) => e.namespace && e.name && e.downloadUrl).slice(0, 10)
          return { ok: true, list }
        } catch (e) {
          return fail('search.failed', '搜索失败:' + ((e && e.message) || String(e)))
        }
      },

      // ---- download a VSIX(版本缓存),内存解压(fflate),并直接返回贡献主题的完整 JSON(include 已合并) ----
      'install-open-vsx': async (args) => {
        const namespace = args && typeof args.namespace === 'string' ? args.namespace : ''
        const name = args && typeof args.name === 'string' ? args.name : ''
        const url = args && typeof args.downloadUrl === 'string' ? args.downloadUrl : ''
        const version = args && typeof args.version === 'string' ? args.version : ''
        if (!namespace || !name || !url) return fail('install.params', '参数不完整')
        try {
          // 版本化缓存:原始 VSIX 字节落在系统临时目录,已缓存则跳过下载,重复导入秒开
          const cacheDir = joinPath(tmpDir() || homeDir() || '.', 'dsh-themes', namespace + '.' + name, version || 'latest')
          const cacheFile = joinPath(cacheDir, 'ext.vsix')
          let bytes = null
          try {
            if (existsFile(cacheFile)) {
              const cached = readFileBytes(cacheFile)
              if (cached && cached.length > 0) bytes = cached
            }
          } catch { /* not cached */ }
          if (bytes === null || bytes.length === 0) {
            bytes = await curlBinary(url, 20971520)
            try { writeFileBytes(cacheFile, bytes) } catch { /* cache best-effort */ }
          }

          // 内存解压(fflate 纯 JS,Windows/macOS/Linux 行为一致,无需系统 unzip 命令)
          let files = null
          try {
            files = unzipSync(bytes)
          } catch (e) {
            return fail('install.failed', '扩展包解压失败:' + ((e && e.message) || String(e)))
          }
          // 解压炸弹防护:总解压体积上限 64MB
          let totalSize = 0
          for (const key of Object.keys(files)) totalSize += files[key] ? files[key].length : 0
          if (totalSize > 64 * 1024 * 1024) return fail('install.failed', '扩展包解压后超过 64MB 限制')
          const decode = (buf) => new TextDecoder().decode(buf)
          // VSIX 标准布局为 extension/...;缺省时退回根布局
          const findEntry = (rel) => (files['extension/' + rel] ? files['extension/' + rel] : (files[rel] || null))

          let pkgText = null
          const pkgBuf = findEntry('package.json')
          if (pkgBuf && pkgBuf.length <= 512 * 1024) {
            try { pkgText = decode(pkgBuf) } catch { /* ignore */ }
          }
          if (pkgText === null) return fail('install.no-package', '扩展包内未找到 package.json')
          let pkg = null
          try { pkg = JSON.parse(pkgText) } catch { /* tolerate */ }
          const contrib = pkg && pkg.contributes && pkg.contributes.themes
          const themes = []
          if (Array.isArray(contrib)) {
            // 逐个主题解析(含 include 合并,深度上限 8,防循环)——全部在内存中完成
            for (const t of contrib.slice(0, 40)) {
              if (!t || typeof t.path !== 'string' || !/\.json$/i.test(t.path)) continue
              const rel = t.path.replace(/^\.\//, '')
              const seen = new Set()
              const loadChain = (currentPath, depth) => {
                if (depth > 8 || seen.has(currentPath)) return null
                seen.add(currentPath)
                const buf = findEntry(currentPath)
                if (!buf || buf.length > 512 * 1024) return null
                let raw = null
                try { raw = JSON.parse(decode(buf)) } catch { return null }
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
                if (typeof raw.include !== 'string') return raw
                const slash = currentPath.lastIndexOf('/')
                const d = slash >= 0 ? currentPath.slice(0, slash) : '.'
                const includePath = raw.include.startsWith('./') ? d + '/' + raw.include.slice(2) : d + '/' + raw.include
                const base = loadChain(includePath, depth + 1)
                if (!base) return raw
                return { ...base, ...raw, colors: { ...(base.colors || {}), ...(raw.colors || {}) } }
              }
              const merged = loadChain(rel, 0)
              if (!merged) continue
              themes.push({
                label: String(t.label || rel.split('/').pop().replace(/\.json$/i, '')),
                uiTheme: String(t.uiTheme || ''),
                text: JSON.stringify(merged),
              })
            }
          }
          return {
            ok: true,
            extension: String((pkg && pkg.displayName) || name),
            version: String((pkg && pkg.version) || ''),
            themes,
          }
        } catch (e) {
          return fail('install.failed', '安装失败:' + ((e && e.message) || String(e)))
        }
      },

      // ---- fetch author/license for one Open VSX extension(搜索后异步补充,不阻塞搜索) ----
      'open-vsx-detail': async (args) => {
        const namespace = args && typeof args.namespace === 'string' ? args.namespace : ''
        const name = args && typeof args.name === 'string' ? args.name : ''
        if (!namespace || !name) return fail('detail.params', '参数不完整')
        try {
          const detail = JSON.parse(await curlText('https://open-vsx.org/api/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name), 131072))
          let author = ''
          if (typeof detail.author === 'string') author = detail.author.trim()
          else if (detail.author && typeof detail.author === 'object' && typeof detail.author.name === 'string') author = detail.author.name.trim()
          let repository = ''
          if (detail.repository && typeof detail.repository.url === 'string') repository = detail.repository.url.trim()
          return {
            ok: true,
            author,
            license: typeof detail.license === 'string' && detail.license.trim() ? detail.license.trim() : '',
            url: typeof detail.url === 'string' && detail.url.trim() ? detail.url.trim() : '',
            repository,
          }
        } catch (e) {
          return fail('detail.failed', '详情获取失败:' + ((e && e.message) || String(e)))
        }
      },

      // ---- persist theme library to ~/.dsh/dsh-themes.json ----
      'persist-themes': async (args) => {
        const payload = args && args.payload ? args.payload : null
        if (payload === null) return fail('persist.no-data', '缺少数据')
        try {
          // node fs 直写(不经 shell 的 printf|base64 管道,Windows 同样可用)
          const file = joinPath(homeDir() || tmpDir() || '.', '.dsh', 'dsh-themes.json')
          writeFileSyncUtf8(file, JSON.stringify(payload))
          return { ok: true }
        } catch (e) {
          return fail('persist.failed', '保存失败:' + ((e && e.message) || String(e)))
        }
      },

      // ---- load theme library from ~/.dsh/dsh-themes.json ----
      'load-themes': async () => {
        try {
          const file = joinPath(homeDir() || tmpDir() || '.', '.dsh', 'dsh-themes.json')
          if (!existsFile(file)) return { ok: true, data: null }
          const text = readFileSyncUtf8(file)
          let data = null
          try { data = JSON.parse(text) } catch { /* tolerate */ }
          return { ok: true, data }
        } catch (e) {
          return fail('load.failed', '读取失败:' + ((e && e.message) || String(e)))
        }
      },
    }

    // ---- 注册 RPC channel:静态插件的 `harness.handle` 等价物 ----
    // 与 Client 半区 `connection.rpc.call('/dsh-themes', method, args)` 配对;
    // authority 与 /api 同策略(loopback 或部署配置的 trusted hosts)。
    //
    // connection RPC 的响应信封必须符合 serverResponseSchema 的 rpcResultSchema:
    //   { ok: true, value } | { ok: false, error: { code, message, details } }
    // (zod 会剥掉信封外的未知字段,例如 { ok: true, list } 里的 list 会被丢弃)
    // 因此这里统一把各方法体返回的 { ok, ...data } / { ok: false, error: string }
    // 转换成官方信封,方法体本身保持不变。
    const rpcError = (code, message) => ({
      code: String(code),
      message: String(message),
      details: { issues: [] },
    })
    ctx.connection.rpc.handle('/dsh-themes', async (method, args) => {
      const handler = handlers[method]
      if (handler === undefined) return { ok: false, error: rpcError('unknown-method', '未知方法:' + method) }
      try {
        const result = await handler(args)
        if (result && result.ok === true) {
          const { ok, ...data } = result
          return { ok: true, value: data }
        }
        // 方法体返回 { ok: false, error: { code, message } }:code 进入信封,Client 按码本地化
        const err = result && result.error
        if (err && typeof err === 'object' && typeof err.code === 'string') {
          return { ok: false, error: rpcError(err.code, (err && err.message) || err.code) }
        }
        return { ok: false, error: rpcError('rpc.failed', (err && err.message) || String(err) || '调用失败') }
      } catch (e) {
        return { ok: false, error: rpcError('rpc.failed', (e && e.message) || String(e)) }
      }
    }, { authority: 'trusted-host' })
  },
}
