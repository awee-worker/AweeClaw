/**
 * 伴侣状态表达验收
 *
 * 验收目标：四种 Agent 状态都有明确表达，语音只在显式开启时下发。
 */

import { describe, expect, it } from 'vitest'
import {
  buildStateCommands,
  reactionForAgentState,
  type CompanionAgentState,
} from '../companionStateMapping'

describe('reactionForAgentState', () => {
  it('执行中表现为思考动作', () => {
    const reaction = reactionForAgentState('working')

    expect(reaction.action).toBe('think')
    expect(reaction.speak).toBeUndefined()
  })

  it('等待确认有提示动作并附带语音文案', () => {
    const reaction = reactionForAgentState('awaiting_approval')

    expect(reaction.action).toBe('wave')
    expect(reaction.expression).toBe('surprised')
    expect(reaction.speak).toBeTruthy()
  })

  it('完成表现为完成动作', () => {
    expect(reactionForAgentState('completed').action).toBe('peace')
    expect(reactionForAgentState('completed').expression).toBe('happy')
  })

  it('被阻塞表现为困惑动作并说明需要介入', () => {
    const reaction = reactionForAgentState('blocked')

    expect(reaction.action).toBe('think')
    expect(reaction.speak).toBeTruthy()
  })

  it('空闲只回到中性表情，不做多余动作', () => {
    const reaction = reactionForAgentState('idle')

    expect(reaction.action).toBeUndefined()
    expect(reaction.expression).toBe('neutral')
    expect(reaction.speak).toBeUndefined()
  })

  it('未知状态按空闲处理而不是抛错', () => {
    const reaction = reactionForAgentState('unknown' as CompanionAgentState)

    expect(reaction.expression).toBe('neutral')
  })

  it('英文环境给出英文文案', () => {
    expect(reactionForAgentState('awaiting_approval', 'en').speak).toContain('confirm')
    expect(reactionForAgentState('awaiting_approval', 'zh').speak).toContain('确认')
  })

  it('每个状态都有表达，不存在空白映射', () => {
    const states: CompanionAgentState[] = ['idle', 'working', 'awaiting_approval', 'completed', 'blocked']

    for (const state of states) {
      const reaction = reactionForAgentState(state)
      expect(reaction.action || reaction.expression).toBeTruthy()
    }
  })
})

describe('buildStateCommands', () => {
  it('默认不下发语音指令', () => {
    const commands = buildStateCommands(reactionForAgentState('completed'))

    expect(commands.map(command => command.type)).toEqual(['expression', 'play_action'])
  })

  it('显式开启后才下发语音', () => {
    const commands = buildStateCommands(reactionForAgentState('completed'), { includeVoice: true })

    expect(commands.map(command => command.type)).toEqual(['expression', 'play_action', 'speak'])
    expect(commands[2].text).toBeTruthy()
  })

  it('指令顺序为先表情、后动作、再说话', () => {
    const commands = buildStateCommands(reactionForAgentState('awaiting_approval'), {
      includeVoice: true,
    })

    expect(commands.map(command => command.type)).toEqual(['expression', 'play_action', 'speak'])
  })

  it('空闲状态不产生指令', () => {
    const commands = buildStateCommands(reactionForAgentState('idle'), { includeVoice: true })

    expect(commands.map(command => command.type)).toEqual(['expression'])
  })

  it('动作名使用语义别名，由渲染层归一', () => {
    const commands = buildStateCommands(reactionForAgentState('working'))

    expect(commands.every(command => typeof command.name === 'string')).toBe(true)
  })
})
