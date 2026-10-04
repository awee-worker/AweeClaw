/**
 * 邮件内置工具可用性守卫
 *
 * mail_read / mail_send 是「邮件中心」IMAP 账户的 AI 调用入口：
 * 三种工作模式都必须下发，否则 AI 无法读取或发送用户邮件。
 */
import { describe, it, expect } from 'vitest'
import { TOOL_CONFIGS } from '@configuration/toolDefinitions'
import { getToolsForContext } from '@configuration/toolCategoryDefs'

const MAIL_TOOLS = ['mail_read', 'mail_send']

describe('邮件内置工具', () => {
  it('工具定义完整', () => {
    for (const name of MAIL_TOOLS) {
      const cfg = TOOL_CONFIGS[name]
      expect(cfg, `缺少工具定义：${name}`).toBeDefined()
      expect(cfg.name).toBe(name)
    }
  })

  it('mail_send 必填收件人 / 主题 / 正文', () => {
    const params = TOOL_CONFIGS.mail_send.parameters
    expect(params.to.required).toBe(true)
    expect(params.subject.required).toBe(true)
    expect(params.body.required).toBe(true)
  })

  it('三种模式都下发邮件工具', () => {
    for (const mode of ['chat', 'agent', 'expert'] as const) {
      const tools = getToolsForContext({ mode })
      for (const name of MAIL_TOOLS) {
        expect(tools, `${mode} 模式缺少 ${name}`).toContain(name)
      }
    }
  })
})
