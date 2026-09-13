/**
 * ONLYOFFICE 在线编辑会话管理器（主进程单例）
 *
 * 职责：
 * - 读取 aweeclaw-config.json 中的 onlyOffice 服务器配置（与 serverUrl 同文件）
 * - 开始会话：上传本地文件到网关 → 返回编辑会话元信息（渲染 Tab 据此打开 webview）
 * - 保存会话：POST /save 触发 force save 并等待落盘 → 下载结果 → 原子写回本地源文件
 * - 放弃会话：DELETE 网关远端副本，清理会话缓存
 *
 * 安全性：
 * - 上传/保存/删除全部在主进程完成，渲染层只拿到 editorUrl（不含 adminKey）
 * - 写回采用同目录临时文件 + rename 原子替换，不会写坏正在编辑的文件
 * - 远端文件名使用 uuid 隔离，与本地文件名解耦
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { getUserConfigDir } from '../configPath'
import {
  OO_EDIT_CHANNELS,
  OO_EDITABLE_EXTENSIONS,
  type OnlyOfficeEditSessionMeta,
  type OnlyOfficeServerSettings,
} from '../../../shared/protocols/onlyOfficeProtocol'

/** 会话记录（仅主进程持有，含源路径） */
interface OoSessionRecord {
  sourcePath: string
  remoteName: string
  title: string
  ext: string
  startedAt: number
}

const CONFIG_REL_PATH = path.join('.aweeclaw', 'aweeclaw-config.json')
const DEFAULT_ONLYOFFICE_URL = 'https://onlyoffice.aweeclaw.com'
const DEFAULT_BASE_PATH = '/oo-gw'
const EXT_SET = new Set<string>(OO_EDITABLE_EXTENSIONS)
/** force save + 下载整体超时（服务端 forceSaveAndWait 最长约 25s） */
const REQUEST_TIMEOUT_MS = 90_000

/** 归一化 basePath：保证以 / 开头、不以 / 结尾 */
function normBasePath(p: string): string {
  let s = p.trim()
  if (!s) return DEFAULT_BASE_PATH
  if (!s.startsWith('/')) s = '/' + s
  return s.replace(/\/+$/, '')
}

export class OoEditManager {
  private static instance: OoEditManager | null = null

  private readonly sessions = new Map<string, OoSessionRecord>()

  private constructor() {
    this.registerIpc()
    logger.system.info('[OnlyOffice] OoEditManager IPC registered')
  }

  static getInstance(): OoEditManager {
    if (!OoEditManager.instance) {
      OoEditManager.instance = new OoEditManager()
    }
    return OoEditManager.instance
  }

  /* ------------------------------------------------------------------ */
  /* 配置读取                                                          */
  /* ------------------------------------------------------------------ */

  /** 读取 onlyOffice 服务器配置（默认值兜底；serverUrl 置空字符串 = 显式禁用） */
  readServerConfig(): { enabled: boolean; settings: OnlyOfficeServerSettings } {
    const fallback: OnlyOfficeServerSettings = {
      serverUrl: DEFAULT_ONLYOFFICE_URL,
      basePath: DEFAULT_BASE_PATH,
      adminKey: '',
    }
    try {
      const configPath = path.join(getUserConfigDir(), CONFIG_REL_PATH)
      if (!fs.existsSync(configPath)) return { enabled: true, settings: fallback }
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const oo = (raw && typeof raw === 'object' ? raw.onlyOffice : null) || {}
      const serverUrl = typeof oo.serverUrl === 'string' ? oo.serverUrl.trim() : DEFAULT_ONLYOFFICE_URL
      const basePath =
        typeof oo.basePath === 'string' && oo.basePath.trim()
          ? normBasePath(oo.basePath)
          : DEFAULT_BASE_PATH
      const adminKey = typeof oo.adminKey === 'string' ? oo.adminKey.trim() : ''
      return {
        enabled: serverUrl !== '',
        settings: { serverUrl: serverUrl || DEFAULT_ONLYOFFICE_URL, basePath, adminKey },
      }
    } catch (err) {
      logger.system.warn('[OnlyOffice] Failed to read onlyOffice config, use default:', err)
      return { enabled: true, settings: fallback }
    }
  }

  private get gatewayBase(): string {
    const { settings } = this.readServerConfig()
    return `${settings.serverUrl.replace(/\/+$/, '')}${settings.basePath}`
  }

  /* ------------------------------------------------------------------ */
  /* HTTP 客户端                                                       */
  /* ------------------------------------------------------------------ */

  /** 发起请求并返回 { status, contentType, buffer } */
  private async request(
    method: string,
    url: string,
    body?: Buffer | string,
  ): Promise<{ status: number; contentType: string; buffer: Buffer }> {
    const { settings } = this.readServerConfig()
    const headers: Record<string, string> = {}
    if (settings.adminKey) headers['x-gw-key'] = settings.adminKey
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/octet-stream'
      headers['Content-Length'] = String(body.length)
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body as BodyInit | undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      buffer: buf,
    }
  }

  /** 解析 JSON 响应；失败抛错 */
  private async requestJson(method: string, url: string, body?: Buffer | string): Promise<any> {
    const { status, buffer } = await this.request(method, url, body)
    const text = buffer.toString('utf-8')
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (status < 200 || status >= 300) {
      throw new Error(
        `HTTP ${status}${parsed?.error ? `: ${parsed.error}` : parsed?.message ? `: ${parsed.message}` : ''}`,
      )
    }
    return parsed
  }

  /* ------------------------------------------------------------------ */
  /* 会话操作                                                          */
  /* ------------------------------------------------------------------ */

  /** 上传本地文件并创建编辑会话 */
  async startSession(sourcePath: string, title?: string): Promise<{ ok: boolean; error?: string; session?: OnlyOfficeEditSessionMeta }> {
    const { enabled, settings } = this.readServerConfig()
    if (!enabled) {
      return { ok: false, error: '未配置 ONLYOFFICE 服务器（aweeclaw-config.json → onlyOffice.serverUrl 置空即禁用）' }
    }

    const abs = path.resolve(sourcePath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      return { ok: false, error: `文件不存在: ${abs}` }
    }
    if (!stat.isFile()) return { ok: false, error: '不是有效文件' }

    const ext = path.extname(abs).slice(1).toLowerCase()
    if (!EXT_SET.has(ext)) {
      return { ok: false, error: `不支持该文件类型 (.${ext})，支持: ${OO_EDITABLE_EXTENSIONS.join('/')}` }
    }

    const remoteName = `${crypto.randomUUID()}.${ext}`
    const gwBase = `${settings.serverUrl.replace(/\/+$/, '')}${settings.basePath}`
    try {
      const buf = await fs.promises.readFile(abs)
      const uploadUrl = `${gwBase}/upload?name=${encodeURIComponent(remoteName)}`
      const res = await this.requestJson('POST', uploadUrl, buf)
      if (!res?.ok) {
        return { ok: false, error: `上传失败: ${res?.error || '网关未返回 ok'}` }
      }
    } catch (err) {
      logger.system.error('[OnlyOffice] Upload failed:', err)
      return { ok: false, error: `上传失败: ${(err as Error)?.message || '网络错误'}` }
    }

    const displayTitle = String(title || path.basename(abs)).trim().slice(0, 200) || path.basename(abs)
    const sessionId = crypto.randomUUID()
    const session: OnlyOfficeEditSessionMeta = {
      sessionId,
      sourcePath: abs,
      remoteName,
      title: displayTitle,
      ext,
      editorUrl: `${gwBase}/demo.html?file=${encodeURIComponent(remoteName)}&title=${encodeURIComponent(displayTitle)}`,
      serverUrl: settings.serverUrl,
      startedAt: Date.now(),
    }
    this.sessions.set(sessionId, {
      sourcePath: abs,
      remoteName,
      title: displayTitle,
      ext,
      startedAt: session.startedAt,
    })
    logger.system.info(`[OnlyOffice] Session started: ${sessionId} ${remoteName} <- ${abs}`)
    return { ok: true, session }
  }

  /** 触发 DS force save → 下载 → 原子写回本地源文件 */
  async saveSession(sessionId: string): Promise<{ ok: boolean; error?: string; size?: number; sourcePath?: string }> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, error: '会话不存在或已结束，请重新打开编辑' }

    const gwBase = this.gatewayBase
    try {
      // 1. force save 并等待网关落盘（网关侧最长约 25s）
      const saveUrl = `${gwBase}/save?file=${encodeURIComponent(record.remoteName)}`
      const saveRes = await this.requestJson('POST', saveUrl)
      if (!saveRes?.ok) {
        return { ok: false, error: `保存失败: ${saveRes?.error || '网关未返回 ok'}` }
      }
      // 强制保存未生效（DS 报错且文件未被写回）：中止回写，避免用旧文件覆盖本地改动
      if (saveRes.changed === false && saveRes.cmdError) {
        logger.system.warn(`[OnlyOffice] Force save not applied for ${record.remoteName}: ${saveRes.cmdError}`)
        return {
          ok: false,
          error: `强制保存未生效（${saveRes.cmdError}），已中止回写以免丢失改动。请在编辑器中再次点击「保存」后重试`,
        }
      }

      // 2. 下载保存结果
      const fileUrl = `${gwBase}/files/${encodeURIComponent(record.remoteName)}`
      const dl = await this.request('GET', fileUrl)
      if (dl.status < 200 || dl.status >= 300) {
        return { ok: false, error: `下载保存结果失败: HTTP ${dl.status}` }
      }
      if (!dl.buffer.length) return { ok: false, error: '保存结果为空，可能文档未被编辑' }

      // 3. 同目录临时文件 + rename 原子写回，避免写坏本地原文件
      const tmpPath = `${record.sourcePath}.oo-${sessionId}.tmp`
      await fs.promises.writeFile(tmpPath, dl.buffer)
      await fs.promises.rename(tmpPath, record.sourcePath)

      // 4. 已回写本地 → 会话结束：删除远端副本（失败不阻塞，网关 TTL 会兜底回收）
      this.sessions.delete(sessionId)
      try {
        const delUrl = `${gwBase}/files/${encodeURIComponent(record.remoteName)}`
        await this.request('DELETE', delUrl)
      } catch {
        logger.system.warn('[OnlyOffice] Save cleanup delete remote failed (TTL will reclaim)')
      }

      logger.system.info(`[OnlyOffice] Session saved back: ${sessionId} ${record.remoteName} -> ${record.sourcePath} (${dl.buffer.length} bytes)`)
      return { ok: true, size: dl.buffer.length, sourcePath: record.sourcePath }
    } catch (err) {
      logger.system.error('[OnlyOffice] Save failed:', err)
      return { ok: false, error: `保存回写失败: ${(err as Error)?.message || '未知错误'}` }
    }
  }

  /** 放弃会话：删除网关远端副本并清理本地缓存 */
  async discardSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, error: '会话不存在或已结束' }

    const gwBase = this.gatewayBase
    this.sessions.delete(sessionId)
    // 清理可能遗留的临时文件
    const tmpPath = `${record.sourcePath}.oo-${sessionId}.tmp`
    if (fs.existsSync(tmpPath)) {
      fs.promises.unlink(tmpPath).catch(() => undefined)
    }
    try {
      const delUrl = `${gwBase}/files/${encodeURIComponent(record.remoteName)}`
      const res = await this.request('DELETE', delUrl)
      if (res.status < 200 || res.status >= 300 && res.status !== 404) {
        logger.system.warn(`[OnlyOffice] Discard delete returned HTTP ${res.status}, remote cleaned by TTL`)
      }
    } catch (err) {
      // 远端清理失败不阻塞（网关 TTL 会自动回收孤儿文件）
      logger.system.warn('[OnlyOffice] Discard delete remote failed:', err)
    }
    logger.system.info(`[OnlyOffice] Session discarded: ${sessionId} ${record.remoteName}`)
    return { ok: true }
  }

  /* ------------------------------------------------------------------ */
  /* IPC 注册                                                          */
  /* ------------------------------------------------------------------ */

  private registerIpc(): void {
    safeIpcHandle(OO_EDIT_CHANNELS.CONFIG, async () => {
      const { enabled, settings } = this.readServerConfig()
      return { enabled, serverUrl: settings.serverUrl, basePath: settings.basePath }
    })

    safeIpcHandle(OO_EDIT_CHANNELS.START, async (_e, payload: { sourcePath: string; title?: string }) => {
      return this.startSession(payload?.sourcePath || '', payload?.title)
    })

    safeIpcHandle(OO_EDIT_CHANNELS.SAVE, async (_e, sessionId: string) => {
      return this.saveSession(String(sessionId || ''))
    })

    safeIpcHandle(OO_EDIT_CHANNELS.DISCARD, async (_e, sessionId: string) => {
      return this.discardSession(String(sessionId || ''))
    })
  }
}
