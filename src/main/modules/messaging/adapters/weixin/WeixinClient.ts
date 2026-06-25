/**
 * 微信 iLink Bot API 客户端
 *
 * 基于 @tencent-weixin/openclaw-weixin (MIT License)
 * 封装与腾讯 iLink API 的 HTTP 通信：消息获取、发送、QR 登录、打字指示器等
 */

import * as crypto from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import { uploadToCDN } from './WeixinCrypto'

// ============================================
// 常量
// ============================================

const CHANNEL_VERSION = '1.0.0'
const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const DEFAULT_BOT_TYPE = '3'
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const DEFAULT_API_TIMEOUT_MS = 15_000
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000

// ============================================
// 消息类型常量
// ============================================

export const ItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const

// ============================================
// 类型定义
// ============================================

export interface AdapterConfig {
  token: string
  baseUrl: string
  cdnBaseUrl: string
  pollTimeoutSeconds: number
  enableTyping: boolean
}

export interface BaseInfo {
  channel_version?: string
}

export interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
}

export interface TextItem {
  text?: string
}

export interface ImageItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
}

export interface VoiceItem {
  media?: CDNMedia
  encode_type?: number
  bits_per_sample?: number
  sample_rate?: number
  playtime?: number
  text?: string
}

export interface FileItem {
  media?: CDNMedia
  file_name?: string
  md5?: string
  len?: string
}

export interface VideoItem {
  media?: CDNMedia
  video_size?: number
  play_length?: number
  video_md5?: string
  thumb_media?: CDNMedia
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
}

export interface RefMessage {
  message_item?: MessageItem
  title?: string
}

export interface MessageItem {
  type?: number
  create_time_ms?: number
  update_time_ms?: number
  is_completed?: boolean
  msg_id?: string
  ref_msg?: RefMessage
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
}

export interface WeixinMessage {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  create_time_ms?: number
  update_time_ms?: number
  delete_time_ms?: number
  session_id?: string
  group_id?: string
  message_type?: number
  message_state?: number
  item_list?: MessageItem[]
  context_token?: string
}

// API 请求/响应
export interface GetUpdatesRequest {
  get_updates_buf: string
  base_info?: BaseInfo
}

export interface GetUpdatesResponse {
  ret: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export interface SendMessageRequest {
  msg: WeixinMessage
  base_info?: BaseInfo
}

export interface GetUploadURLRequest {
  filekey?: string
  media_type?: number
  to_user_id?: string
  rawsize?: number
  rawfilemd5?: string
  filesize?: number
  thumb_rawsize?: number
  thumb_rawfilemd5?: string
  thumb_filesize?: number
  no_need_thumb?: boolean
  aeskey?: string
  base_info?: BaseInfo
}

export interface GetUploadURLResponse {
  upload_param?: string
  thumb_upload_param?: string
}

export interface GetConfigRequest {
  ilink_user_id?: string
  context_token?: string
  base_info?: BaseInfo
}

export interface GetConfigResponse {
  ret: number
  errmsg?: string
  typing_ticket?: string
}

export interface SendTypingRequest {
  ilink_user_id?: string
  typing_ticket?: string
  status?: number
  base_info?: BaseInfo
}

export interface QRCodeResponse {
  qrcode?: string
  qrcode_img_content?: string
}

export interface QRStatusResponse {
  status: string // wait, scanned, confirmed, expired
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
}

// ============================================
// 客户端
// ============================================

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION }
}

/** 生成 X-WECHAT-UIN 头（随机 uint32 -> 十进制 -> base64） */
function randomWechatUIN(): string {
  const n = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(n)).toString('base64')
}

/** 解析凭据为 AdapterConfig */
export function parseConfig(credentials: Record<string, string>): AdapterConfig {
  const token = (credentials.token || '').trim()
  const baseUrl = (credentials.baseUrl || credentials.base_url || '').trim() || DEFAULT_BASE_URL
  const cdnBaseUrl = (credentials.cdnBaseUrl || credentials.cdn_base_url || '').trim() || DEFAULT_CDN_BASE_URL
  const pollTimeoutSeconds = parseInt(credentials.pollTimeoutSeconds || credentials.poll_timeout_seconds || '0', 10) || 0
  const enableTyping = (credentials.enableTyping || credentials.enable_typing || '').toLowerCase() === 'true'

  if (!token) {
    throw new Error('weixin token is required')
  }

  return { token, baseUrl, cdnBaseUrl, pollTimeoutSeconds, enableTyping }
}

export class WeixinClient {
  /** 发送 API 请求 */
  private async apiPost(
    baseUrl: string,
    endpoint: string,
    body: unknown,
    token: string,
    timeoutMs: number
  ): Promise<unknown> {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
    const url = base + endpoint

    const bodyStr = JSON.stringify(body)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AuthorizationType': 'ilink_bot_token',
          'Content-Length': String(Buffer.byteLength(bodyStr, 'utf-8')),
          'X-WECHAT-UIN': randomWechatUIN(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: bodyStr,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`weixin api ${endpoint} ${response.status}: ${text}`)
      }

      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }

  /** Long Poll 获取新消息 */
  async getUpdates(
    cfg: AdapterConfig,
    getUpdatesBuf: string,
    abortSignal?: AbortSignal
  ): Promise<GetUpdatesResponse> {
    const timeout = cfg.pollTimeoutSeconds > 0
      ? cfg.pollTimeoutSeconds * 1000
      : DEFAULT_LONG_POLL_TIMEOUT_MS

    const body: GetUpdatesRequest = {
      get_updates_buf: getUpdatesBuf,
      base_info: buildBaseInfo(),
    }

    try {
      const raw = await this.apiPost(cfg.baseUrl, 'ilink/bot/getupdates', body, cfg.token, timeout + 5000)
      return raw as GetUpdatesResponse
    } catch (err) {
      // 外部中断（连接销毁/切换账号）：静默返回
      if (abortSignal?.aborted) {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf }
      }
      // 内部超时 abort（long polling 正常行为）：静默返回，不抛出
      if (err instanceof Error && err.name === 'AbortError') {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf }
      }
      throw err
    }
  }

  /** 发送消息 */
  async sendMessage(cfg: AdapterConfig, msg: SendMessageRequest): Promise<void> {
    msg.base_info = buildBaseInfo()
    logger.channel.info(`[Weixin] sendmessage request: to=${msg.msg?.to_user_id}, type=${msg.msg?.message_type}, state=${msg.msg?.message_state}, items=${msg.msg?.item_list?.length}, contextTokenLen=${msg.msg?.context_token?.length || 0}`)
    const raw = await this.apiPost(cfg.baseUrl, 'ilink/bot/sendmessage', msg, cfg.token, DEFAULT_API_TIMEOUT_MS)
    const resp = raw as { ret?: number; errcode?: number; errmsg?: string } | undefined
    if (resp && (resp.ret !== 0 && resp.ret !== undefined)) {
      const errMsg = `sendmessage API error: ret=${resp.ret}, errcode=${resp.errcode}, errmsg=${resp.errmsg}`
      logger.channel.error(`[Weixin] ${errMsg}`)
      throw new Error(errMsg)
    }
    logger.channel.info(`[Weixin] sendmessage API response: ret=${resp?.ret}, errcode=${resp?.errcode}, errmsg=${resp?.errmsg || '(none)'}`)
  }

  /** 获取 Bot 配置（typing_ticket 等） */
  async getConfig(cfg: AdapterConfig, userID: string, contextToken: string): Promise<GetConfigResponse> {
    const body: GetConfigRequest = {
      ilink_user_id: userID,
      context_token: contextToken,
      base_info: buildBaseInfo(),
    }
    const raw = await this.apiPost(cfg.baseUrl, 'ilink/bot/getconfig', body, cfg.token, DEFAULT_CONFIG_TIMEOUT_MS)
    return raw as GetConfigResponse
  }

  /** 发送打字指示器 */
  async sendTyping(cfg: AdapterConfig, userID: string, typingTicket: string, status: number): Promise<void> {
    const body: SendTypingRequest = {
      ilink_user_id: userID,
      typing_ticket: typingTicket,
      status,
      base_info: buildBaseInfo(),
    }
    await this.apiPost(cfg.baseUrl, 'ilink/bot/sendtyping', body, cfg.token, DEFAULT_CONFIG_TIMEOUT_MS)
  }

  /** 获取 CDN 上传 URL */
  async getUploadURL(cfg: AdapterConfig, req: GetUploadURLRequest): Promise<GetUploadURLResponse> {
    req.base_info = buildBaseInfo()
    const raw = await this.apiPost(cfg.baseUrl, 'ilink/bot/getuploadurl', req, cfg.token, DEFAULT_API_TIMEOUT_MS)
    return raw as GetUploadURLResponse
  }

  /** 获取 QR 码（登录用） */
  async fetchQRCode(apiBaseURL?: string): Promise<QRCodeResponse> {
    const base = (apiBaseURL || DEFAULT_BASE_URL)
    const url = base.endsWith('/') ? base : base + '/'
    const fullUrl = `${url}ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await fetch(fullUrl, { signal: controller.signal })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`weixin qrcode ${response.status}: ${text}`)
      }
      return await response.json() as QRCodeResponse
    } finally {
      clearTimeout(timer)
    }
  }

  /** 轮询 QR 码登录状态 */
  async pollQRStatus(apiBaseURL: string, qrcode: string): Promise<QRStatusResponse> {
    const base = apiBaseURL.endsWith('/') ? apiBaseURL : apiBaseURL + '/'
    const url = `${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 35_000)

    try {
      const response = await fetch(url, {
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`weixin qrstatus ${response.status}: ${text}`)
      }
      const result = await response.json() as QRStatusResponse
      // API 返回 "scaned"，统一为 "scanned"
      if (result.status === 'scaned') {
        result.status = 'scanned'
      }
      return result
    } catch (err) {
      if (controller.signal.aborted) {
        return { status: 'wait' }
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /** 上传媒体文件到 CDN 并返回下载参数 */
  async uploadMedia(
    cfg: AdapterConfig,
    target: string,
    data: Buffer,
    mediaType: number,
  ): Promise<string> {
    const aesKey = crypto.randomBytes(16)
    const filekey = crypto.randomBytes(16)
    const filekeyHex = filekey.toString('hex')
    const rawMD5 = crypto.createHash('md5').update(data).digest('hex')

    // 计算 AES-ECB 加密后大小
    const paddedSize = Math.ceil((data.length + 1) / 16) * 16

    const uploadResp = await this.getUploadURL(cfg, {
      filekey: filekeyHex,
      media_type: mediaType,
      to_user_id: target,
      rawsize: data.length,
      rawfilemd5: rawMD5,
      filesize: paddedSize,
      no_need_thumb: true,
      aeskey: aesKey.toString('hex'),
    })

    if (!uploadResp.upload_param?.trim()) {
      throw new Error('weixin: empty upload_param')
    }

    const downloadParam = await uploadToCDN(
      cfg.cdnBaseUrl,
      uploadResp.upload_param,
      filekeyHex,
      data,
      aesKey
    )

    logger.channel.debug(`weixin media uploaded: filekey=${filekeyHex}, raw_size=${data.length}`)

    return downloadParam
  }
}

export const weixinClient = new WeixinClient()
