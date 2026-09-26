// DSH 主题 (dsh-themes) — Host 入口
// 本文件由 VitePlus(vp pack)打包为 IIFE 并包装成插件函数体。
// 以 profile bundle(静态插件)方式挂载:Host 侧通过 connection 服务注册
// 精确 Fetch 路由 `/api/dsh-themes`,供 Client 半区
// (connection.rpc.call('/api', 'dsh-themes', { method, args }))调用:
//   scan-vscode-themes  扫描本地 VS Code / Cursor 扩展目录中的主题文件(带清单 uiTheme)
//   read-theme-file     读取单个主题 JSON 文件(JSONC + include 继承链),返回压缩主题
//   fetch-theme-url     获取原始主题 JSON URL(宿主全局 fetch,不依赖 shell/web provider)
//   search-open-vsx     搜索 Open VSX 主题扩展(单次请求 + 60s TTL 缓存 + 10s 超时)
//   open-vsx-details    批量补充作者/许可证/仓库(一次 RPC 取代 N 次单查)
//   open-vsx-detail     单条详情(保留,向后兼容)
//   install-open-vsx    下载 VSIX(版本缓存)、**按需过滤解压**(fflate)并返回压缩后的主题
//   persist-themes      持久化主题库到 ~/.dsh/dsh-themes.json(node fs 直写)
//   load-themes         读取持久化的主题库(node fs 直读)
//
// ── 2026 改造要点(对齐 t3code 的 vscodeThemeImport)──
// 1) JSONC:VS Code 主题是 JSONC(带 // 注释、尾随逗号)。此前用严格 JSON.parse,
//    于是 enkia.tokyo-night 的 3 个主题文件全部解析失败 → themes 为空 →
//    客户端误报「未贡献颜色主题」。现在统一走 shared/jsonc.ts 的宽松解析。
// 2) 压缩载荷:白名单只保留调色板映射用到的 44 个 workbench 键,并丢掉
//    tokenColors/semanticTokenColors。实测 Tokyo Night 三主题 117,679 → 4,412 字节(-96.25%),
//    RPC 序列化/解析与持久化体积同步下降。
// 3) 按需解压:VSIX 里体积最大的是 readme/changelog/图标/itermcolors,主题相关
//    文件一定是 .json。用 fflate 的 filter 只解 JSON,不再全量 inflate。
// 4) 明暗权威:t3code 用清单 uiTheme 覆盖主题文件自己的 type。
//    Tokyo Night Light 文件里写的是 "type":"dark"(上游 bug),清单写 uiTheme:"vs"。
//
// 跨平台说明:网络与本地文件全部在宿主进程内完成(全局 fetch + node 内置模块),
// 不再调用 shell 的 curl/mkdir/unzip 等 Unix 命令——这些命令在 Windows pwsh 下
// 不可用或行为不同,是此前 Windows 上搜索报错的根因(参考 dsh-market 的同样做法)。
import { makeShell } from './util.js'
import { unzipSync } from 'fflate'
import { tryParseJson } from '../../shared/jsonc.js'
import { compactVsTheme } from '../../shared/vs-colors.js'
export const PLUGIN_NAME = 'dsh-themes'

// ---- 各类上限(与 t3code 同量级:t3code 用 20MB/64MB/5000 文件) ----
const MAX_VSIX_BYTES = 20 * 1024 * 1024
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024
const MAX_THEME_FILE_BYTES = 512 * 1024
const MAX_JSON_ENTRIES = 2000
const MAX_THEMES_PER_EXTENSION = 40
const INCLUDE_MAX_DEPTH = 8
const SEARCH_CACHE_TTL_MS = 60000
const SEARCH_CACHE_MAX = 32
const SEARCH_RESULT_SIZE = 12
const DETAIL_BATCH_MAX = 12

export default {
  inject: ['connection'],
  apply(ctx) {
    const {
      homeDir, tmpDir, joinPath, curlText, curlBinary,
      readFileSyncUtf8, readFileBytes, writeFileSyncUtf8, writeFileBytes, existsFile, removeFile, interactiveNet,
    } = makeShell(ctx)
    // ---- 错误返回辅助:code 为稳定错误码(Client 侧据此本地化),message 为中文原文(日志/兜底详情) ----
    const fail = (code, message) => ({ ok: false, error: { code, message } })
    /** 详情透传:客户端 errorText 只取第一个冒号之后的内容,故拼在冒号后。 */
    const detailOf = (e) => String((e && e.message) || e || '')

    /** 把 `./x.json`、`/x.json` 归一成包内相对路径。 */
    const normalizeRel = (rel) => String(rel || '').replace(/^\.\//, '').replace(/^\/+/, '')

    /**
     * 归一化绝对路径:折叠 `.` / `..` 与重复分隔符,保留 POSIX 根与 Windows 盘符。
     * 注意不能写成「拼完再剥前导斜杠」:本地主题的路径是绝对路径,
     * 剥掉前导斜杠会把 include 目标变成相对路径,读盘直接 ENOENT。
     */
    const normalizeAbs = (abs) => {
      const s = String(abs).replace(/\\/g, '/')
      const drive = /^([a-zA-Z]:)\//.exec(s)
      const rest = (drive ? s.slice(drive[0].length) : s.replace(/^\/+/, '')).split('/')
      const out = []
      for (const seg of rest) {
        if (seg === '' || seg === '.') continue
        if (seg === '..') { out.pop(); continue }
        out.push(seg)
      }
      return (drive ? drive[1] + '/' : '/') + out.join('/')
    }

    /** 拼 include 目标:相对当前文件所在目录;绝对 include 直接归一化。 */
    const resolveInclude = (currentPath, include) => {
      const cur = String(currentPath).replace(/\\/g, '/')
      const inc = String(include).replace(/\\/g, '/')
      if (inc.startsWith('/') || /^[a-zA-Z]:\//.test(inc)) return normalizeAbs(inc)
      const slash = cur.lastIndexOf('/')
      const dir = slash >= 0 ? cur.slice(0, slash) : '.'
      const merged = dir + '/' + (inc.startsWith('./') ? inc.slice(2) : inc)
      const absolute = dir.startsWith('/') || /^[a-zA-Z]:\//.test(dir)
      return absolute ? normalizeAbs(merged) : normalizeAbs('/' + merged).slice(1)
    }

    /**
     * 解析一条 include 继承链(每层都是 JSONC),返回合并后的原始主题对象。
     * @param readText (relPath) => string | null
     */
    const loadIncludeChain = (readText, startPath) => {
      const seen = new Set()
      const walk = (currentPath, depth) => {
        if (depth > INCLUDE_MAX_DEPTH || seen.has(currentPath)) return null
        seen.add(currentPath)
        const text = readText(currentPath)
        if (typeof text !== 'string') return null
        const raw = tryParseJson(text)
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
        if (typeof raw.include !== 'string') return raw
        const base = walk(resolveInclude(currentPath, raw.include), depth + 1)
        if (!base) return raw
        return {
          ...base,
          ...raw,
          colors: { ...(base.colors || {}), ...(raw.colors || {}) },
        }
      }
      return walk(startPath, 0)
    }

    // ---- 搜索缓存:同一关键词重复搜索(去抖/回车/切换排序)直接命中内存 ----
    const searchCache = new Map()
    const readSearchCache = (key) => {
      const hit = searchCache.get(key)
      if (!hit) return null
      if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) { searchCache.delete(key); return null }
      return hit.list
    }
    const writeSearchCache = (key, list) => {
      if (searchCache.size >= SEARCH_CACHE_MAX) {
        const oldest = searchCache.keys().next()
        if (!oldest.done) searchCache.delete(oldest.value)
      }
      searchCache.set(key, { at: Date.now(), list })
    }

    /** Open VSX 搜索返回项 → 客户端列表项(形状与既有实现一致)。 */
    const toSearchItem = (e) => ({
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
    })

    const SORTS = new Set(['downloadCount', 'rating', 'timestamp', 'relevance'])

    // ---- 各 RPC 方法体(与 Client 半区的 connection.rpc.call 配对) ----
    const handlers = {
      // ---- 扫描本地扩展目录:返回主题文件清单,并带上清单里的 uiTheme(明暗权威信号) ----
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
            // 清单主题项:保留 path → { label, uiTheme },供导入时判定明暗与命名
            let manifestThemes = null
            try {
              const pkgTarget = await fs.resolve('package.json', { cwd: base })
              const pkgInfo = await fs.stat(pkgTarget)
              if (pkgInfo !== undefined && pkgInfo.type === 'file') {
                const pkgText = await fs.readText(pkgTarget)
                // 扩展清单也可能是 JSONC(VS Code 用 JSONC 解析器读它)
                const pkg = tryParseJson(pkgText)
                if (pkg) {
                  if (typeof pkg.displayName === 'string' && pkg.displayName.trim()) display = pkg.displayName.trim()
                  const contrib = pkg.contributes && pkg.contributes.themes
                  if (Array.isArray(contrib)) {
                    manifestThemes = contrib
                      .filter((t) => t && typeof t.path === 'string' && /\.json$/i.test(t.path))
                      .map((t) => ({ path: normalizeRel(t.path), label: typeof t.label === 'string' ? t.label : '', uiTheme: typeof t.uiTheme === 'string' ? t.uiTheme : '' }))
                  }
                }
              }
            } catch { /* tolerate */ }
            const candidates = manifestThemes && manifestThemes.length > 0
              ? manifestThemes.map((t) => t.path)
              : ['themes']
            for (let ci = 0; ci < candidates.length; ci += 1) {
              if (themes.length >= 80) break
              const cand = candidates[ci]
              const meta = manifestThemes && manifestThemes[ci] ? manifestThemes[ci] : null
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
                    uiTheme: (meta && meta.uiTheme) || '',
                  })
                }
                if (tInfo.type === 'directory') {
                  const files = await fs.listDir(tTarget)
                  for (const file of files) {
                    if (file.type !== 'file' || !/\.json$/i.test(file.name)) continue
                    push(base + '/' + cand + '/' + file.name, file.name.replace(/\.json$/i, ''))
                  }
                } else if (tInfo.type === 'file') {
                  push(base + '/' + cand, (meta && meta.label) || cand.split('/').pop().replace(/\.json$/i, ''))
                }
              } catch { /* tolerate */ }
            }
          }
        }
        return { ok: true, home, roots: roots.length, themes }
      },

      // ---- 读取单个主题文件:JSONC 解析 + include 继承链 + 压缩载荷 ----
      'read-theme-file': async (args) => {
        const fs = ctx.get('fs')
        if (fs === undefined) return fail('fs-unavailable', '文件系统服务不可用')
        const path = args && typeof args.path === 'string' ? args.path : ''
        const uiTheme = args && typeof args.uiTheme === 'string' ? args.uiTheme : ''
        if (!path) return fail('read.no-path', '缺少文件路径')
        try {
          const target = await fs.resolve(path)
          const head = await fs.readText(target)
          if (head.length > MAX_THEME_FILE_BYTES) return fail('read.too-large', '主题文件超过 512KB 限制')
          // 顶层必须是 JSONC 可解析对象
          const rootRaw = tryParseJson(head)
          if (!rootRaw || typeof rootRaw !== 'object' || Array.isArray(rootRaw)) {
            return fail('read.parse-failed', '主题文件不是合法 JSON(支持 // 注释与尾随逗号)')
          }
          // 只有带 include 时才沿继承链继续读盘
          const readText = async (rel) => {
            if (rel === path) return head
            const t = await fs.resolve(rel)
            const text = await fs.readText(t)
            if (text.length > MAX_THEME_FILE_BYTES) throw new Error('include 文件超过 512KB 限制')
            return text
          }
          const merged = await loadIncludeChainAsync(readText, path)
          const theme = compactVsTheme(merged || rootRaw, uiTheme)
          if (!theme) return fail('read.parse-failed', '主题文件不是合法 JSON(支持 // 注释与尾随逗号)')
          if (!theme.colors['editor.background'] && !theme.colors['editorPane.background']) {
            return fail('read.no-background', '主题缺少 editor.background,无法构建调色板')
          }
          return { ok: true, theme }
        } catch (e) {
          return fail('read.failed', '读取失败:' + detailOf(e))
        }
      },

      // ---- fetch a raw theme JSON url (宿主全局 fetch;web 服务可能无可用 provider,不依赖它) ----
      // 形状不变:返回原文,由客户端用宽松 JSONC 解析(URL 主题同样常见带注释)
      'fetch-theme-url': async (args) => {
        const url = args && typeof args.url === 'string' ? args.url : ''
        if (!/^https?:\/\//i.test(url)) return fail('fetch.http-only', '仅支持 http(s) URL')
        try {
          const text = await curlText(url, MAX_THEME_FILE_BYTES, interactiveNet)
          return { ok: true, text }
        } catch (e) {
          return fail('fetch.failed', '获取失败:' + detailOf(e))
        }
      },

      // ---- 搜索 Open VSX 主题扩展:单次请求 + TTL 缓存 + 短超时 ----
      'search-open-vsx': async (args) => {
        const query = args && typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return fail('search.query-required', '请输入搜索关键词')
        const rawSort = args && typeof args.sortBy === 'string' ? args.sortBy : ''
        const sortBy = SORTS.has(rawSort) ? rawSort : 'downloadCount'
        const cacheKey = query.toLowerCase() + '|' + sortBy
        const cached = readSearchCache(cacheKey)
        if (cached) return { ok: true, list: cached }
        try {
          // 单次搜索请求即返回(不再逐项 detail/manifest 预检;主题判断在导入时完成,速度优先)
          const url = 'https://open-vsx.org/api/-/search?query=' + encodeURIComponent(query)
            + '&category=Themes&size=' + SEARCH_RESULT_SIZE + '&sortBy=' + sortBy + '&sortOrder=desc'
          const text = await curlText(url, 262144, interactiveNet)
          const data = tryParseJson(text)
          const exts = data && Array.isArray(data.extensions) ? data.extensions : []
          const list = exts.map(toSearchItem).filter((e) => e.namespace && e.name && e.downloadUrl).slice(0, 10)
          writeSearchCache(cacheKey, list)
          return { ok: true, list }
        } catch (e) {
          const msg = detailOf(e)
          if (/timeout|aborted|超时/i.test(msg)) return fail('search.timeout', '搜索超时,请稍后重试:' + msg)
          return fail('search.failed', '搜索失败:' + msg)
        }
      },

      // ---- 批量补充详情:一次 RPC 取代客户端 N 次单查(N=10 时省 9 个往返) ----
      'open-vsx-details': async (args) => {
        const items = args && Array.isArray(args.items) ? args.items : []
        const clean = []
        for (const item of items.slice(0, DETAIL_BATCH_MAX)) {
          if (!item || typeof item.namespace !== 'string' || typeof item.name !== 'string') continue
          if (!item.namespace || !item.name) continue
          clean.push({ namespace: item.namespace, name: item.name })
        }
        if (clean.length === 0) return { ok: true, details: {} }
        const settled = await Promise.allSettled(clean.map(async (item) => {
          const detail = tryParseJson(await curlText(
            'https://open-vsx.org/api/' + encodeURIComponent(item.namespace) + '/' + encodeURIComponent(item.name),
            131072, interactiveNet,
          ))
          let author = ''
          if (detail && typeof detail.author === 'string') author = detail.author.trim()
          else if (detail && detail.author && typeof detail.author === 'object' && typeof detail.author.name === 'string') author = detail.author.name.trim()
          let repository = ''
          if (detail && detail.repository && typeof detail.repository.url === 'string') repository = detail.repository.url.trim()
          return [item.namespace + '.' + item.name, {
            author,
            license: detail && typeof detail.license === 'string' && detail.license.trim() ? detail.license.trim() : '',
            url: detail && typeof detail.url === 'string' && detail.url.trim() ? detail.url.trim() : '',
            repository,
          }]
        }))
        const details = {}
        for (const r of settled) {
          if (r.status !== 'fulfilled' || !r.value) continue // 单项失败就跳过该项,不拖垮整批
          details[r.value[0]] = r.value[1]
        }
        return { ok: true, details }
      },

      // ---- 单条详情(保留:向后兼容旧客户端) ----
      'open-vsx-detail': async (args) => {
        const namespace = args && typeof args.namespace === 'string' ? args.namespace : ''
        const name = args && typeof args.name === 'string' ? args.name : ''
        if (!namespace || !name) return fail('detail.params', '参数不完整')
        try {
          const detail = tryParseJson(await curlText('https://open-vsx.org/api/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name), 131072, interactiveNet))
          let author = ''
          if (detail && typeof detail.author === 'string') author = detail.author.trim()
          else if (detail && detail.author && typeof detail.author === 'object' && typeof detail.author.name === 'string') author = detail.author.name.trim()
          let repository = ''
          if (detail && detail.repository && typeof detail.repository.url === 'string') repository = detail.repository.url.trim()
          return {
            ok: true,
            author,
            license: detail && typeof detail.license === 'string' && detail.license.trim() ? detail.license.trim() : '',
            url: detail && typeof detail.url === 'string' && detail.url.trim() ? detail.url.trim() : '',
            repository,
          }
        } catch (e) {
          return fail('detail.failed', '详情获取失败:' + detailOf(e))
        }
      },

      // ---- 下载 VSIX → 按需过滤解压 → 压缩主题载荷 ----
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
          let cached = false
          try {
            if (existsFile(cacheFile)) {
              const hit = readFileBytes(cacheFile)
              if (hit && hit.length > 0) { bytes = hit; cached = true }
            }
          } catch { /* not cached */ }

          // 冷缓存必须在这里下载。少了这一步,下面的解压会拿到 null,
          // 而损坏缓存的兜底分支又要求 cached 为真 —— 结果是「首次导入必然失败」
          // (报 install.bad-zip),而且缓存永远建不起来。这条路径由
          // scripts/e2e-import.mjs 的「冷缓存」用例守着。
          if (bytes === null || bytes.length === 0) {
            bytes = await curlBinary(url, MAX_VSIX_BYTES)
            cached = false
            try { writeFileBytes(cacheFile, bytes) } catch { /* cache best-effort */ }
          }

          // 按需解压:VSIX 里体积最大的是 readme/changelog/LICENSE/图标/itermcolors,
          // 而 package.json 与所有主题/include 目标一定是 .json。filter 在 inflate 之前
          // 拿到 originalSize,顺带做了解压炸弹与条目数防线。
          const unzipThemes = (buf) => {
            let budget = { total: 0, count: 0, bomb: false }
            const entries = unzipSync(buf, {
              filter: (file) => {
                const entryName = file.name
                if (!/\.json$/i.test(entryName)) return false
                if (entryName.indexOf('node_modules/') >= 0) return false
                const size = typeof file.originalSize === 'number' ? file.originalSize : (file.size || 0)
                if (size > MAX_THEME_FILE_BYTES) return false
                budget.count += 1
                budget.total += size
                if (budget.count > MAX_JSON_ENTRIES || budget.total > MAX_UNPACKED_BYTES) { budget.bomb = true; return false }
                return true
              },
            })
            return { entries, budget }
          }

          let files = null
          let budget = { bomb: false }
          try {
            const first = unzipThemes(bytes)
            files = first.entries
            budget = first.budget
          } catch (e) {
            // 缓存字节损坏(下载中断/磁盘截断)是「第二次导入突然失败」的常见成因:
            // 丢掉缓存重下一次,而不是把用户卡在一个永久失败的缓存上。
            if (!cached) return fail('install.bad-zip', '扩展包无法解压:' + detailOf(e))
            removeFile(cacheFile)
            bytes = await curlBinary(url, MAX_VSIX_BYTES)
            cached = false
            try { writeFileBytes(cacheFile, bytes) } catch { /* cache best-effort */ }
            try {
              const retry = unzipThemes(bytes)
              files = retry.entries
              budget = retry.budget
            } catch (e2) {
              return fail('install.bad-zip', '扩展包无法解压:' + detailOf(e2))
            }
          }
          if (budget.bomb) return fail('install.failed', '扩展包解压后超过安全限制')

          const decode = (buf) => new TextDecoder().decode(buf)
          // VSIX 标准布局为 extension/...;缺省时退回根布局
          const findEntry = (rel) => {
            const key = normalizeRel(rel)
            return files['extension/' + key] || files[key] || null
          }

          const pkgBuf = findEntry('package.json')
          if (!pkgBuf) return fail('install.no-package', '扩展包内未找到 package.json')
          const pkg = tryParseJson(decode(pkgBuf))
          if (!pkg || typeof pkg !== 'object') return fail('install.no-package', '扩展包内的 package.json 不是合法 JSON(hint: 已支持 JSONC 注释)')
          const contrib = pkg.contributes && Array.isArray(pkg.contributes.themes) ? pkg.contributes.themes : []
          if (contrib.length === 0) {
            return fail('install.no-themes', '该扩展的清单未声明任何颜色主题')
          }

          // 包内读取器:全部走同一份过滤后的条目表
          const readEntryText = (rel) => {
            const buf = findEntry(rel)
            if (!buf || buf.length > MAX_THEME_FILE_BYTES) return null
            try { return decode(buf) } catch { return null }
          }

          const themes = []
          let broken = 0
          for (const t of contrib.slice(0, MAX_THEMES_PER_EXTENSION)) {
            if (!t || typeof t.path !== 'string' || !/\.json$/i.test(t.path)) continue
            const rel = normalizeRel(t.path)
            try {
              const merged = loadIncludeChain(readEntryText, rel)
              if (!merged) { broken += 1; continue }
              const theme = compactVsTheme(merged, typeof t.uiTheme === 'string' ? t.uiTheme : '')
              if (!theme) { broken += 1; continue }
              if (!theme.colors['editor.background'] && !theme.colors['editorPane.background']) { broken += 1; continue }
              themes.push({
                label: String(t.label || rel.split('/').pop().replace(/\.json$/i, '')),
                uiTheme: typeof t.uiTheme === 'string' ? t.uiTheme : '',
                theme,
              })
            } catch { broken += 1 }
          }
          // 声明了主题却一个都没解出来:报真实原因,而不是让客户端误判「未贡献主题」
          if (themes.length === 0) {
            return fail('install.no-themes', '清单声明了 ' + contrib.length + ' 个颜色主题,但都未能解析(' + broken + ' 个失败)')
          }
          return {
            ok: true,
            extension: String(pkg.displayName || name),
            version: String(pkg.version || version || ''),
            cached,
            themes,
          }
        } catch (e) {
          return fail('install.failed', '安装失败:' + detailOf(e))
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
          return fail('persist.failed', '保存失败:' + detailOf(e))
        }
      },

      // ---- load theme library from ~/.dsh/dsh-themes.json ----
      'load-themes': async () => {
        try {
          const file = joinPath(homeDir() || tmpDir() || '.', '.dsh', 'dsh-themes.json')
          if (!existsFile(file)) return { ok: true, data: null }
          const text = readFileSyncUtf8(file)
          const data = tryParseJson(text)
          return { ok: true, data: data === undefined || data === null ? null : data }
        } catch (e) {
          return fail('load.failed', '读取失败:' + detailOf(e))
        }
      },
    }

    /**
     * 本地文件的 include 链:readText 是异步的(经 ctx.fs),与 VSIX 的内存版本分开。
     * 逻辑与 loadIncludeChain 一致,只是按需读盘,避免为无 include 的常见情形多读文件。
     */
    async function loadIncludeChainAsync(readText, startPath) {
      const seen = new Set()
      const walk = async (currentPath, depth) => {
        if (depth > INCLUDE_MAX_DEPTH || seen.has(currentPath)) return null
        seen.add(currentPath)
        const text = await readText(currentPath)
        if (typeof text !== 'string') return null
        const raw = tryParseJson(text)
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
        if (typeof raw.include !== 'string') return raw
        const base = await walk(resolveInclude(currentPath, raw.include), depth + 1)
        if (!base) return raw
        return {
          ...base,
          ...raw,
          colors: { ...(base.colors || {}), ...(raw.colors || {}) },
        }
      }
      return walk(startPath, 0)
    }

    // ---- 注册 RPC 路由:静态插件的 `harness.handle` 等价物 ----
    //
    // DSH ≥0.1.7-rc.1 的 `connection.rpc.handle(channel, handler)` 把路由注册在
    // connection 插件自身的 fiber 上
    // (`register(owner, …)` 的 `owner` 是 connection 服务的 ctx,
    //   内部执行 `owner.effect(() => owner.webServer.register(route))`),
    // 消费方插件没有 webServer 注入,调用即抛:
    //   Error: cannot get property "webServer" without inject
    // 过去只能靠在 profile 的 cordis.patch.yml 里给 connection 行补
    // `inject: [webRuntime, webServer]` 绕开(见 web profile 的既有补丁)。
    //
    // 官方为这类需求提供了 `connection.fetch.register`(HostConnectionFetch):
    // 精确 Fetch 路由由 connection 自有的 `/api` 前置路由转发,自带
    // Host/Origin 信任检查与浏览器会话鉴权(connection.admit),且完全不需要
    // 消费方注入 webServer。因此不再需要任何 profile 补丁。
    //
    // `/api/dsh-themes` 是精确路径,在 createSharedFetchHandler 里先于 `/api`
    // 的 RPC 拦截器命中,不会与其他插件的 /api 端点冲突。报文沿用 connection
    // 的 RPC 信封,Client 半区因此继续用官方 rpc.call 调用:
    //   client-request  { type, rpcId, method, payload }
    //   server-response { type, rpcId, result: { ok: true, value } | { ok: false, error } }
    // result 的信封形状必须符合 rpcResultSchema:
    //   { ok: true, value } | { ok: false, error: { code, message, details } }
    // (details 必须是对象,Client 的 parseConnectionResponse 会校验)
    // 因此这里统一把各方法体返回的 { ok, ...data } / { ok: false, error }
    // 转换成官方信封,方法体本身保持不变。
    const ROUTE_PATH = '/api/dsh-themes'
    const rpcError = (code, message) => ({
      code: String(code),
      message: String(message),
      details: { issues: [] },
    })
    const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
    const rpcResponse = (rpcId, result) => jsonResponse(200, { type: 'server-response', rpcId, result })

    const handleRpc = async (message) => {
      const rpcId = message && typeof message.rpcId === 'string' ? message.rpcId : null
      if (rpcId === null) return jsonResponse(400, rpcError('bad-request', 'RPC 报文缺少 rpcId'))
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {}
      const method = typeof payload.method === 'string' ? payload.method : ''
      const handler = handlers[method]
      if (handler === undefined) return rpcResponse(rpcId, { ok: false, error: rpcError('unknown-method', '未知方法:' + method) })
      try {
        const result = await handler(payload.args)
        if (result && result.ok === true) {
          const { ok, ...data } = result
          return rpcResponse(rpcId, { ok: true, value: data })
        }
        // 方法体返回 { ok: false, error: { code, message } }:code 进入信封,Client 按码本地化
        const err = result && result.error
        if (err && typeof err === 'object' && typeof err.code === 'string') {
          return rpcResponse(rpcId, { ok: false, error: rpcError(err.code, (err && err.message) || err.code) })
        }
        return rpcResponse(rpcId, { ok: false, error: rpcError('rpc.failed', (err && err.message) || String(err) || '调用失败') })
      } catch (e) {
        return rpcResponse(rpcId, { ok: false, error: rpcError('rpc.failed', (e && e.message) || String(e)) })
      }
    }

    ctx.effect(() => {
      // 缺少 fetch 注册表时给出可诊断的错误(而不是 undefined.register 的 TypeError)
      if (typeof ctx.connection.fetch?.register !== 'function') {
        throw new Error('dsh-themes 需要 connection.fetch(DSH >=0.1.5-rc.1 的 HostConnectionFetch)')
      }
      const dispose = ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let message = null
          try { message = await request.json() } catch { /* 非法 JSON 走下方 400 */ }
          if (!message || typeof message !== 'object' || message.type !== 'client-request') {
            return jsonResponse(400, rpcError('bad-request', '非法 RPC 报文'))
          }
          return await handleRpc(message)
        },
      })
      return () => { void dispose() }
    }, 'dsh-themes: /api/dsh-themes route')
  },
}
