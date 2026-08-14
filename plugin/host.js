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

    // ---- read one theme file ----
    harness.handle('read-theme-file', async (args) => {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: '文件系统服务不可用' }
      const path = args && typeof args.path === 'string' ? args.path : ''
      if (!path) return { ok: false, error: '缺少文件路径' }
      try {
        const target = await fs.resolve(path)
        const text = await fs.readText(target)
        if (text.length > 512 * 1024) return { ok: false, error: '主题文件超过 512KB 限制' }
        return { ok: true, text }
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
          await runShell('curl -fsSL --connect-timeout 10 --tlsv1.2 --max-filesize ' + maxBytes + ' -o "' + out + '" "' + url + '"')
          const target = await fs.resolve(out)
          const text = await fs.readText(target)
          await runShell('rm -f "' + out + '"').catch(() => {})
          return text
        } catch (e) {
          lastError = e
          const msg = String((e && e.message) || e)
          if (!RETRYABLE.test(msg) || attempt >= 2) {
            await runShell('rm -f "' + out + '"').catch(() => {})
            throw e
          }
          await runShell('sleep 1').catch(() => {})
        }
      }
      await runShell('rm -f "' + out + '"').catch(() => {})
      throw lastError
    }

    // ---- search Open VSX for theme extensions (shell + curl;按类别过滤非主题扩展) ----
    harness.handle('search-open-vsx', async (args) => {
      const query = args && typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return { ok: false, error: '请输入搜索关键词' }
      try {
        const url = 'https://open-vsx.org/api/-/search?query=' + encodeURIComponent(query) + '&size=20&sortBy=downloadCount'
        const text = await curlText(url, 262144)
        const data = JSON.parse(text)
        const exts = Array.isArray(data.extensions) ? data.extensions : []
        const base = exts.map((e) => ({
          namespace: String(e.namespace || ''),
          name: String(e.name || ''),
          displayName: String(e.displayName || e.name || ''),
          version: String(e.version || ''),
          downloadCount: Number(e.downloadCount) || 0,
          downloadUrl: e.files && typeof e.files.download === 'string' ? e.files.download : null,
        })).filter((e) => e.namespace && e.name && e.downloadUrl)

        // 详情 API:过滤非 Themes 类扩展,并统计其贡献的颜色主题数量(curlText 内部已重试)
        const kept = []
        let idx = 0
        const fetchDetail = async (entry) => {
          let detail = null
          try {
            detail = JSON.parse(await curlText('https://open-vsx.org/api/' + encodeURIComponent(entry.namespace) + '/' + encodeURIComponent(entry.name), 131072))
          } catch { /* 详情失败,保留条目但主题数未知 */ }
          if (detail === null) { kept.push({ ...entry, themeCount: -1 }); return }
          const cats = Array.isArray(detail.categories) ? detail.categories : []
          if (!cats.some((c) => /theme/i.test(String(c)))) return // 非主题类扩展,过滤
          let themeCount = 0
          try {
            if (detail.files && typeof detail.files.manifest === 'string') {
              const manifest = JSON.parse(await curlText(detail.files.manifest, 131072))
              const contrib = manifest.contributes && manifest.contributes.themes
              themeCount = Array.isArray(contrib) ? contrib.length : 0
            }
          } catch { /* themeCount 保持 0 */ }
          kept.push({ ...entry, themeCount })
        }
        const workers = Math.min(5, base.length)
        await Promise.all(Array.from({ length: workers }, async () => {
          while (idx < base.length) {
            const entry = base[idx]
            idx += 1
            await fetchDetail(entry)
          }
        }))
        return { ok: true, list: kept, filtered: base.length - kept.length }
      } catch (e) {
        return { ok: false, error: '搜索失败:' + ((e && e.message) || String(e)) }
      }
    })

    // ---- download a VSIX, unzip it, and list its contributed themes ----
    harness.handle('install-open-vsx', async (args) => {
      const fs = ctx.get('fs')
      if (fs === undefined) return { ok: false, error: '文件系统服务不可用' }
      const namespace = args && typeof args.namespace === 'string' ? args.namespace : ''
      const name = args && typeof args.name === 'string' ? args.name : ''
      const url = args && typeof args.downloadUrl === 'string' ? args.downloadUrl : ''
      if (!namespace || !name || !url) return { ok: false, error: '参数不完整' }
      try {
        let home = null
        try { home = await homeDir() } catch { /* ignore */ }
        let tmp = null
        try { tmp = await tmpDir() } catch { /* ignore */ }
        const dir = (tmp || home || '/tmp') + '/dsh-themes/' + namespace + '.' + name
        await runShell('rm -rf "' + dir + '" && mkdir -p "' + dir + '"')
        await runShell('curl -fsSL --max-filesize 20971520 -o "' + dir + '/ext.vsix" "' + url + '"')
        await runShell('unzip -o -q "' + dir + '/ext.vsix" -d "' + dir + '/unpacked"')

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
          for (const t of contrib) {
            if (themes.length >= 40) break
            if (!t || typeof t.path !== 'string' || !/\.json$/i.test(t.path)) continue
            themes.push({
              path: dir + '/unpacked/extension/' + t.path.replace(/^\.\//, ''),
              label: String(t.label || t.path.split('/').pop().replace(/\.json$/i, '')),
              uiTheme: String(t.uiTheme || ''),
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
