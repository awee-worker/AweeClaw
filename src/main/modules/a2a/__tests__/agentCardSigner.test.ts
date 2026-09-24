/**
 * Agent Card 签名验收
 *
 * 验收目标：卡片能被验证为「未在传递环节被替换」，任一声明字段被改动都能被发现，
 * 且签名不因字段书写顺序不同而失效。
 */

import { describe, expect, it } from 'vitest'
import {
  buildSigningPayload,
  computeKeyId,
  generateAgentSigningKeys,
  signAgentCard,
  verifyAgentCard,
} from '../agentCardSigner'
import type { A2aAgentCard } from '@protocols/a2aProtocol'

/** 密钥生成较慢，测试间共享一对只读使用的密钥 */
const sharedKeys = generateAgentSigningKeys()

function baseCard(): A2aAgentCard {
  return {
    name: 'AweeClaw',
    description: 'work assistant',
    url: 'http://127.0.0.1:8790',
    version: '1.0.0',
    protocolVersion: '0.2.5',
    skills: [{ id: 's1', name: 'skill one' }],
  }
}

describe('signAgentCard / verifyAgentCard', () => {
  it('签名后的卡片可验签通过', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)

    expect(signed.signatures).toHaveLength(1)
    expect(verifyAgentCard(signed).valid).toBe(true)
  })

  it('签名不改动原卡片对象', () => {
    const card = baseCard()
    signAgentCard(card, sharedKeys)

    expect(card.signatures).toBeUndefined()
  })

  it('keyId 与公钥指纹一致', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)

    expect(signed.signatures?.[0].keyId).toBe(computeKeyId(sharedKeys.publicKey))
  })

  it('改动卡片地址会被发现', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)
    const tampered: A2aAgentCard = { ...signed, url: 'http://evil.example.com' }

    const result = verifyAgentCard(tampered)

    expect(result.valid).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('追加技能声明会被发现', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)
    const tampered: A2aAgentCard = {
      ...signed,
      skills: [...(signed.skills ?? []), { id: 'evil', name: 'evil skill' }],
    }

    expect(verifyAgentCard(tampered).valid).toBe(false)
  })

  it('未签名卡片视为无效', () => {
    const result = verifyAgentCard(baseCard())

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('未签名')
  })

  it('签名载荷剔除 signatures 自身', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)

    expect(buildSigningPayload(signed)).toBe(buildSigningPayload(baseCard()))
  })

  it('字段书写顺序不影响载荷与签名', () => {
    const card = baseCard()
    const reordered: A2aAgentCard = {
      protocolVersion: card.protocolVersion,
      version: card.version,
      url: card.url,
      description: card.description,
      name: card.name,
      skills: card.skills,
    }

    expect(buildSigningPayload(reordered)).toBe(buildSigningPayload(card))
    expect(signAgentCard(reordered, sharedKeys).signatures?.[0].signature).toBe(
      signAgentCard(card, sharedKeys).signatures?.[0].signature
    )
  })

  it('不支持的算法被拒绝', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)
    const broken: A2aAgentCard = {
      ...signed,
      signatures: [{ ...signed.signatures![0], algorithm: 'HS256' }],
    }

    const result = verifyAgentCard(broken)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('不支持的算法')
  })

  it('签名缺少公钥时无法验证', () => {
    const signed = signAgentCard(baseCard(), sharedKeys)
    const noKey: A2aAgentCard = {
      ...signed,
      signatures: [{ ...signed.signatures![0], publicKey: undefined }],
    }

    const result = verifyAgentCard(noKey)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('缺少公钥')
  })

  it('换成另一对密钥的公钥后验不过', () => {
    const otherKeys = generateAgentSigningKeys()
    const signed = signAgentCard(baseCard(), sharedKeys)
    const swapped: A2aAgentCard = {
      ...signed,
      signatures: [
        {
          ...signed.signatures![0],
          publicKey: Buffer.from(otherKeys.publicKey, 'utf8').toString('base64url'),
        },
      ],
    }

    expect(verifyAgentCard(swapped).valid).toBe(false)
  })
})
