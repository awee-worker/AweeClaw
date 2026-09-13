/**
 * ONLYOFFICE Docs 服务器端桥接网关（与 Document Server 同机部署）
 *
 * 链路：
 *   浏览器打开 https://<域>/oo-gw/demo.html?file=xxx.xlsx
 *     → 加载 DS 编辑器（https://<DS 域>/web-apps/apps/api/documents/api.js）
 *     → DS 通过 /oo-gw/files/<name> 拉取原文件
 *     → 用户编辑
 *     → DS 保存回调 POST /oo-gw/callback?file=<name>
 *     → 网关下载 DS 保存结果，原子写回 /data/<name>
 *
 * 零外部依赖（仅 Node 内置 http/https/crypto/fs），随 docker-compose 以
 * node:20-alpine 运行，代码目录挂载进容器，无需构建镜像。
 *
 * 环境变量：
 *   GW_PORT          监听端口（容器内 8090，compose 仅暴露 127.0.0.1:8090）
 *   DATA_DIR         文件存储目录（compose 挂 volume，默认 /data）
 *   DOC_SERVER       DS 公网基址（用于 demo 页加载 api.js），如 https://onlyoffice.aweeclaw.com
 *   PUBLIC_BASE_URL  网关对外基址，如 https://onlyoffice.aweeclaw.com/oo-gw
 *   JWT_SECRET       与 DS 一致的签名 secret（留空则跳过签名/验签，仅内网调试用）
 *   MAX_UPLOAD_BYTES 上传大小上限（默认 50MB）
 */
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = Number(process.env.GW_PORT || 8090)
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data')
const DOC_SERVER = (process.env.DOC_SERVER || '').replace(/\/+$/, '')
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
const JWT_SECRET = process.env.JWT_SECRET || ''
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024)
// DS 内部地址（容器网络内用 compose 服务名；宿主调试可设 http://127.0.0.1:<DS_PORT>）
const DS_INTERNAL = (process.env.DS_INTERNAL || 'http://onlyoffice-document-server').replace(/\/+$/, '')
// 管理操作（强制保存/删除）的共享密钥：未设置则放行（仅内网调试），公网部署务必设置
const GW_ADMIN_KEY = process.env.GW_ADMIN_KEY || ''
// 上传文档的 TTL 过期清理（小时）
const TTL_HOURS = Number(process.env.TTL_HOURS || 24)

// 文档类型白名单（防上传任意文件）
const EXT_TYPE = {
  docx: 'word', doc: 'word', odt: 'word', txt: 'word', rtf: 'word',
  xlsx: 'cell', xls: 'cell', csv: 'cell', ods: 'cell',
  pptx: 'slide', ppt: 'slide', odp: 'slide',
}
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  csv: 'text/csv', txt: 'text/plain', odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', rtf: 'application/rtf',
}

fs.mkdirSync(DATA_DIR, { recursive: true })

function log(...a) { console.log(new Date().toISOString(), '[gw]', ...a) }
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}
function readBodyRaw(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body 超过大小上限')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
function safeName(name) {
  const base = path.basename(String(name || ''))
  if (!base || base === '.' || base === '..' || base.includes('/') || base.includes('\\')) return null
  return base
}
function docMetaOf(file) {
  const ext = path.extname(file).toLowerCase().replace('.', '')
  const documentType = EXT_TYPE[ext] || 'cell'
  const title = path.basename(file)
  return { ext, documentType, title, mime: MIME[ext] || 'application/octet-stream' }
}
function fileKey(file) {
  // key = 文件名 + 内容指纹（mtime+size），文件被保存回写后 key 变化 → DS 下次强制重载
  try {
    const s = fs.statSync(path.join(DATA_DIR, file))
    return `${file}:${s.size}:${Math.floor(s.mtimeMs)}`
  } catch { return `${file}:0` }
}
/** DS 会话 document.key：fileKey 的 sha1 十六进制摘要（渲染宿主页与 forcesave 命令必须使用同一值，否则强制保存找不到编辑会话） */
function documentKeyOf(file) {
  return crypto.createHash('sha1').update(fileKey(file)).digest('hex')
}

/* ---------------- JWT (HS256) 无依赖实现 ---------------- */
function b64url(buf) { return Buffer.from(buf).toString('base64url') }
function jwtSign(obj) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(obj))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
function jwtVerify(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest()
  const expect = Buffer.from(parts[2], 'base64url')
  if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return null
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) } catch { return null }
}
function bearerOf(req) {
  const h = req.headers['authorization'] || ''
  return h.startsWith('Bearer ') ? h.slice(7) : (req.headers['authorization'] || '')
}

/* ---------------- 下载 DS 保存结果 ---------------- */
function downloadUrl(savedUrl) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(savedUrl) } catch { return reject(new Error('无效保存 URL')) }
    // 容器网络内地址（onlyoffice-ds / 127 / localhost）→ 改走公网基址
    const inner = ['127.0.0.1', 'localhost', 'onlyoffice-ds', 'onlyoffice-document-server'].includes(u.hostname)
    if (inner && DOC_SERVER) {
      u = new URL(DOC_SERVER + u.pathname + u.search)
    }
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'oo-gateway' } },
      (res) => {
        if (res.statusCode !== 200) { reject(new Error(`下载保存文件失败 HTTP ${res.statusCode}`)); res.resume(); return }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.end()
  })
}
async function atomicWrite(file, buffer) {
  const target = path.join(DATA_DIR, file)
  const tmp = target + '.tmp'
  await fs.promises.writeFile(tmp, buffer)
  await fs.promises.rename(tmp, target)
}

/* ---------------- 辅助：HTML 转义 / HTTP JSON / 强制保存 ---------------- */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 发 JSON 请求并解析响应（供 DS CommandService 调用） */
function requestJson({ method = 'GET', url, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(new Error('无效 URL: ' + url)) }
    const lib = u.protocol === 'http:' ? http : https
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method,
        headers: {
          'User-Agent': 'oo-gateway',
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          let json = null
          try { json = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          }
          resolve(json)
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function statOf(file) {
  try {
    const s = await fs.promises.stat(path.join(DATA_DIR, file))
    return { size: s.size, mtimeMs: s.mtimeMs }
  } catch { return null }
}

/** 管理操作鉴权：设置 GW_ADMIN_KEY 后须带同值 x-gw-key 头 */
function adminOk(req) {
  if (!GW_ADMIN_KEY) return true
  return req.headers['x-gw-key'] === GW_ADMIN_KEY
}

/**
 * 触发 DS force save 并等待保存回调回写落盘。
 * 返回最终文件状态与是否发生变化；文档未在编辑会话（error=4）时视为无需保存。
 */
async function forceSaveAndWait(file, timeoutMs = 25000, stableMs = 1500) {
  const before = await statOf(file)
  if (!before) throw new Error('文件不存在')
  let cmdError = null
  try {
    const payload = { c: 'forcesave', key: documentKeyOf(file) }
    const headers = {}
    if (JWT_SECRET) headers['Authorization'] = 'Bearer ' + jwtSign(payload)
    const r = await requestJson({
      method: 'POST',
      url: DS_INTERNAL + '/coauthoring/CommandService.ashx',
      headers,
      body: payload,
    })
    // error:0 已受理；error:4 文档未打开（无编辑会话，无需保存）
    if (r && r.error !== 0 && r.error !== 4) cmdError = `DS force save 返回 error=${r.error}`
  } catch (e) {
    cmdError = e.message
  }

  const started = Date.now()
  let last = before
  let stableSince = Date.now()
  while (Date.now() - started < timeoutMs) {
    const cur = await statOf(file)
    if (!cur) break
    if (cur.mtimeMs !== last.mtimeMs || cur.size !== last.size) {
      last = cur
      stableSince = Date.now()
    } else if (Date.now() - stableSince >= stableMs) {
      break
    }
    await sleep(500)
  }
  const after = await statOf(file)
  const changed = !!after && (after.mtimeMs !== before.mtimeMs || after.size !== before.size)
  return { ...after, changed, cmdError }
}

/* ---------------- 宿主页 ---------------- */
function renderDemo(file, displayTitle) {
  const { ext, documentType, title } = docMetaOf(file)
  const safeTitle = String(displayTitle || title).slice(0, 200)
  const fileUrl = `${PUBLIC_BASE_URL}/files/${encodeURIComponent(file)}`
  const callbackUrl = `${PUBLIC_BASE_URL}/callback?file=${encodeURIComponent(file)}`
  // 发送给 DS 的纯数据 config（不含前端 events 函数）
  const config = {
    documentType,
    document: {
      fileType: ext,
      key: documentKeyOf(file),
      title: safeTitle,
      url: fileUrl,
      permissions: { comment: false, chat: false },
    },
    editorConfig: {
      mode: 'edit',
      lang: 'zh-CN',
      callbackUrl,
      user: { id: 'gw-user', name: 'AweeClaw' },
      customization: {
        autosave: true,
        compactHeader: false,
        forcesave: true,
        logo: { image: 'https://aweeclaw.com/favicon.ico' }, // 缺失则回退内置品牌，可删除
      },
    },
  }
  // JWT：把 config 用 DS 同一 secret 签名后整体下发给前端（仅服务端能签）
  if (JWT_SECRET) config.token = jwtSign(config)

  const html = fs.readFileSync(path.join(__dirname, 'demo.html'), 'utf-8')
  return html
    .replace('__CONFIG__', JSON.stringify(config).replace(/</g, '\\u003c'))
    .replace(/__META_TITLE__/g, escapeHtml(safeTitle))
    .replace(/__DOC_SERVER__/g, DOC_SERVER)
}

/* ---------------- HTTP 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const p = u.pathname
  log(`${req.method} ${p}`)

  try {
    // 首页：文件列表
    if (req.method === 'GET' && (p === '/' || p === '/list.html')) {
      const files = fs.readdirSync(DATA_DIR).filter((f) => EXT_TYPE[path.extname(f).slice(1).toLowerCase()])
      let rows = files.map((f) => {
        const st = fs.statSync(path.join(DATA_DIR, f))
        const { documentType } = docMetaOf(f)
        return `<tr><td>${f}</td><td>${documentType}</td><td>${st.size}</td>
          <td><a href="/oo-gw/demo.html?file=${encodeURIComponent(f)}">打开编辑</a></td></tr>`
      }).join('')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>OO 网关文件列表</title>
        <style>body{font-family:-apple-system,sans-serif;padding:24px;max-width:900px;margin:auto}
        table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}
        h3{color:#333}code{background:#f4f4f4;padding:2px 6px;border-radius:4px}</style></head><body>
        <h3>桥接网关 · 可编辑文件</h3>
        ${rows ? `<table><tr><th>文件</th><th>类型</th><th>大小</th><th></th></tr>${rows}</table>`
          : `<p>暂无文件。上传示例：<br><code>curl -X POST --data-binary @本地文件.xlsx "https://onlyoffice.aweeclaw.com/oo-gw/upload?name=test.xlsx"</code></p>`}
        </body></html>`)
    }

    // 演示宿主页（?title= 可选：显示用原始文件名；缺省用存储名）
    if (req.method === 'GET' && p === '/demo.html') {
      const file = safeName(u.searchParams.get('file'))
      if (!file) return sendJson(res, 400, { error: '缺少 ?file= 参数' })
      if (!EXT_TYPE[path.extname(file).slice(1).toLowerCase()]) return sendJson(res, 400, { error: '不支持的文件类型' })
      if (!fs.existsSync(path.join(DATA_DIR, file))) return sendJson(res, 404, { error: `文件不存在: ${file}，请先上传` })
      const title = String(u.searchParams.get('title') || '').trim().slice(0, 200) || null
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(renderDemo(file, title))
    }

    // 供 DS 拉取原文件
    if (req.method === 'GET' && p.startsWith('/files/')) {
      const file = safeName(decodeURIComponent(p.slice('/files/'.length)))
      if (!file) return sendJson(res, 400, { error: 'bad name' })
      const full = path.join(DATA_DIR, file)
      if (!fs.existsSync(full)) return sendJson(res, 404, { error: 'no file' })
      const { mime } = docMetaOf(file)
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': fs.statSync(full).size,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      })
      return fs.createReadStream(full).pipe(res)
    }

    // 文件元信息（供宿主页/调试确认 key 依据）
    if (req.method === 'GET' && p.startsWith('/meta/')) {
      const file = safeName(decodeURIComponent(p.slice('/meta/'.length)))
      const full = path.join(DATA_DIR, file)
      if (!file || !fs.existsSync(full)) return sendJson(res, 404, { error: 'no file' })
      const st = fs.statSync(full)
      return sendJson(res, 200, { name: file, size: st.size, mtime: st.mtimeMs, key: fileKey(file), ...docMetaOf(file) })
    }

    // 上传（raw body + ?name=）
    if (req.method === 'POST' && p === '/upload') {
      const file = safeName(u.searchParams.get('name'))
      if (!file) return sendJson(res, 400, { error: '缺少 ?name=' })
      const ext = path.extname(file).slice(1).toLowerCase()
      if (!EXT_TYPE[ext]) return sendJson(res, 400, { error: `不支持的类型 .${ext}（允许: ${Object.keys(EXT_TYPE).join('/')}）` })
      const buf = await readBodyRaw(req)
      if (!buf.length) return sendJson(res, 400, { error: 'body 为空' })
      await atomicWrite(file, buf)
      log(`上传完成: ${file} (${buf.length} bytes)`)
      return sendJson(res, 200, { ok: true, file, url: `${PUBLIC_BASE_URL}/files/${encodeURIComponent(file)}` })
    }

    // DS 保存/状态回调
    if (req.method === 'POST' && p === '/callback') {
      const file = safeName(u.searchParams.get('file'))
      if (!file) return sendJson(res, 200, { error: 1, message: '缺少 file 参数' })
      const body = await readBodyRaw(req, 10 * 1024 * 1024)
      let payload = null
      try { payload = JSON.parse(body.toString('utf-8')) } catch { return sendJson(res, 200, { error: 1, message: 'JSON 解析失败' }) }

      if (JWT_SECRET) {
        const decoded = jwtVerify(bearerOf(req)) || jwtVerify(payload.token || '')
        if (!decoded) return sendJson(res, 403, { error: 1, message: 'JWT 校验失败' })
        payload = { ...payload, ...decoded } // decoded 覆盖同名（DS 签名即回调 body）
      }
      const status = Number(payload.status)
      // 1=编辑中 2=需保存 3=保存出错 4=关闭无更改 6=强制保存 7=force save 出错
      log(`回调 file=${file} status=${status}`)
      if (status === 2 || status === 6) {
        if (!payload.url) return sendJson(res, 200, { error: 1, message: '缺少 url' })
        const buf = await downloadUrl(payload.url)
        await atomicWrite(file, buf)
        log(`保存回写: ${file} (${buf.length} bytes)`)
        return sendJson(res, 200, { error: 0 })
      }
      return sendJson(res, 200, { error: 0 })
    }

    // 客户端"保存并关闭"前：触发 DS 强制保存并等待回写落盘
    if (req.method === 'POST' && p === '/save') {
      const file = safeName(u.searchParams.get('file'))
      if (!file) return sendJson(res, 400, { error: '缺少 file 参数' })
      if (!adminOk(req)) return sendJson(res, 403, { error: 'forbidden' })
      if (!fs.existsSync(path.join(DATA_DIR, file))) return sendJson(res, 404, { error: '文件不存在' })
      const r = await forceSaveAndWait(file)
      log(`强制保存: ${file} changed=${r.changed}${r.cmdError ? ' (' + r.cmdError + ')' : ''}`)
      return sendJson(res, 200, { ok: true, file, ...r })
    }

    // 删除服务端副本（客户端回写本地后清理会话文件）
    if (req.method === 'DELETE' && p.startsWith('/files/')) {
      const file = safeName(decodeURIComponent(p.slice('/files/'.length)))
      if (!file) return sendJson(res, 400, { error: 'bad name' })
      if (!adminOk(req)) return sendJson(res, 403, { error: 'forbidden' })
      const full = path.join(DATA_DIR, file)
      if (!fs.existsSync(full)) return sendJson(res, 404, { error: 'no file' })
      await fs.promises.unlink(full)
      log(`已删除: ${file}`)
      return sendJson(res, 200, { ok: true, file })
    }

    // 健康检查
    if (req.method === 'GET' && p === '/health') {
      return sendJson(res, 200, { ok: true, files: fs.readdirSync(DATA_DIR).length, jwt: !!JWT_SECRET })
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('not found')
  } catch (e) {
    log('处理失败:', e.message)
    if (!res.headersSent) sendJson(res, 500, { error: e.message })
  }
})

// TTL：定期清理超过 TTL_HOURS 未被修改的会话文件（防孤儿堆积）
setInterval(() => {
  try {
    const now = Date.now()
    const limit = TTL_HOURS * 3600 * 1000
    for (const f of fs.readdirSync(DATA_DIR)) {
      const ext = path.extname(f).slice(1).toLowerCase()
      if (!EXT_TYPE[ext]) continue
      try {
        const st = fs.statSync(path.join(DATA_DIR, f))
        if (now - st.mtimeMs > limit) {
          fs.unlinkSync(path.join(DATA_DIR, f))
          log(`TTL 清理过期文件: ${f}`)
        }
      } catch { /* 忽略单个文件错误 */ }
    }
  } catch { /* 扫描失败静默 */ }
}, 15 * 60 * 1000).unref()

server.listen(PORT, '0.0.0.0', () => {
  log(`网关已启动: 0.0.0.0:${PORT}`)
  log(`  DOC_SERVER    = ${DOC_SERVER || '(未设置，demo 页无法加载编辑器)'}`)
  log(`  PUBLIC_BASE   = ${PUBLIC_BASE_URL || '(未设置，保存回写 URL 不完整)'}`)
  log(`  JWT           = ${JWT_SECRET ? '已启用' : '未启用（调试模式，勿公网使用）'}`)
  log(`  文件目录       = ${DATA_DIR}`)
})
