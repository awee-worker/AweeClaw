import { describe, it, expect } from 'vitest'
import {
  detectSensitiveContent,
  hasSensitiveTag,
} from './sensitiveContent'

describe('detectSensitiveContent', () => {
  it('识别身份证号', () => {
    expect(detectSensitiveContent('证件号 11010119900307651X 已登记')).toBe('身份证号')
  })

  it('识别手机号', () => {
    expect(detectSensitiveContent('联系电话 13812345678')).toBe('手机号')
  })

  it('识别银行卡号', () => {
    expect(detectSensitiveContent('卡号 6222021234567890123')).toBe('银行卡号')
  })

  it('识别邮箱', () => {
    expect(detectSensitiveContent('邮箱 user@example.com')).toBe('邮箱')
  })

  it('识别密钥类内容', () => {
    expect(detectSensitiveContent('api_key = sk-abcdef123456')).toBe('密码/密钥')
    expect(detectSensitiveContent('密码：abc123')).toBe('密码/密钥')
  })

  it('识别车牌号', () => {
    expect(detectSensitiveContent('车牌 苏A12345')).toBe('车牌号')
  })

  it('命中隐私关键词', () => {
    expect(detectSensitiveContent('他的家庭住址在城东')).toBe('隐私关键词')
  })

  it('普通内容不判定为敏感', () => {
    expect(detectSensitiveContent('今天下午三点和产品经理评审需求')).toBeNull()
    expect(detectSensitiveContent('')).toBeNull()
    expect(detectSensitiveContent(null)).toBeNull()
  })
})

describe('hasSensitiveTag', () => {
  it('识别 JSON 字符串标签', () => {
    expect(hasSensitiveTag('["项目","敏感"]')).toBe(true)
    expect(hasSensitiveTag('["project"]')).toBe(false)
  })

  it('识别数组标签', () => {
    expect(hasSensitiveTag(['private'])).toBe(true)
    expect(hasSensitiveTag(['normal'])).toBe(false)
  })

  it('空值返回 false', () => {
    expect(hasSensitiveTag(undefined)).toBe(false)
    expect(hasSensitiveTag(null)).toBe(false)
    expect(hasSensitiveTag('')).toBe(false)
  })
})
