/**
 * Agent Card 签名
 *
 * 卡片在发现阶段必须明文可读，因此「谁来读都可以」是无法避免的；签名补上的是
 * 「读到的是不是原件」：对端拿到卡片后先验签，再决定是否信任其中的 url 与技能声明，
 * 从而避免卡片在传递环节被替换成指向别处的内容。
 *
 * 公钥随签名一并给出，面向的是防篡改而不是防伪造身份：替换者可以自带一对新密钥
 * 重签，但 keyId 会随之改变，调用方与此前记录的值一比即可发现。要校验身份本身，
 * 公钥需要经可信渠道分发。
 *
 * @module a2a/agentCardSigner
 */

import * as crypto from 'crypto'
import type { A2aAgentCard, A2aAgentCardSignature } from '@shared/protocols/a2aProtocol'

/** 签名算法标识（对应 Node crypto 的 RSA-SHA256） */
export const SIGN_ALGORITHM = 'RS256'

/** Node crypto 使用的算法名 */
const NODE_SIGN_ALGORITHM = 'RSA-SHA256'

/** RSA 密钥长度 */
const KEY_SIZE = 2048

/** keyId 取指纹前若干位，够用且便于人工比对 */
const KEY_ID_LENGTH = 16

export interface AgentSigningKeys {
  publicKey: string
  privateKey: string
}

export interface VerifyResult {
  valid: boolean
  reason?: string
}

/** 生成一对用于卡片签名的 RSA 密钥（PEM 格式） */
export function generateAgentSigningKeys(): AgentSigningKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: KEY_SIZE,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  return { publicKey, privateKey }
}

/** 公钥指纹，作为 keyId 供对端识别密钥是否变过 */
export function computeKeyId(publicKey: string): string {
  return crypto
    .createHash('sha256')
    .update(publicKey, 'utf8')
    .digest('base64url')
    .slice(0, KEY_ID_LENGTH)
}

/**
 * 递归按键名排序
 *
 * 同一份卡片在不同实现、不同字段顺序下必须产生完全相同的字节，
 * 否则签名会因序列化差异而验不过。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, canonicalize(v)] as const)

    return Object.fromEntries(entries)
  }

  return value
}

/**
 * 构造签名载荷：剔除 signatures 后的规范化 JSON
 *
 * signatures 必须剔除 —— 否则签名会包含自身，永远无法复现。
 */
export function buildSigningPayload(card: A2aAgentCard): string {
  const clone: Record<string, unknown> = { ...card }
  delete clone.signatures
  return JSON.stringify(canonicalize(clone))
}

/** 对卡片签名，返回带 signatures 的新卡片（不改动入参） */
export function signAgentCard(card: A2aAgentCard, keys: AgentSigningKeys): A2aAgentCard {
  const payload = buildSigningPayload(card)
  const signature = crypto
    .createSign(NODE_SIGN_ALGORITHM)
    .update(payload, 'utf8')
    .sign(keys.privateKey, 'base64url')

  const entry: A2aAgentCardSignature = {
    algorithm: SIGN_ALGORITHM,
    keyId: computeKeyId(keys.publicKey),
    signature,
    publicKey: Buffer.from(keys.publicKey, 'utf8').toString('base64url'),
  }

  return { ...card, signatures: [entry] }
}

/**
 * 验证卡片签名
 *
 * 逐条验签，任一条通过即视为有效：一张卡片可能由多方签发，
 * 调用方通常只需确认「其中之一来自它信任的密钥」。
 */
export function verifyAgentCard(card: A2aAgentCard): VerifyResult {
  const signatures = card.signatures
  if (!signatures?.length) {
    return { valid: false, reason: '卡片未签名' }
  }

  const payload = buildSigningPayload(card)
  const failures: string[] = []

  for (const entry of signatures) {
    if (entry.algorithm !== SIGN_ALGORITHM) {
      failures.push(`不支持的算法：${entry.algorithm}`)
      continue
    }

    if (!entry.publicKey) {
      failures.push('签名缺少公钥')
      continue
    }

    try {
      const publicKey = Buffer.from(entry.publicKey, 'base64url').toString('utf8')
      const ok = crypto
        .createVerify(NODE_SIGN_ALGORITHM)
        .update(payload, 'utf8')
        .verify(publicKey, entry.signature, 'base64url')

      if (ok) return { valid: true }
      failures.push('签名不匹配')
    } catch (err) {
      failures.push(err instanceof Error ? err.message : '验签失败')
    }
  }

  return { valid: false, reason: failures.join('; ') }
}
