/**
 * 审批门禁判定测试
 *
 * 覆盖三套授权方式规则与外部内容升级：
 * 1. 手动审批：创建与修改文件直接执行、改动事后由变更条裁决（review）；
 *    删除文件、危险命令、外部内容在执行前拦下（block）
 * 2. 自动审批：只确认危险操作与危险命令
 * 3. 完全访问：全部免确认
 * 4. 外部内容升级只在手动审批模式下叠加，且只影响高权限操作
 *    （写入 / 终端 / 危险 / 对外发送）——读取与交互类升级会让确认变成噪音
 */

import { describe, it, expect } from 'vitest'
import {
  decideApprovalByMode,
  decideApprovalGateByMode,
  isHighImpactTool,
  isIrreversibleTool,
  isRiskyCommand,
  shouldEscalateForUntrusted,
} from '../approvalEscalation'
import type { UntrustedContextSignal } from '@intelligence/types/trustTypes'

const untrustedPresent: UntrustedContextSignal = {
  present: true,
  sources: [{ toolName: 'web_search', channel: 'web', locator: 'https://a.com' }],
}

const untrustedAbsent: UntrustedContextSignal = { present: false, sources: [] }

describe('isHighImpactTool', () => {
  it('写入类工具属高权限', () => {
    expect(isHighImpactTool('write_file', 'interaction')).toBe(true)
    expect(isHighImpactTool('edit_file', 'interaction')).toBe(true)
    expect(isHighImpactTool('create_file_or_folder', 'interaction')).toBe(true)
  })

  it('终端与危险类属高权限', () => {
    expect(isHighImpactTool('run_command', 'terminal')).toBe(true)
    expect(isHighImpactTool('delete_file_or_folder', 'dangerous')).toBe(true)
  })

  it('对外发送类属高权限', () => {
    expect(isHighImpactTool('send_file_to_channel', 'none')).toBe(true)
  })

  it('读取类不属高权限', () => {
    expect(isHighImpactTool('read_file', 'none')).toBe(false)
    expect(isHighImpactTool('search_files', 'none')).toBe(false)
    expect(isHighImpactTool('web_search', 'none')).toBe(false)
  })

  it('交互与编排类不属高权限', () => {
    expect(isHighImpactTool('ask_user', 'interaction')).toBe(false)
    expect(isHighImpactTool('todo_write', 'none')).toBe(false)
  })
})

describe('shouldEscalateForUntrusted', () => {
  it('无外部内容时不升级', () => {
    expect(shouldEscalateForUntrusted('write_file', 'interaction', untrustedAbsent)).toBe(false)
  })

  it('未传信号时按无外部内容处理', () => {
    expect(shouldEscalateForUntrusted('write_file', 'interaction', undefined)).toBe(false)
  })

  it('有外部内容且为高权限操作时升级', () => {
    expect(shouldEscalateForUntrusted('write_file', 'interaction', untrustedPresent)).toBe(true)
    expect(shouldEscalateForUntrusted('run_command', 'terminal', untrustedPresent)).toBe(true)
    expect(shouldEscalateForUntrusted('delete_file_or_folder', 'dangerous', untrustedPresent)).toBe(true)
  })

  it('有外部内容但为只读操作时不升级', () => {
    expect(shouldEscalateForUntrusted('read_file', 'none', untrustedPresent)).toBe(false)
    expect(shouldEscalateForUntrusted('search_files', 'none', untrustedPresent)).toBe(false)
    expect(shouldEscalateForUntrusted('web_search', 'none', untrustedPresent)).toBe(false)
  })

  it('完全访问下不升级：用户已显式选择免确认', () => {
    expect(shouldEscalateForUntrusted('write_file', 'none', untrustedPresent, 'never')).toBe(false)
    expect(shouldEscalateForUntrusted('run_command', 'terminal', untrustedPresent, 'never')).toBe(false)
    expect(shouldEscalateForUntrusted('delete_file_or_folder', 'dangerous', untrustedPresent, 'never')).toBe(false)
  })

  it('授权方式为手动审批时按高权限操作升级', () => {
    expect(shouldEscalateForUntrusted('write_file', 'none', untrustedPresent, 'every-step')).toBe(true)
    expect(shouldEscalateForUntrusted('run_command', 'terminal', untrustedPresent, 'every-step')).toBe(true)
  })
})

describe('isIrreversibleTool', () => {
  it('内置删除文件工具属不可逆操作', () => {
    expect(isIrreversibleTool('delete_file_or_folder')).toBe(true)
  })

  it('按名称识别 MCP 工具中的文件系统删除语义', () => {
    expect(isIrreversibleTool('mcp_filesystem__delete_file')).toBe(true)
    expect(isIrreversibleTool('mcp_filesystem__delete_directory')).toBe(true)
    expect(isIrreversibleTool('mcp_fs__remove_folder')).toBe(true)
    expect(isIrreversibleTool('mcp_fs__unlink')).toBe(true)
    expect(isIrreversibleTool('mcp_fs__delete')).toBe(true)
  })

  it('serverId 里的删除语义不参与判定', () => {
    expect(isIrreversibleTool('mcp_remove_files__list_directory')).toBe(false)
  })

  it('删除动词后接非文件系统对象时不判定为不可逆', () => {
    expect(isIrreversibleTool('delete_sheet_rows')).toBe(false)
    expect(isIrreversibleTool('delete_paragraph')).toBe(false)
    expect(isIrreversibleTool('delete_entities')).toBe(false)
  })

  it('常规读写与命令工具不判定为不可逆', () => {
    expect(isIrreversibleTool('write_file')).toBe(false)
    expect(isIrreversibleTool('read_file')).toBe(false)
    expect(isIrreversibleTool('move_file')).toBe(false)
    expect(isIrreversibleTool('run_command')).toBe(false)
    expect(isIrreversibleTool('')).toBe(false)
  })
})

describe('isRiskyCommand', () => {
  it('只判定 run_command', () => {
    expect(isRiskyCommand('read_file', { command: 'rm -rf /' })).toBe(false)
    expect(isRiskyCommand('run_command', { command: 'ls -la' })).toBe(false)
  })

  it('危险模式与灰区规则命中的命令需要确认', () => {
    expect(isRiskyCommand('run_command', { command: 'git reset --hard HEAD~1' })).toBe(true)
    expect(isRiskyCommand('run_command', { command: 'git clean -fd' })).toBe(true)
  })

  it('缺少命令内容时不判定为危险', () => {
    expect(isRiskyCommand('run_command', {})).toBe(false)
    expect(isRiskyCommand('run_command', undefined)).toBe(false)
  })
})

describe('decideApprovalGateByMode', () => {
  const workspace = '/ws'

  it('手动审批：创建与修改文件直接执行，改为事后复核', () => {
    expect(decideApprovalGateByMode('write_file', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe('review')
    expect(decideApprovalGateByMode('edit_file', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe('review')
    expect(decideApprovalGateByMode('create_file_or_folder', { path: 'src/a.ts', content: 'export default {}' }, 'every-step', { workspacePath: workspace })).toBe('review')
  })

  it('手动审批：本轮消费过外部内容时，写入回到事前确认', () => {
    expect(decideApprovalGateByMode('write_file', { path: 'src/a.ts' }, 'every-step', {
      workspacePath: workspace,
      untrustedContext: untrustedPresent,
    })).toBe('block')
    expect(decideApprovalGateByMode('edit_file', { path: 'src/a.ts' }, 'every-step', {
      workspacePath: workspace,
      untrustedContext: untrustedPresent,
    })).toBe('block')
  })

  it('手动审批：删除、危险命令与工作区外的写入在执行前拦下', () => {
    expect(decideApprovalGateByMode('delete_file_or_folder', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe('block')
    expect(decideApprovalGateByMode('mcp_filesystem__delete_file', { path: 'a.txt' }, 'every-step', { workspacePath: workspace })).toBe('block')
    expect(decideApprovalGateByMode('run_command', { command: 'git reset --hard HEAD~1' }, 'every-step', { workspacePath: workspace })).toBe('block')
    expect(decideApprovalGateByMode('write_file', { path: '/etc/a.ts' }, 'every-step', { workspacePath: workspace })).toBe('block')
  })

  it('手动审批：只创建目录、读取类与普通命令直接执行', () => {
    expect(decideApprovalGateByMode('create_file_or_folder', { path: 'reports/' }, 'every-step', { workspacePath: workspace })).toBe('none')
    expect(decideApprovalGateByMode('read_file', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe('none')
    expect(decideApprovalGateByMode('run_command', { command: 'npm test' }, 'every-step', { workspacePath: workspace })).toBe('none')
  })

  it('自动审批：写入直接执行，不可逆操作与危险命令仍拦下', () => {
    expect(decideApprovalGateByMode('write_file', { path: 'src/a.ts' }, 'dangerous-only', { workspacePath: workspace })).toBe('none')
    expect(decideApprovalGateByMode('delete_file_or_folder', { path: 'src/a.ts' }, 'dangerous-only', { workspacePath: workspace })).toBe('block')
    expect(decideApprovalGateByMode('run_command', { command: 'git clean -fd' }, 'dangerous-only', { workspacePath: workspace })).toBe('block')
  })

  it('完全访问：全部直接执行', () => {
    expect(decideApprovalGateByMode('write_file', { path: '/etc/a.ts' }, 'never', { workspacePath: workspace })).toBe('none')
    expect(decideApprovalGateByMode('delete_file_or_folder', { path: 'src/a.ts' }, 'never', { workspacePath: workspace })).toBe('none')
  })
})

describe('decideApprovalByMode', () => {
  const workspace = '/ws'

  it('手动审批：创建与修改文件需要用户确认（主链路按事后复核处理）', () => {
    expect(decideApprovalByMode('write_file', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('edit_file', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('create_file_or_folder', { path: 'src/a.ts', content: 'export default {}' }, 'every-step', { workspacePath: workspace })).toBe(true)
  })

  it('二值判定不会把写入静默放行：没有复核入口的链路仍需一次确认', () => {
    // 语音助手、子 Agent 只有「执行 / 不执行」两种结论，拿到 review 当作需要确认
    expect(decideApprovalByMode('write_file', { path: 'src/a.ts' }, 'every-step', {
      workspacePath: workspace,
      untrustedContext: untrustedAbsent,
    })).toBe(true)
  })

  it('手动审批：只创建目录免确认', () => {
    // 尾斜杠明确的目录
    expect(decideApprovalByMode('create_file_or_folder', { path: 'src/newdir/' }, 'every-step', { workspacePath: workspace })).toBe(false)
    // 没写尾斜杠、也没有扩展名与内容，执行层同样按目录落盘
    expect(decideApprovalByMode('create_file_or_folder', { path: 'reports' }, 'every-step', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('create_file_or_folder', { path: 'reports', content: '' }, 'every-step', { workspacePath: workspace })).toBe(false)
  })

  it('手动审批：带扩展名且内容为空的路径仍按写文件确认', () => {
    // 有无扩展名决定落盘是文件还是目录（判定与执行层同源），带扩展名的空文件仍是文件写入
    expect(decideApprovalByMode('create_file_or_folder', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('create_file_or_folder', { path: 'src/a.ts', content: '' }, 'every-step', { workspacePath: workspace })).toBe(true)
  })

  it('手动审批：工作区外建目录仍要确认', () => {
    expect(decideApprovalByMode('create_file_or_folder', { path: '/etc/newdir/' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('create_file_or_folder', { path: '/etc/newdir/' }, 'every-step', {
      workspacePath: workspace,
      authorizedRoots: ['/etc'],
    })).toBe(false)
  })

  it('手动审批：危险命令需要确认', () => {
    expect(decideApprovalByMode('run_command', { command: 'git reset --hard HEAD~1' }, 'every-step', { workspacePath: workspace })).toBe(true)
  })

  it('手动审批：外部内容（工作区与授权目录之外的路径）需要确认', () => {
    expect(decideApprovalByMode('read_file', { path: '/etc/hosts' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('read_file', { path: '../outside/a.ts' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('list_directory', { path: '/Users' }, 'every-step', { workspacePath: workspace })).toBe(true)
  })

  it('手动审批：用户授权的区外目录不算外部内容', () => {
    expect(decideApprovalByMode('read_file', { path: '/data/shared/a.ts' }, 'every-step', {
      workspacePath: workspace,
      authorizedRoots: ['/data/shared'],
    })).toBe(false)

    expect(decideApprovalByMode('read_file', { path: '/data/other/a.ts' }, 'every-step', {
      workspacePath: workspace,
      authorizedRoots: ['/data/shared'],
    })).toBe(true)
  })

  it('手动审批：关闭严格工作区模式后不再按外部内容确认', () => {
    expect(decideApprovalByMode('read_file', { path: '/etc/hosts' }, 'every-step', {
      workspacePath: workspace,
      allowOutsideWorkspace: true,
    })).toBe(false)
  })

  it('手动审批：读取、编排与普通命令免确认', () => {
    expect(decideApprovalByMode('read_file', { path: 'src/a.ts' }, 'every-step', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('search_files', { pattern: 'foo' }, 'every-step', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('todo_write', {}, 'every-step', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('run_command', { command: 'npm test' }, 'every-step', { workspacePath: workspace })).toBe(false)
  })

  it('自动审批：只确认危险操作与危险命令', () => {
    expect(decideApprovalByMode('delete_file_or_folder', { path: 'src/old.ts' }, 'dangerous-only', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('run_command', { command: 'git clean -fd' }, 'dangerous-only', { workspacePath: workspace })).toBe(true)

    expect(decideApprovalByMode('write_file', { path: 'src/a.ts' }, 'dangerous-only', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('run_command', { command: 'npm test' }, 'dangerous-only', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('read_file', { path: '/etc/hosts' }, 'dangerous-only', { workspacePath: workspace })).toBe(false)
  })

  it('不可逆操作在手动审批与自动审批下都必须确认', () => {
    expect(decideApprovalByMode('delete_file_or_folder', { path: 'src/old.ts' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('delete_file_or_folder', { path: 'src/old.ts' }, 'dangerous-only', { workspacePath: workspace })).toBe(true)
  })

  it('未注册审批类型的删除类工具按名称识别后仍需确认', () => {
    expect(decideApprovalByMode('mcp_filesystem__delete_file', { path: 'a.txt' }, 'every-step', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('mcp_filesystem__delete_file', { path: 'a.txt' }, 'dangerous-only', { workspacePath: workspace })).toBe(true)
    expect(decideApprovalByMode('mcp_filesystem__delete_directory', { path: 'dist' }, 'dangerous-only', { workspacePath: workspace })).toBe(true)
  })

  it('不可逆操作的判定不被外部内容相关的开关旁路', () => {
    expect(decideApprovalByMode('delete_file_or_folder', { path: 'src/old.ts' }, 'dangerous-only', {
      workspacePath: workspace,
      allowOutsideWorkspace: true,
      untrustedContext: untrustedAbsent,
    })).toBe(true)
  })

  it('完全访问：全部免确认', () => {
    expect(decideApprovalByMode('write_file', { path: 'src/a.ts' }, 'never', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('delete_file_or_folder', { path: 'src/old.ts' }, 'never', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('run_command', { command: 'git reset --hard' }, 'never', { workspacePath: workspace })).toBe(false)
    expect(decideApprovalByMode('read_file', { path: '/etc/hosts' }, 'never', { workspacePath: workspace })).toBe(false)
  })

  it('外部内容升级只在手动审批模式下叠加', () => {
    expect(decideApprovalByMode('run_command', { command: 'ls' }, 'every-step', {
      workspacePath: workspace,
      untrustedContext: untrustedPresent,
    })).toBe(true)

    expect(decideApprovalByMode('run_command', { command: 'ls' }, 'dangerous-only', {
      workspacePath: workspace,
      untrustedContext: untrustedPresent,
    })).toBe(false)
  })
})
