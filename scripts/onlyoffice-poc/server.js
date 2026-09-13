/**
 * ONLYOFFICE Docs PoC — 本地文件网关 + 宿主服务
 * 验证链路：Electron/浏览器打开本地 xlsx → OnlyOffice 编辑器编辑 → 保存回调写回原文件
 *
 * 用法：
 *   POC_FILE=/path/to/file.xlsx node server.js   # 默认端口 3001
 *
 * 路由：
 *   GET  /demo.html      OnlyOffice 编辑器宿主页
 *   GET  /download       返回 POC_FILE 字节（OnlyOffice document.url）
 *   POST /callback       接收 OnlyOffice 保存回调，把保存结果写回 POC_FILE
 *
 * 仅用于本地 PoC 验证，零外部依赖。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const PORT = Number(process.env.PORT || 3001)
const FILE = process.env.POC_FILE
  ? path.resolve(process.env.POC_FILE)
  : path.resolve(__dirname, 'sample.xlsx')
const HOST_URL = `http://127.0.0.1:${PORT}`

if (!fs.existsSync(FILE)) {
  console.error(`[gateway] POC_FILE 不存在: ${FILE}`)
  console.error(`[gateway] 请先生成一个样例文件或设置 POC_FILE 环境变量`)
  process.exit(1)
}

const ext = path.extname(FILE).toLowerCase().replace('.', '')
const documentType = ext === 'docx' || ext === 'doc' ? 'word' : ext === 'pptx' || ext === 'ppt' ? 'slide' : 'cell'
const title = path.basename(FILE)

function log(...a) { console.log(new Date().toISOString(), '[gateway]', ...a) }

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

/** 从回调 body.url 下载已保存的文件字节 */
function downloadSavedFile(savedUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(savedUrl)
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' },
      (res) => {
        if (res.statusCode !== 200) return reject(new Error(`下载保存文件失败 HTTP ${res.statusCode}`))
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function writeBack(buffer) {
  // 先写临时文件再原子替换，避免写坏原文件
  const tmp = FILE + '.poc.tmp'
  fs.writeFileSync(tmp, buffer)
  fs.renameSync(tmp, FILE)
  log(`已保存回写: ${FILE} (${buffer.length} bytes)`)
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true)
  log(`${req.method} ${u.pathname}`)

  try {
    // 宿主页
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/demo.html')) {
      let html = fs.readFileSync(path.join(__dirname, 'demo.html'), 'utf-8')
      html = html
        .replace(/__DOC_SERVER__/g, process.env.DOC_SERVER || 'http://127.0.0.1:8080')
        .replace(/__HOST_URL__/g, HOST_URL)
        .replace(/__DOCUMENT_TYPE__/g, documentType)
        .replace(/__TITLE__/g, title)
        .replace(/__EXT__/g, ext)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(html)
    }

    // 供 OnlyOffice 拉取原文件
    if (req.method === 'GET' && u.pathname === '/download') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      return fs.createReadStream(FILE).pipe(res)
    }

    // 健康检查
    if (req.method === 'GET' && u.pathname === '/health') {
      return sendJson(res, 200, { ok: true, file: FILE, exists: fs.existsSync(FILE) })
    }

    // OnlyOffice 保存/状态回调
    if (req.method === 'POST' && u.pathname === '/callback') {
      const body = await readBody(req)
      log('收到回调:', JSON.stringify(body))
      const status = body.status
      // status 含义: 1=编辑中 2=需保存 3=保存出错 4=关闭无更改 6=强制保存 7=force save error
      if (status === 2 || status === 6) {
        if (body.url) {
          const buffer = await downloadSavedFile(body.url)
          await writeBack(buffer)
          return sendJson(res, 200, { error: 0 })
        }
        return sendJson(res, 200, { error: 1, message: '缺少 body.url' })
      }
      return sendJson(res, 200, { error: 0 })
    }

    res.writeHead(404)
    res.end('not found')
  } catch (e) {
    log('处理失败:', e.message)
    if (!res.headersSent) sendJson(res, 500, { error: e.message })
  }
})

server.listen(PORT, () => {
  log(`网关已启动: ${HOST_URL}/demo.html`)
  log(`编辑文件: ${FILE} (${ext}, ${documentType})`)
  log(`OnlyOffice 需能从容器内访问 ${HOST_URL}/download 与 /callback（Docker 用 host.docker.internal）`)
})
