/**
 * 插件包数字签名验证 — Ed25519 签名校验
 *
 * 职责：
 * - 内置后端 Ed25519 公钥（硬编码，不从外部读取）
 * - 验证插件包文件的数字签名，防止包被篡改或后端被入侵后投放恶意插件
 * - 与 SHA256 完整性校验互补：SHA256 防传输损坏，签名防恶意篡改
 *
 * 签名流程（后端）：
 * 1. 后端用 Ed25519 私钥对插件包文件（.tar.gz）签名
 * 2. 签名以 Base64 格式放入 PluginDownloadInfo.signature 字段
 * 3. 客户端下载后用内置公钥验证
 *
 * 验证策略：
 * - signature 存在时：必须验证通过，否则拒绝安装（安全模式）
 * - signature 缺失时：记录安全警告，过渡期允许安装（向后兼容）
 *   后续后端全面启用签名后，可将此分支改为强制拒绝
 *
 * 安全考虑：
 * - 公钥硬编码在源码中，编译进最终产物，无法被运行时篡改
 * - 使用 Node.js 内置 crypto.verify，无额外依赖
 * - Ed25519 算法抗量子安全性优于 RSA/ECDSA，性能也更优
 *
 * @module plugin-sdk/PluginSignatureVerifier
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'

// ─── 后端公钥（Ed25519）────────────────────────────────────

/**
 * 后端插件签名 Ed25519 公钥（Base64 / PEM 格式）。
 *
 * 对应私钥由后端保管，仅用于插件包签名。
 * 若需轮换密钥，更新此常量并发布客户端新版本。
 *
 * 当前为初始公钥，后端启用签名后替换为实际公钥。
 * 格式：Base64 编码的原始公钥字节（32 字节），或 PEM 格式。
 */
const PLUGIN_SIGNING_PUBLIC_KEY_BASE64: string = ''

// ─── 签名验证结果 ──────────────────────────────────────────

export type SignatureVerificationResult =
  | { valid: true }
  | { valid: false; reason: 'signature_mismatch' | 'invalid_format' | 'key_not_configured' | 'verification_error'; detail?: string }

// ─── 公钥缓存 ─────────────────────────────────────────────

let cachedPublicKey: crypto.KeyObject | null = null
let keyLoadAttempted = false

/**
 * 加载并缓存 Ed25519 公钥。
 *
 * @returns 公钥 KeyObject，若未配置则返回 null
 */
function getPublicKey(): crypto.KeyObject | null {
  if (keyLoadAttempted) return cachedPublicKey
  keyLoadAttempted = true

  if (!PLUGIN_SIGNING_PUBLIC_KEY_BASE64) {
    logger.security.warn('[PluginSignature] Public key not configured, signature verification disabled')
    return null
  }

  try {
    // 尝试作为 PEM 格式加载
    if (PLUGIN_SIGNING_PUBLIC_KEY_BASE64.includes('BEGIN')) {
      cachedPublicKey = crypto.createPublicKey(PLUGIN_SIGNING_PUBLIC_KEY_BASE64)
    } else {
      // Base64 原始公钥字节 → 转换为 PEM
      const rawBytes = Buffer.from(PLUGIN_SIGNING_PUBLIC_KEY_BASE64, 'base64')
      cachedPublicKey = crypto.createPublicKey({
        key: rawBytes,
        format: 'der',
        type: 'spki',
      })
    }
    logger.security.info('[PluginSignature] Public key loaded successfully')
    return cachedPublicKey
  } catch (err) {
    logger.security.error('[PluginSignature] Failed to load public key:', err)
    return null
  }
}

/**
 * 验证插件包文件的 Ed25519 数字签名。
 *
 * @param filePath 插件包文件路径（.tar.gz）
 * @param signatureBase64 Base64 编码的签名
 * @returns 验证结果
 */
export function verifyPluginSignature(
  filePath: string,
  signatureBase64: string,
): SignatureVerificationResult {
  const publicKey = getPublicKey()
  if (!publicKey) {
    return { valid: false, reason: 'key_not_configured' }
  }

  if (!signatureBase64 || typeof signatureBase64 !== 'string') {
    return { valid: false, reason: 'invalid_format', detail: 'signature is empty or not a string' }
  }

  try {
    const signatureBuffer = Buffer.from(signatureBase64, 'base64')
    if (signatureBuffer.length !== 64) {
      // Ed25519 签名固定 64 字节
      return {
        valid: false,
        reason: 'invalid_format',
        detail: `signature length ${signatureBuffer.length} != 64 (expected for Ed25519)`,
      }
    }

    const fileBuffer = fs.readFileSync(filePath)

    // Ed25519 验签：algorithm 必须为 null
    const isValid = crypto.verify(null, fileBuffer, publicKey, signatureBuffer)

    if (!isValid) {
      return { valid: false, reason: 'signature_mismatch' }
    }

    return { valid: true }
  } catch (err) {
    return {
      valid: false,
      reason: 'verification_error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 检查签名验证是否已启用（公钥已配置）。
 */
export function isSignatureVerificationEnabled(): boolean {
  return getPublicKey() !== null
}

/**
 * 校验插件包签名的完整流程（含日志记录）。
 *
 * 策略：
 * - signature 存在且验证通过 → 放行
 * - signature 存在但验证失败 → 拒绝（安全底线）
 * - signature 缺失 → 记录警告，放行（过渡期兼容）
 *   待后端全面启用签名后，将此分支改为 return false 强制拒绝
 *
 * @param filePath 插件包文件路径
 * @param signature Base64 签名（来自后端 PluginDownloadInfo.signature）
 * @returns true 表示允许安装，false 表示拒绝
 */
export function validatePluginPackageSignature(filePath: string, signature?: string): boolean {
  // 公钥未配置 → 签名验证功能未启用，放行
  if (!isSignatureVerificationEnabled()) {
    return true
  }

  // signature 缺失 → 过渡期兼容，记录警告但放行
  if (!signature) {
    logger.security.warn(
      '[PluginSignature] Package has no signature (transition period, allowed). ' +
        'Once backend fully enables signing, this will be rejected.',
    )
    return true
  }

  // signature 存在 → 必须验证通过
  const result = verifyPluginSignature(filePath, signature)
  if (result.valid) {
    logger.security.info('[PluginSignature] Signature verification passed')
    return true
  }

  // 验证失败 → 拒绝安装
  logger.security.error(
    `[PluginSignature] Signature verification FAILED: ${result.reason}` +
      (result.detail ? ` (${result.detail})` : ''),
  )
  return false
}
