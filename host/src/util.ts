// 跨平台网络与本地存储工具。
//
// 旧实现经由 ctx.shell 调用 curl/mkdir/rm/unzip/printf/base64 等命令:
// 这些命令是 Unix 方言,在 Windows(pwsh/cmd)下不可用或语义不同——
// 例如 `printf %s "$HOME"` 在 pwsh 里找不到 printf,`base64 -d`、`unzip`
// 在 Windows 上根本不存在,`/tmp/...` 会被 pwsh 解析成 <当前盘>:\tmp\...。
// 这正是 Windows 上搜索报错("mkdir : Access to the path ... denied")的根因。
//
// 参考 dsh-market(https://github.com/dsh-market/dsh-market)的跨平台做法:
//   - 网络一律用宿主进程的全局 fetch + AbortSignal.timeout,不依赖 shell/curl/临时文件;
//   - 本地文件用 node 内置模块,不经 shell 也不经 ctx.fs(私有状态直接读写,跨平台一致)。
//
// 宿主 bundle 以「函数体」方式加载(new Function(src)()),作用域内没有 require,
// 因此 node 内置模块统一通过 process.getBuiltinModule 获取(Node ≥ 22.3;DSH 运行于 Node 24)。
// fflate 是纯 JS 库,由打包器静态内联进 bundle,无运行时依赖。

function builtin(id) {
  if (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
    try { return process.getBuiltinModule(id) } catch { /* fall through */ }
  }
  return null
}

export function makeShell(ctx) {
  const os = builtin('node:os')
  const fs = builtin('node:fs')
  const path = builtin('node:path')

  // ---- 目录发现(节点内置 os;不再走 shell 打印环境变量) ----
  function homeDir() {
    try {
      if (os && typeof os.homedir === 'function') {
        const h = os.homedir()
        if (h) return h
      }
    } catch { /* ignore */ }
    if (typeof process !== 'undefined' && process.env) {
      return process.env.USERPROFILE || process.env.HOME || null
    }
    return null
  }

  function tmpDir() {
    try {
      if (os && typeof os.tmpdir === 'function') {
        const t = os.tmpdir()
        if (t) return t
      }
    } catch { /* ignore */ }
    if (typeof process !== 'undefined' && process.env) {
      return process.env.TEMP || process.env.TMP || process.env.TMPDIR || null
    }
    return null
  }

  function joinPath(...parts) {
    if (path && typeof path.join === 'function') return path.join(...parts)
    return parts.filter((p) => p).join('/')
  }

  // ---- 网络(全局 fetch,与 dsh-market 相同的模式) ----
  const NET_RETRYABLE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network error|socket hang up|aborted|timeout/i

  async function fetchWithCap(url, maxBytes, binary) {
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
          headers: { 'accept-encoding': 'gzip, deflate, br' },
        })
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status + ' ' + (res.statusText || ''))
          err.status = res.status
          throw err
        }
        const declared = Number(res.headers.get('content-length')) || 0
        if (declared > maxBytes) throw new Error('响应超过大小限制 (' + declared + ' > ' + maxBytes + ' bytes)')
        if (binary) {
          const buf = await res.arrayBuffer()
          if (buf.byteLength > maxBytes) throw new Error('响应超过大小限制 (' + buf.byteLength + ' > ' + maxBytes + ' bytes)')
          return new Uint8Array(buf)
        }
        // 文本:流式读取并按字节数限长(无 content-length 的响应也不会失控)
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader()
          const chunks = []
          let total = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value ? value.length : 0
            if (total > maxBytes) {
              try { await reader.cancel() } catch { /* ignore */ }
              throw new Error('响应超过大小限制')
            }
            chunks.push(value)
          }
          const merged = new Uint8Array(total)
          let offset = 0
          for (const chunk of chunks) {
            if (chunk) { merged.set(chunk, offset); offset += chunk.length }
          }
          return new TextDecoder().decode(merged)
        }
        const text = await res.text()
        if (text.length > maxBytes) throw new Error('响应超过大小限制')
        return text
      } catch (e) {
        lastError = e
        const status = e && e.status
        const msg = String((e && e.message) || e)
        const retryable = NET_RETRYABLE.test(msg) || status === 429 || status >= 500
        if (!retryable || attempt >= 2) throw e
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    throw lastError
  }

  /** 拉取文本(≤ maxBytes 字节),网络类错误自动重试 3 次。 */
  async function curlText(url, maxBytes) {
    return fetchWithCap(url, maxBytes, false)
  }

  /** 拉取二进制(≤ maxBytes 字节),网络类错误自动重试 3 次。 */
  async function curlBinary(url, maxBytes) {
    return fetchWithCap(url, maxBytes, true)
  }

  // ---- 本地文件(节点内置 fs,直接读写宿主文件系统;不经 shell / ctx.fs) ----
  function readFileSyncUtf8(file) {
    if (!fs || typeof fs.readFileSync !== 'function') throw new Error('node:fs unavailable')
    return fs.readFileSync(file, 'utf8')
  }

  function readFileBytes(file) {
    if (!fs || typeof fs.readFileSync !== 'function') throw new Error('node:fs unavailable')
    return new Uint8Array(fs.readFileSync(file))
  }

  function writeFileSyncUtf8(file, text) {
    if (!fs || typeof fs.writeFileSync !== 'function') throw new Error('node:fs unavailable')
    const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
    const dir = idx > 0 ? file.slice(0, idx) : ''
    if (dir && typeof fs.mkdirSync === 'function') {
      try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    }
    fs.writeFileSync(file, text, 'utf8')
  }

  function writeFileBytes(file, bytes) {
    if (!fs || typeof fs.writeFileSync !== 'function') throw new Error('node:fs unavailable')
    const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
    const dir = idx > 0 ? file.slice(0, idx) : ''
    if (dir && typeof fs.mkdirSync === 'function') {
      try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    }
    fs.writeFileSync(file, bytes)
  }

  function existsFile(file) {
    if (!fs || typeof fs.existsSync !== 'function') return false
    try { return fs.existsSync(file) } catch { return false }
  }

  return {
    homeDir,
    tmpDir,
    joinPath,
    curlText,
    curlBinary,
    readFileSyncUtf8,
    readFileBytes,
    writeFileSyncUtf8,
    writeFileBytes,
    existsFile,
  }
}
