// shell/curl 工具工厂(经 ctx 获取 shell 与 fs 服务;并发安全:每次使用唯一临时文件,网络类错误自动重试)
export function makeShell(ctx) {
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

    return { homeDir, tmpDir, runShell, curlText }
}
