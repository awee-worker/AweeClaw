import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 测试用场景状态：通过 setScene 切换 dev / 非 dev ──

let mockScene: 'dev' | 'work' | 'life' | 'study' = 'dev'

vi.mock('@renderer/modes/sceneModeStore', () => ({
  useSceneModeStore: {
    getState: () => ({
      currentSceneMode: mockScene,
      activeProfile: { id: mockScene },
    }),
  },
}))

vi.mock('@intelligence/runtime/codeAnalysisService', () => ({
  lintService: {
    getLintErrors: vi.fn(),
  },
}))

vi.mock('../../harness', () => ({
  agentHarness: {
    observability: {
      metrics: {
        observe: vi.fn(),
      },
    },
  },
}))

import { lintService } from '@intelligence/runtime/codeAnalysisService'
import { isPostEditVerifyTool, verifyEditedFile } from '../postEditVerify'
import { buildFailureReflection } from '../failureReflection'
import { buildCommandCostHint } from '../commandCostGuard'
import { recordToolQuality, getQualitySnapshot, resetQualitySnapshot } from '../qualityMetrics'

const setScene = (scene: 'dev' | 'work' | 'life' | 'study') => { mockScene = scene }

beforeEach(() => {
  setScene('dev')
  vi.clearAllMocks()
  resetQualitySnapshot()
})

describe('postEditVerify — 编辑后强制验证', () => {
  it('只有编辑 / 写入类工具触发验证', () => {
    expect(isPostEditVerifyTool('edit_file')).toBe(true)
    expect(isPostEditVerifyTool('write_file')).toBe(true)
    expect(isPostEditVerifyTool('create_file_or_folder')).toBe(true)
    expect(isPostEditVerifyTool('read_file')).toBe(false)
    expect(isPostEditVerifyTool('run_command')).toBe(false)
  })

  it('dev 场景下编辑代码文件，诊断结果附加到工具结果', async () => {
    vi.mocked(lintService.getLintErrors).mockResolvedValue({
      errors: [{ severity: 'error', message: 'Type error', startLine: 12 }],
    })
    const result = await verifyEditedFile('edit_file', { path: 'src/a.ts' }, '/ws')
    expect(result).toContain('[Verification]')
    expect(result).toContain('1 error')
    expect(result).toContain('Type error')
    expect(result).toContain('Line 12')
  })

  it('无诊断时返回 clean 提示', async () => {
    vi.mocked(lintService.getLintErrors).mockResolvedValue({ errors: [] })
    const result = await verifyEditedFile('write_file', { path: 'src/a.ts' }, '/ws')
    expect(result).toContain('no lint issues')
  })

  it('Markdown 等纯文档不参与验证', async () => {
    const result = await verifyEditedFile('edit_file', { path: 'docs/notes.md' }, '/ws')
    expect(result).toBeNull()
    expect(lintService.getLintErrors).not.toHaveBeenCalled()
  })

  it('非 dev 场景不触发验证', async () => {
    setScene('work')
    const result = await verifyEditedFile('edit_file', { path: 'src/a.ts' }, '/ws')
    expect(result).toBeNull()
    expect(lintService.getLintErrors).not.toHaveBeenCalled()
  })

  it('lint 抛错 / 超时 / LSP 未安装时透传原始结果（返回 null）', async () => {
    vi.mocked(lintService.getLintErrors).mockRejectedValue(new Error('boom'))
    expect(await verifyEditedFile('edit_file', { path: 'src/a.ts' }, '/ws')).toBeNull()

    vi.mocked(lintService.getLintErrors).mockResolvedValue({ errors: [], notInstalled: 'not installed' })
    expect(await verifyEditedFile('edit_file', { path: 'src/a.ts' }, '/ws')).toBeNull()
  })

  it('相对路径按工作空间解析', async () => {
    vi.mocked(lintService.getLintErrors).mockResolvedValue({ errors: [] })
    await verifyEditedFile('edit_file', { path: 'src/a.ts' }, '/ws')
    expect(lintService.getLintErrors).toHaveBeenCalledWith('/ws/src/a.ts')
  })
})

describe('failureReflection — 失败反思反馈', () => {
  it('edit_file old_string 未命中时提示重读文件或改行号模式', () => {
    const hint = buildFailureReflection('edit_file', 'old_string not found')
    expect(hint).toContain('Re-read the file')
    expect(hint).toContain('line mode')
  })

  it('run_command 权限错误提示不提权', () => {
    const hint = buildFailureReflection('run_command', 'EACCES: permission denied')
    expect(hint).toContain('permission')
    expect(hint?.length).toBeLessThanOrEqual(200)
  })

  it('search_files 无结果时提示换关键词或语义搜索', () => {
    const hint = buildFailureReflection('search_files', 'No results found')
    expect(hint).toContain('codebase_search')
  })

  it('非 dev 场景不生成反思', () => {
    setScene('life')
    expect(buildFailureReflection('edit_file', 'old_string not found')).toBeNull()
  })

  it('反思只作用于高频失败工具集', () => {
    expect(buildFailureReflection('read_file', 'anything')).toBeNull()
  })
})

describe('commandCostGuard — 高代价命令预检', () => {
  it('全盘扫描命中并给出降级建议', () => {
    const hint = buildCommandCostHint('run_command', { command: 'find / -name foo' })
    expect(hint).toContain('[Cost hint]')
    expect(hint).toContain('search_files')
  })

  it('全仓 tsc --noEmit（无增量）命中', () => {
    const hint = buildCommandCostHint('run_command', { command: 'npx tsc --noEmit' })
    expect(hint).toContain('--incremental')
  })

  it('带 --incremental 的类型检查不命中', () => {
    const hint = buildCommandCostHint('run_command', { command: 'npx tsc --noEmit --incremental' })
    expect(hint).toBeNull()
  })

  it('依赖安装命中并建议后台执行', () => {
    const hint = buildCommandCostHint('run_command', { command: 'npm install' })
    expect(hint).toContain('is_background')
  })

  it('普通命令不命中', () => {
    expect(buildCommandCostHint('run_command', { command: 'ls src' })).toBeNull()
    expect(buildCommandCostHint('read_file', { path: 'src/a.ts' })).toBeNull()
  })

  it('非 dev 场景不提示', () => {
    setScene('study')
    expect(buildCommandCostHint('run_command', { command: 'npm install' })).toBeNull()
  })
})

describe('qualityMetrics — 会话质量埋点', () => {
  it('记录调用 / 失败 / 验证计数', () => {
    recordToolQuality('edit_file', false, '[Verification] src/a.ts: no lint issues.')
    recordToolQuality('edit_file', false, '[Verification] src/b.ts: 1 error introduced.')
    recordToolQuality('run_command', true, null)

    const snap = getQualitySnapshot()
    expect(snap.invoked).toBe(3)
    expect(snap.failed).toBe(1)
    expect(snap.editVerified).toBe(2)
    expect(snap.verifyClean).toBe(1)
    expect(snap.verifyIssues).toBe(1)
  })

  it('非 dev 场景不采集', () => {
    setScene('work')
    recordToolQuality('run_command', true, null)
    expect(getQualitySnapshot().invoked).toBe(0)
  })

  it('重置后计数归零', () => {
    recordToolQuality('edit_file', false, null)
    resetQualitySnapshot()
    expect(getQualitySnapshot().invoked).toBe(0)
  })
})
