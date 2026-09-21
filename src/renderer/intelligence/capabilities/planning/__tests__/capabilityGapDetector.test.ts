/**
 * 能力缺口判定验收
 *
 * 验收目标：能识出无覆盖的意图，能压住已有覆盖的意图（防打扰），同一缺口不重复提示。
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  detectCapabilityGap,
  gapSignature,
  markGapSuggested,
  resetSuggestedGaps,
  shouldSuggestGap,
  type CapabilityProbe,
} from '../capabilityGapDetector'

/** 一组与「pdf 水印」无关的通用工具，用于构造无覆盖场景 */
const GENERIC_TOOLS = ['read_file', 'write_file', 'search_files', 'list_directory', 'web_search']

function probe(overrides: Partial<CapabilityProbe> = {}): CapabilityProbe {
  return {
    intent: '',
    skills: [],
    availableTools: GENERIC_TOOLS,
    ...overrides,
  }
}

describe('detectCapabilityGap', () => {
  it('现有工具与技能都不覆盖时产出缺口', () => {
    const gap = detectCapabilityGap(
      probe({ intent: '帮我给一批 pdf 文件批量加水印，输出到新目录' }),
    )

    expect(gap).not.toBeNull()
    expect(gap!.keywords.length).toBeGreaterThanOrEqual(2)
    expect(gap!.confidence).toBeGreaterThan(0)
    expect(gap!.reason).toContain('覆盖')
  })

  it('已有技能覆盖时不产出缺口', () => {
    const gap = detectCapabilityGap(
      probe({
        intent: '帮我给一批 pdf 文件批量加水印，输出到新目录',
        skills: [
          {
            name: 'pdf-watermark-kit',
            description: '批量给 pdf 文件加水印并导出到新目录',
            keywords: ['pdf', '水印', '批量'],
          },
        ],
      }),
    )

    expect(gap).toBeNull()
  })

  it('现有工具覆盖时不产出缺口', () => {
    const gap = detectCapabilityGap(
      probe({
        intent: '帮我 search files 里的 read file 内容',
        availableTools: ['search_files', 'read_file'],
      }),
    )

    expect(gap).toBeNull()
  })

  it('意图太短时不产出缺口', () => {
    expect(detectCapabilityGap(probe({ intent: '嗯' }))).toBeNull()
    expect(detectCapabilityGap(probe({ intent: 'pdf' }))).toBeNull()
    expect(detectCapabilityGap(probe({ intent: '' }))).toBeNull()
  })

  it('缺口理由包含最接近的工具及其覆盖比例', () => {
    const gap = detectCapabilityGap(
      probe({ intent: '把会议录音批量转成字幕文件并校对时间轴' }),
    )

    expect(gap).not.toBeNull()
    expect(gap!.reason).toMatch(/最接近的工具|没有与该意图相关/)
  })

  it('无可用工具时也能判定缺口', () => {
    const gap = detectCapabilityGap(
      probe({ intent: '把会议录音批量转成字幕文件并校对时间轴', availableTools: [] }),
    )

    expect(gap).not.toBeNull()
    expect(gap!.reason).toContain('没有与该意图相关')
  })
})

describe('缺口提示去重', () => {
  beforeEach(() => {
    resetSuggestedGaps()
  })

  it('首次允许提示，冷却期内不再提示', () => {
    const gap = detectCapabilityGap(
      probe({ intent: '把会议录音批量转成字幕文件并校对时间轴' }),
    )!

    const now = 1_700_000_000_000
    expect(shouldSuggestGap(gap, now)).toBe(true)

    markGapSuggested(gap, now)
    expect(shouldSuggestGap(gap, now + 60_000)).toBe(false)
    expect(shouldSuggestGap(gap, now + 31 * 60_000)).toBe(true)
  })

  it('用字相同但语序不同视为同一缺口', () => {
    const a = detectCapabilityGap(probe({ intent: '批量把录音转成字幕并校对时间轴' }))!
    const b = detectCapabilityGap(probe({ intent: '校对时间轴，把录音批量转成字幕并' }))!

    expect(gapSignature(a)).toBe(gapSignature(b))
  })

  it('内容不同的意图得到不同签名', () => {
    const a = detectCapabilityGap(probe({ intent: '批量把录音转成字幕并校对时间轴' }))!
    const b = detectCapabilityGap(probe({ intent: '给扫描件做版面还原和表格抽取' }))!

    expect(gapSignature(a)).not.toBe(gapSignature(b))
  })
})
