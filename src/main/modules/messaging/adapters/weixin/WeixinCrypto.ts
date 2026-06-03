/**
 * 微信 iLink 协议加解密工具
 *
 * 基于 @tencent-weixin/openclaw-weixin (MIT License)
 * 实现 AES-128-ECB 加解密、PKCS7 填充、CDN 上传下载
 */

import * as crypto from 'crypto'

// ============================================
// PKCS7 填充
// ============================================

const BLOCK_SIZE = 16

/** PKCS7 填充 */
export function pkcs7Pad(data: Buffer): Buffer {
  const padding = BLOCK_SIZE - (data.length % BLOCK_SIZE)
  const padded = Buffer.alloc(data.length + padding)
  data.copy(padded)
  padded.fill(padding, data.length)
  return padded
}

/** PKCS7 去填充 */
export function pkcs7Unpad(data: Buffer): Buffer {
  if (data.length === 0) return data
  const padding = data[data.length - 1]
  if (padding > BLOCK_SIZE || padding === 0) {
    throw new Error(`Invalid PKCS7 padding: ${padding}`)
  }
  for (let i = data.length - padding; i < data.length; i++) {
    if (data[i] !== padding) {
      throw new Error(`Invalid PKCS7 padding at byte ${i}`)
    }
  }
  return data.subarray(0, data.length - padding)
}

// ============================================
// AES-128-ECB 加解密
// ============================================

/** AES-128-ECB 加密（PKCS7 填充） */
export function encryptAESECB(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES key must be 16 bytes, got ${key.length}`)
  }
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  const padded = pkcs7Pad(plaintext)
  return Buffer.concat([cipher.update(padded), cipher.final()])
}

/** AES-128-ECB 解密（PKCS7 去填充） */
export function decryptAESECB(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES key must be 16 bytes, got ${key.length}`)
  }
  if (ciphertext.length % BLOCK_SIZE !== 0) {
    throw new Error(`Ciphertext length ${ciphertext.length} is not a multiple of block size ${BLOCK_SIZE}`)
  }
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null)
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return pkcs7Unpad(decrypted)
}

/** 计算 AES-ECB 加密后的密文大小（含 PKCS7 填充） */
export function aesECBPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / BLOCK_SIZE) * BLOCK_SIZE
}

// ============================================
// AES Key 解析
// ============================================

/**
 * 解析 AES Key，支持两种格式：
 * - base64(raw 16 bytes)
 * - base64(hex string of 16 bytes) -> 32 hex chars
 */
export function parseAESKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && isHexString(decoded.toString('utf8'))) {
    return Buffer.from(decoded.toString('utf8'), 'hex')
  }
  throw new Error(`AES key must be 16 raw bytes or 32-char hex, got ${decoded.length} bytes`)
}

function isHexString(s: string): boolean {
  return /^[0-9a-fA-F]+$/.test(s)
}

/** 编码 AES Key 用于发送消息（返回 hex 编码） */
export function encodeAESKeyForSend(key: Buffer): string {
  return key.toString('hex').trim()
}

// ============================================
// CDN 上传/下载
// ============================================

const CDN_UPLOAD_TIMEOUT_MS = 30_000
const CDN_DOWNLOAD_TIMEOUT_MS = 15_000

/** 构建 CDN 下载 URL */
export function buildCDNDownloadURL(cdnBaseURL: string, encryptedQueryParam: string): string {
  const base = cdnBaseURL.endsWith('/') ? cdnBaseURL : cdnBaseURL + '/'
  return `${base}download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}

/** 构建 CDN 上传 URL */
export function buildCDNUploadURL(cdnBaseURL: string, uploadParam: string, filekey: string): string {
  const base = cdnBaseURL.endsWith('/') ? cdnBaseURL : cdnBaseURL + '/'
  return `${base}upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

/** 从 CDN 下载并解密 */
export async function downloadAndDecrypt(
  cdnBaseURL: string,
  encryptedQueryParam: string,
  aesKeyBase64: string
): Promise<Buffer> {
  const key = parseAESKey(aesKeyBase64)
  const encrypted = await downloadFromCDN(cdnBaseURL, encryptedQueryParam)
  return decryptAESECB(encrypted, key)
}

/** 从 CDN 下载（不解密） */
export async function downloadPlain(
  cdnBaseURL: string,
  encryptedQueryParam: string
): Promise<Buffer> {
  return downloadFromCDN(cdnBaseURL, encryptedQueryParam)
}

/** 上传到 CDN（加密后上传），返回下载参数 */
export async function uploadToCDN(
  cdnBaseURL: string,
  uploadParam: string,
  filekey: string,
  plaintext: Buffer,
  aesKey: Buffer
): Promise<string> {
  const ciphertext = encryptAESECB(plaintext, aesKey)
  const url = buildCDNUploadURL(cdnBaseURL, uploadParam, filekey)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CDN_UPLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(ciphertext),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`CDN upload ${response.status}: ${body}`)
    }

    const downloadParam = response.headers.get('x-encrypted-param')
    if (!downloadParam) {
      throw new Error('CDN upload: missing x-encrypted-param header')
    }
    return downloadParam
  } finally {
    clearTimeout(timer)
  }
}

/** 从 CDN 下载原始数据 */
async function downloadFromCDN(cdnBaseURL: string, encryptedQueryParam: string): Promise<Buffer> {
  const url = buildCDNDownloadURL(cdnBaseURL, encryptedQueryParam)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CDN_DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`CDN download ${response.status}: ${body}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } finally {
    clearTimeout(timer)
  }
}
