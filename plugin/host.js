// DSH 主题 (dsh-themes) — Host 半区
// 本文件内容即 cordis_define 的 code.host(纯 JavaScript 函数体)。
// 提供三个 Package-private RPC,供 Client 半区调用:
//   scan-vscode-themes  扫描本地 VS Code / Cursor 扩展目录中的主题文件
//   read-theme-file     读取单个主题 JSON 文件
//   fetch-theme-url     通过 DSH web 服务获取原始主题 JSON URL
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

    // ---- fetch a raw theme JSON url ----
    harness.handle('fetch-theme-url', async (args) => {
      const web = ctx.get('web')
      if (web === undefined) return { ok: false, error: '网络服务不可用' }
      const url = args && typeof args.url === 'string' ? args.url : ''
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http(s) URL' }
      try {
        const result = await web.fetch({ url })
        if (result.statusCode < 200 || result.statusCode >= 300) return { ok: false, error: 'HTTP ' + result.statusCode }
        const content = result.body && (result.body.kind === 'text' || result.body.kind === 'html') ? result.body.content : null
        if (content === null) return { ok: false, error: '响应不是文本内容' }
        if (content.length > 512 * 1024) return { ok: false, error: '内容超过 512KB 限制' }
        return { ok: true, text: content }
      } catch (e) {
        return { ok: false, error: '获取失败:' + ((e && e.message) || String(e)) }
      }
    })
  },
}
