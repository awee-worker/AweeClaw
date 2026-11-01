/**
 * 执行期专家切换测试
 *
 * 关注判定边界：什么信号该切、什么信号不该切、用户锁定时是否留了退路。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RoleDescriptor } from '../RoleDescriptor'
import { DEV_BUILTIN_ROLES } from '../BuiltinRoles'

const roleState = vi.hoisted(() => ({ roles: [] as unknown[], fail: false }))

vi.mock('@renderer/modes/roleLibraryStore', () => ({
  useRoleLibraryStore: {
    getState: () => ({
      getEnabledRoles: () => {
        if (roleState.fail) throw new Error('store unavailable')
        return roleState.roles
      },
    }),
  },
}))

import {
  collectExecutionSignals,
  resolveExecutionRole,
  buildExecutionRoleSwitchMessage,
} from '../executionRoleSwitch'

const devRoles = DEV_BUILTIN_ROLES as RoleDescriptor[]

beforeEach(() => {
  roleState.roles = devRoles
  roleState.fail = false
})

describe('collectExecutionSignals', () => {
  it('从写文件参数里取到路径', () => {
    const signals = collectExecutionSignals([
      { name: 'write_file', arguments: { path: 'src/components/Button.tsx', content: '...' } },
    ])
    expect(signals.paths).toContain('src/components/button.tsx')
  })

  it('从命令参数里取到命令', () => {
    const signals = collectExecutionSignals([
      { name: 'run_command', arguments: { command: 'npm test -- --watch=false' } },
    ])
    expect(signals.commands[0]).toContain('npm test')
  })

  it('只读工具与纯查询参数不产生信号', () => {
    const signals = collectExecutionSignals([
      { name: 'read_file', arguments: { path: 'src/api/user.ts' } },
      { name: 'ask_user', arguments: { question: '要继续吗' } },
    ])
    expect(signals.paths).toHaveLength(0)
    expect(signals.commands).toHaveLength(0)
  })

  it('无扩展名且无目录的值不算路径', () => {
    const signals = collectExecutionSignals([
      { name: 'write_file', arguments: { path: 'hello' } },
    ])
    expect(signals.paths).toHaveLength(0)
  })
})

describe('resolveExecutionRole', () => {
  it('写前端组件切到前端专家', () => {
    const signals = collectExecutionSignals([
      { name: 'edit_file', arguments: { path: 'src/components/Header.tsx' } },
    ])
    const match = resolveExecutionRole('dev', signals)
    expect(match.role?.id).toBe('dev.frontend')
    expect(match.score).toBeGreaterThanOrEqual(0.55)
  })

  it('写接口文件切到后端专家', () => {
    const signals = collectExecutionSignals([
      { name: 'edit_file', arguments: { path: 'src/api/user.ts' } },
    ])
    const match = resolveExecutionRole('dev', signals)
    expect(match.role?.id).toBe('dev.backend')
  })

  it('跑测试命令切到测试专家', () => {
    const signals = collectExecutionSignals([
      { name: 'run_command', arguments: { command: 'npm test' } },
    ])
    const match = resolveExecutionRole('dev', signals)
    expect(match.role?.id).toBe('dev.qa')
  })

  it('使用容器命令切到运维专家', () => {
    const signals = collectExecutionSignals([
      { name: 'run_command', arguments: { command: 'docker compose up -d' } },
    ])
    const match = resolveExecutionRole('dev', signals)
    expect(match.role?.id).toBe('dev.devops')
  })

  it('当前专家被排除后不再重复切换', () => {
    const signals = collectExecutionSignals([
      { name: 'edit_file', arguments: { path: 'src/components/Header.tsx' } },
    ])
    const match = resolveExecutionRole('dev', signals, ['dev.frontend'])
    expect(match.role).toBeNull()
  })

  it('单条弱路径线索不足以切换', () => {
    const signals = collectExecutionSignals([
      { name: 'write_file', arguments: { path: 'docs/architecture/design.md' } },
    ])
    const match = resolveExecutionRole('dev', signals)
    // 命中 architect 的两条路径线索时应当切换，仅一条时不应切换
    expect(match.score < 0.55 || match.role?.id === 'dev.architect').toBe(true)
  })

  it('无信号直接返回空结果', () => {
    const match = resolveExecutionRole('dev', { paths: [], commands: [], text: '' })
    expect(match.role).toBeNull()
    expect(match.score).toBe(0)
  })

  it('角色库读取失败不抛错，退化为不切换', () => {
    roleState.fail = true
    const signals = collectExecutionSignals([
      { name: 'edit_file', arguments: { path: 'src/components/Header.tsx' } },
    ])
    expect(() => resolveExecutionRole('dev', signals)).not.toThrow()
    expect(resolveExecutionRole('dev', signals).role).toBeNull()
  })
})

describe('buildExecutionRoleSwitchMessage', () => {
  it('中文提示带上角色名称、人设与输出契约', () => {
    const role = devRoles.find(r => r.id === 'dev.backend')!
    const text = buildExecutionRoleSwitchMessage(role, 'zh')
    expect(text).toContain('后端开发专家')
    expect(text).toContain(role.personaPrompt)
    expect(text).toContain(role.outputContract!)
  })

  it('强调只作用于当前阶段且不修改其他步骤文件', () => {
    const role = devRoles.find(r => r.id === 'dev.frontend')!
    const text = buildExecutionRoleSwitchMessage(role, 'zh')
    expect(text).toContain('当前阶段')
    expect(text).toContain('不要修改其他步骤负责的文件')
  })
})
