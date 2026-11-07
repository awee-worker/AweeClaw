/**
 * 统一脱敏的守门测试
 *
 * 保护两条边界：
 * 1. 敏感形态（5 类密钥）在记录里必须 0 命中；
 * 2. 脱敏只生成新值，不改入参 —— 发给模型的 content 不能因此被削弱。
 */
import { describe, it, expect } from 'vitest'
import { redactText, redactArgs, redactResult } from '../redact'

const SECRETS = {
  openai: 'sk-abcdefghijklmnopqrstuvwxyz012345',
  github: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  google: 'AIzaSyA1234567890abcdefghijklmnopqrstuv',
  bearer: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  customPassword: 'p@ssw0rd-very-secret',
}

describe('redactText', () => {
  it('抹掉 5 类密钥形态', () => {
    const input = `a=${SECRETS.openai} b=${SECRETS.github} c=${SECRETS.google} d=${SECRETS.bearer}`
    const out = redactText(input)

    expect(out).not.toContain('sk-abcdefghij')
    expect(out).not.toContain('ghp_abcdefghij')
    expect(out).not.toContain('AIzaSyA123456')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(out).toContain('***')
  })

  it('普通文本原样返回', () => {
    const text = '读取 src/main.ts 第 42 行'
    expect(redactText(text)).toBe(text)
  })

  it('空串不抛错', () => {
    expect(redactText('')).toBe('')
  })
})

describe('redactArgs', () => {
  it('敏感键名的值整段打码', () => {
    const out = redactArgs('some_tool', {
      user: 'alice',
      password: SECRETS.customPassword,
      apiKey: 'abc123',
      nested: { accessToken: 'tok_live_123' },
    }) as Record<string, unknown>

    expect(out.user).toBe('alice')
    expect(out.password).toBe('***')
    expect(out.apiKey).toBe('***')
    expect((out.nested as Record<string, unknown>).accessToken).toBe('***')
  })

  it('命令与写文件类工具整段打码，不猜内容', () => {
    const args = { command: 'curl -H "Authorization: Bearer xyz" https://api.example.com' }
    const out = redactArgs('run_command', args) as Record<string, unknown>
    expect(out.redacted).toBe(true)
    expect(JSON.stringify(out)).not.toContain('example.com')
  })

  it('不修改入参（模型侧拿到的仍是原文）', () => {
    const args = { password: SECRETS.customPassword }
    redactArgs('some_tool', args)
    expect(args.password).toBe(SECRETS.customPassword)
  })
})

describe('redactResult', () => {
  it('命令结果整段脱敏并标注长度', () => {
    const out = redactResult('run_command', 'token=abc1234567890')
    expect(out).toMatch(/^\[redacted \d+ chars\]$/)
  })

  it('普通结果里的密钥被抹掉', () => {
    const out = redactResult('read_file', `key: ${SECRETS.openai}`)
    expect(out).not.toContain(SECRETS.openai)
    expect(out).toContain('***')
  })

  it('循环引用不抛错：深度上限把它切断，不依赖序列化失败兜底', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const out = redactResult('some_tool', cyclic)
    // 递归到深度上限后整段打成 ***，循环被切断，因此不会走到 JSON.stringify 抛错分支
    expect(typeof out).toBe('string')
    expect(out).toContain('***')
  })
})
