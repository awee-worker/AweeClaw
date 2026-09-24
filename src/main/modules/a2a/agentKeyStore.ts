/**
 * Agent Card 签名密钥的持久化
 *
 * 密钥只在首次需要时生成并落盘：每次启动重新生成会让对端此前记录的 keyId 失效，
 * 卡片在对端看来就像被换过一样。
 *
 * 私钥以 0600 权限写入 A2A 数据目录，与该模块其它数据同处一处，便于一起清理。
 *
 * @module a2a/agentKeyStore
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { getA2aDataDir } from './A2aStore'
import {
  computeKeyId,
  generateAgentSigningKeys,
  type AgentSigningKeys,
} from './agentCardSigner'

/** 密钥文件名 */
const KEY_FILE_NAME = 'agent-signing-key.json'

let cachedKeys: AgentSigningKeys | null = null

function getKeyFilePath(): string {
  return path.join(getA2aDataDir(), KEY_FILE_NAME)
}

/**
 * 读取（必要时生成）签名密钥
 *
 * 读取或生成失败返回 null：调用方据此降级为「未签名卡片」，
 * 而不是让整个 A2A 服务起不来 —— 发现能力比签名更重要。
 */
export function getSigningKeys(): AgentSigningKeys | null {
  if (cachedKeys) return cachedKeys

  const filePath = getKeyFilePath()

  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<AgentSigningKeys>
      if (parsed.publicKey && parsed.privateKey) {
        cachedKeys = { publicKey: parsed.publicKey, privateKey: parsed.privateKey }
        return cachedKeys
      }
      logger.system.warn('[A2A] 签名密钥文件不完整，将重新生成')
    }

    const keys = generateAgentSigningKeys()
    fs.mkdirSync(getA2aDataDir(), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(keys, null, 2), { encoding: 'utf-8', mode: 0o600 })

    cachedKeys = keys
    logger.system.info(`[A2A] 已生成 Agent Card 签名密钥，keyId=${computeKeyId(keys.publicKey)}`)
    return cachedKeys
  } catch (err) {
    logger.system.warn('[A2A] 签名密钥不可用，卡片将以未签名形式发布:', err)
    return null
  }
}

/** 当前密钥指纹（状态面板展示用）；无密钥时返回空串 */
export function getSigningKeyId(): string {
  const keys = getSigningKeys()
  return keys ? computeKeyId(keys.publicKey) : ''
}

/** 清空内存缓存（测试用） */
export function clearSigningKeyCache(): void {
  cachedKeys = null
}
