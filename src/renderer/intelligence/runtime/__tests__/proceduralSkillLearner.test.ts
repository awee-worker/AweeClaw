/**
 * 程序性技能固化门槛
 *
 * 固化决定「后续同类任务会不会被一套旧流程带偏」，所以门槛本身要有测试盯着：
 * 什么是可复用的方法、多少次成功才算稳定、路径不一致时是否拒绝固化、
 * 以及用户能否把一条不该存在的记录真正删掉。
 *
 * 不覆盖：提示词注入与宏工具注册（属于注册层与提示词层的职责）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { isReusableSequence, proceduralSkillLearner } from '../proceduralSkillLearner'
import type { ChatMessage } from '@intelligence/providerTypes'
import type { ToolCall } from '@shared/protocols/modelProtocol'

/** 一条成功走完的多工具路径：读 → 改 → 跑 */
const STABLE_PATH = ['read_file', 'edit_file', 'run_command']

function makeToolCall(name: string): ToolCall {
  return {
    id: `tc-${name}`,
    name,
    arguments: {},
    status: 'success',
  } as ToolCall
}

function assistantWith(toolNames: string[]): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    toolCalls: toolNames.map(makeToolCall),
  } as unknown as ChatMessage
}

async function recordSuccess(
  times: number,
  toolNames: string[] = STABLE_PATH,
  userMessage = 'deploy service pipeline',
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await proceduralSkillLearner.recordTaskCompletion({
      userMessage,
      threadMessages: [assistantWith(toolNames)],
      success: true,
    })
  }
}

function step(name: string) {
  return { toolName: name, params: {} }
}

describe('isReusableSequence', () => {
  it('单步调用只是用了一次工具，不构成方法', () => {
    expect(isReusableSequence([step('edit_file')])).toBe(false)
  })

  it('同一个工具连调多次是重复动作，不是流程编排', () => {
    expect(isReusableSequence([step('edit_file'), step('edit_file'), step('edit_file')])).toBe(false)
  })

  it('纯只读探查没有产出动作，不可复用', () => {
    expect(isReusableSequence([step('read_file'), step('search_files'), step('list_directory')])).toBe(false)
  })

  it('多工具协作且含产出动作，才算可复用', () => {
    expect(isReusableSequence([step('read_file'), step('edit_file'), step('run_command')])).toBe(true)
  })
})

describe('固化门槛', () => {
  beforeEach(async () => {
    await proceduralSkillLearner.clearTemplates()
  })

  it('同一条路径只成功两次不固化', async () => {
    await recordSuccess(2)
    expect(await proceduralSkillLearner.getTemplates()).toHaveLength(0)
  })

  it('同一条路径成功三次固化为一条模板', async () => {
    await recordSuccess(3)
    const templates = await proceduralSkillLearner.getTemplates()

    expect(templates).toHaveLength(1)
    expect(templates[0].toolSequence).toHaveLength(STABLE_PATH.length)
    expect(templates[0].successCount).toBe(3)
  })

  it('每次都走不同路径时拒绝固化：那说明流程还没稳定', async () => {
    await recordSuccess(1, ['read_file', 'edit_file', 'run_command'])
    await recordSuccess(1, ['read_file', 'edit_file', 'write_file'])
    await recordSuccess(1, ['search_files', 'edit_file', 'run_command'])

    expect(await proceduralSkillLearner.getTemplates()).toHaveLength(0)
  })

  it('单步任务跑再多次也不固化', async () => {
    await recordSuccess(5, ['edit_file'])
    expect(await proceduralSkillLearner.getTemplates()).toHaveLength(0)
  })
})

describe('删除记录', () => {
  beforeEach(async () => {
    await proceduralSkillLearner.clearTemplates()
  })

  it('删除后模板从列表消失，返回 true', async () => {
    await recordSuccess(3)
    const [template] = await proceduralSkillLearner.getTemplates()

    expect(await proceduralSkillLearner.deleteTemplate(template.id)).toBe(true)
    expect(await proceduralSkillLearner.getTemplates()).toHaveLength(0)
  })

  it('删除不存在的 id 返回 false', async () => {
    expect(await proceduralSkillLearner.deleteTemplate('not-exist')).toBe(false)
  })
})
