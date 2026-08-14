// DSH 主题 (dsh-themes) — Host 半区
// 本文件内容即 cordis_define 的 code.host(纯 JavaScript 函数体)。
// 提供六个 Package-private RPC,供 Client 半区调用:
//   scan-vscode-themes  扫描本地 VS Code / Cursor 扩展目录中的主题文件
//   read-theme-file     读取单个主题 JSON 文件
//   fetch-theme-url     获取原始主题 JSON URL(经 shell + curl,不依赖 web 服务 provider)
//   search-open-vsx     搜索 Open VSX 主题扩展(经 shell + curl)
//   install-open-vsx    下载 VSIX、解压并列出贡献的主题(依赖 curl/unzip)
//   persist-themes      持久化主题库到 ~/.dsh/dsh-themes.json
//   load-themes         读取持久化的主题库
return {
  apply(ctx) {
    // ---- home directory discovery (for VS Code extension roots) ----
    async function homeDir() {
      const shell = ctx.get('shell')
      if (shell !== undefined) {
        try {
          const spec = shell.resolve({ command: 'printf %s "$HOME"', timeoutMs: 5000, stdoutMaxBytes: 8192 })
          const result = await shell.run(spec)
          if (result.exitCode === 0 && result.stdout && result.stdout.text && result.stdout.text.trim()) {
            return result.stdout.text.trim()
          }
        } catch {
          /* fall through */
        }
      }
      return null
    }

    // ---- scan local VS Code / Cursor extension dirs for *-color-theme.json ----
    harness.handle('scan-vscode-themes', async (args) => {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: '文件系统服务不可用' }
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
      if (roots.length === 0) return { ok: false, error: '未找到扩展目录,请在输入框中填写扩展目录路径' }
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
    })

    // ---- read one theme file(解析 include 继承链,最多 8 层,防循环) ----
    harness.handle('read-theme-file', async (args) => {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: '文件系统服务不可用' }
      const path = args && typeof args.path === 'string' ? args.path : ''
      if (!path) return { ok: false, error: '缺少文件路径' }
      try {
        const target = await fs.resolve(path)
        const text = await fs.readText(target)
        if (text.length > 512 * 1024) return { ok: false, error: '主题文件超过 512KB 限制' }
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
        return { ok: false, error: '读取失败:' + ((e && e.message) || String(e)) }
      }
    })

    // ---- fetch a raw theme JSON url (shell + curl;web 服务可能无可用 provider) ----
    harness.handle('fetch-theme-url', async (args) => {
      const url = args && typeof args.url === 'string' ? args.url : ''
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http(s) URL' }
      try {
        const text = await curlText(url, 524288)
        return { ok: true, text }
      } catch (e) {
        return { ok: false, error: '获取失败:' + ((e && e.message) || String(e)) }
      }
    })

    // ---- shell helpers ----

    async function tmpDir() {
      const shell = ctx.get('shell')
      if (shell === undefined) return null
      try {
        const spec = shell.resolve({ command: 'printf %s "$TMPDIR"', timeoutMs: 5000, stdoutMaxBytes: 8192 })
        const result = await shell.run(spec)
        if (result.exitCode === 0 && result.stdout && result.stdout.text && result.stdout.text.trim()) {
          return result.stdout.text.trim()
        }
      } catch { /* fall through */ }
      return null
    }

    async function runShell(command) {
      const shell = ctx.get('shell')
      if (shell === undefined) throw new Error('shell 服务不可用')
      const spec = shell.resolve({ command, timeoutMs: 120000, stdoutMaxBytes: 65536 })
      const result = await shell.run(spec)
      if (result.exitCode !== 0) {
        const tail = result.stderr && result.stderr.text ? result.stderr.text.slice(0, 300) : ''
        throw new Error('命令失败(exit ' + result.exitCode + '):' + tail)
      }
      return result
    }

    /** 用 curl 获取文本内容(web 服务可能无可用 provider,shell + curl 始终可用)。并发安全:每次使用唯一临时文件;网络类错误自动重试。 */
    async function curlText(url, maxBytes) {
      const fs = ctx.get('fs')
      if (fs === undefined) throw new Error('文件系统服务不可用')
      let home = null
      try { home = await homeDir() } catch { /* ignore */ }
      let tmp = null
      try { tmp = await tmpDir() } catch { /* ignore */ }
      const dir = (tmp || home || '/tmp') + '/dsh-themes/curl'
      const out = dir + '/out-' + Math.random().toString(36).slice(2) + '.bin'
      await runShell('mkdir -p "' + dir + '"')
      // 网络类错误(连接失败/超时/TLS 握手中断等)重试,其余错误(404 等)直接抛出
      const RETRYABLE = /exit (7|28|35|52|53|55|56)\b/
      let lastError = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await runShell('curl -fsSL --compressed --connect-timeout 10 --tlsv1.2 --max-filesize ' + maxBytes + ' -o "' + out + '" "' + url + '"')
          const target = await fs.resolve(out)
          const text = await fs.readText(target)
          await runShell('rm -f "' + out + '"').catch(() => {})
          return text
        } catch (e) {
          lastError = e
          const msg = String((e && e.message) || e)
          const httpMatch = /HTTP\/(?:1[.\d]*|2)\s+(\d{3})/.exec(msg)
          const httpRetry = httpMatch && (httpMatch[1] === '429' || httpMatch[1] >= '500')
          if ((!RETRYABLE.test(msg) && !httpRetry) || attempt >= 2) {
            await runShell('rm -f "' + out + '"').catch(() => {})
            throw e
          }
          await runShell('sleep 1').catch(() => {})
        }
      }
      await runShell('rm -f "' + out + '"').catch(() => {})
      throw lastError
    }

    // ---- search Open VSX for theme extensions (shell + curl;category=Themes + manifest 主题数过滤) ----
    harness.handle('search-open-vsx', async (args) => {
      const query = args && typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return { ok: false, error: '请输入搜索关键词' }
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
        })).filter((e) => e.namespace && e.name && e.downloadUrl).slice(0, 10)
        return { ok: true, list }
      } catch (e) {
        return { ok: false, error: '搜索失败:' + ((e && e.message) || String(e)) }
      }
    })

    // ---- download a VSIX(带版本缓存),unzip,并直接返回贡献主题的完整 JSON(include 已合并,并行读取) ----
    harness.handle('install-open-vsx', async (args) => {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: '文件系统服务不可用' }
      const namespace = args && typeof args.namespace === 'string' ? args.namespace : ''
      const name = args && typeof args.name === 'string' ? args.name : ''
      const url = args && typeof args.downloadUrl === 'string' ? args.downloadUrl : ''
      const version = args && typeof args.version === 'string' ? args.version : ''
      if (!namespace || !name || !url) return { ok: false, error: '参数不完整' }
      try {
        let home = null
        try { home = await homeDir() } catch { /* ignore */ }
        let tmp = null
        try { tmp = await tmpDir() } catch { /* ignore */ }
        const dir = (tmp || home || '/tmp') + '/dsh-themes/' + namespace + '.' + name + '/' + (version || 'latest')
        // 版本化缓存:已解压过则跳过下载,重复导入秒开
        let cached = false
        try {
          const pkgTarget = await fs.resolve(dir + '/unpacked/extension/package.json')
          const pkgInfo = await fs.stat(pkgTarget)
          cached = pkgInfo !== undefined && pkgInfo.type === 'file'
        } catch { /* not cached */ }
        if (!cached) {
          await runShell('rm -rf "' + dir + '" && mkdir -p "' + dir + '"')
          await runShell('curl -fsSL --compressed --max-filesize 20971520 -o "' + dir + '/ext.vsix" "' + url + '"')
          await runShell('unzip -o -q "' + dir + '/ext.vsix" -d "' + dir + '/unpacked"')
        }

        let pkgText = null
        for (const candidate of [dir + '/unpacked/extension/package.json', dir + '/unpacked/package.json']) {
          try {
            const target = await fs.resolve(candidate)
            const info = await fs.stat(target)
            if (info !== undefined && info.type === 'file') {
              pkgText = await fs.readText(target)
              break
            }
          } catch { /* try next */ }
        }
        if (pkgText === null) return { ok: false, error: '扩展包内未找到 package.json' }
        let pkg = null
        try { pkg = JSON.parse(pkgText) } catch { /* tolerate */ }
        const contrib = pkg && pkg.contributes && pkg.contributes.themes
        const themes = []
        if (Array.isArray(contrib)) {
          // 并行读取全部主题文件(含 include 合并,深度上限 8)
          const readTheme = async (t) => {
            if (!t || typeof t.path !== 'string' || !/\.json$/i.test(t.path)) return null
            const rel = t.path.replace(/^\.\//, '')
            const seen = new Set()
            const loadChain = async (currentPath, depth) => {
              if (depth > 8 || seen.has(currentPath)) return null
              seen.add(currentPath)
              try {
                const target = await fs.resolve(currentPath)
                const info = await fs.stat(target)
                if (info === undefined || info.type !== 'file') return null
                const rawText = await fs.readText(target)
                if (rawText.length > 512 * 1024) return null
                let raw = null
                try { raw = JSON.parse(rawText) } catch { return null }
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
                if (typeof raw.include !== 'string') return raw
                const slash = currentPath.lastIndexOf('/')
                const d = slash >= 0 ? currentPath.slice(0, slash) : '.'
                const includePath = raw.include.startsWith('./') ? d + '/' + raw.include.slice(2) : d + '/' + raw.include
                const base = await loadChain(includePath, depth + 1)
                if (!base) return raw
                return { ...base, ...raw, colors: { ...(base.colors || {}), ...(raw.colors || {}) } }
              } catch { return null }
            }
            const merged = await loadChain(dir + '/unpacked/extension/' + rel, 0)
            if (!merged) return null
            return {
              label: String(t.label || rel.split('/').pop().replace(/\.json$/i, '')),
              uiTheme: String(t.uiTheme || ''),
              text: JSON.stringify(merged),
            }
          }
          const results = await Promise.all(contrib.slice(0, 40).map(readTheme))
          for (const r of results) if (r) themes.push(r)
        }
        return {
          ok: true,
          extension: String((pkg && pkg.displayName) || name),
          version: String((pkg && pkg.version) || ''),
          themes,
        }
      } catch (e) {
        return { ok: false, error: '安装失败:' + ((e && e.message) || String(e)) }
      }
    })

    // ---- persist theme library to ~/.dsh/dsh-themes.json ----
    harness.handle('persist-themes', async (args) => {
      const payload = args && args.payload ? args.payload : null
      if (payload === null) return { ok: false, error: '缺少数据' }
      try {
        const json = JSON.stringify(payload)
        const b64 = btoa(json)
        let home = null
        try { home = await homeDir() } catch { /* ignore */ }
        const root = home || '/tmp'
        await runShell('mkdir -p "' + root + '/.dsh"')
        await runShell('printf %s "' + b64 + '" | base64 -d > "' + root + '/.dsh/dsh-themes.json"')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: '保存失败:' + ((e && e.message) || String(e)) }
      }
    })

    // ---- load theme library from ~/.dsh/dsh-themes.json ----
    harness.handle('load-themes', async () => {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: '文件系统服务不可用' }
      try {
        let home = null
        try { home = await homeDir() } catch { /* ignore */ }
        const path = (home || '/tmp') + '/.dsh/dsh-themes.json'
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        if (info === undefined || info.type !== 'file') return { ok: true, data: null }
        const text = await fs.readText(target)
        let data = null
        try { data = JSON.parse(text) } catch { /* tolerate */ }
        return { ok: true, data }
      } catch (e) {
        return { ok: false, error: '读取失败:' + ((e && e.message) || String(e)) }
      }
    })
  },
}
