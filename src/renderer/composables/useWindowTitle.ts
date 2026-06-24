/**
 * 窗口标题管理 Hook
 *
 * 根据当前激活文件与工作区动态更新窗口标题。
 * 格式: [文件名][修改标记] - [工作区名] - [应用名]
 */

import { useEffect } from 'react'
import { useStore } from '@store'
import { getFileName } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'
import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 标题分隔符 */
const TITLE_SEPARATOR = ' - '

/** 已修改标记 */
const DIRTY_MARKER = ' ●'

/** 场景标识映射 */
const SCENARIO_TITLE_TAGS: Record<ScenarioDomain, string> = {
  legal: '[Legal]',
  medical: '[Medical]',
  education: '[Edu]',
  general: '',
}

/** 场景窗口标题策略 */
export interface ScenarioWindowTitlePolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 标题前缀标签 */
  titleTag: string
  /** 是否显示场景标签 */
  showScenarioTag: boolean
  /** 是否显示合规模式标记 */
  showComplianceMarker: boolean
  /** 合规模式标记 */
  complianceMarker: string
}

/** 场景窗口标题策略预设 */
const SCENARIO_WINDOW_TITLE_POLICIES: Record<ScenarioDomain, ScenarioWindowTitlePolicy> = {
  legal: {
    domain: 'legal',
    titleTag: SCENARIO_TITLE_TAGS.legal,
    showScenarioTag: true,
    showComplianceMarker: true,
    complianceMarker: ' [Compliance]',
  },
  medical: {
    domain: 'medical',
    titleTag: SCENARIO_TITLE_TAGS.medical,
    showScenarioTag: true,
    showComplianceMarker: true,
    complianceMarker: ' [HIPAA]',
  },
  education: {
    domain: 'education',
    titleTag: SCENARIO_TITLE_TAGS.education,
    showScenarioTag: true,
    showComplianceMarker: false,
    complianceMarker: '',
  },
  general: {
    domain: 'general',
    titleTag: SCENARIO_TITLE_TAGS.general,
    showScenarioTag: false,
    showComplianceMarker: false,
    complianceMarker: '',
  },
}

export function useWindowTitle(): void {
  const activeFilePath = useStore((state) => state.activeFilePath)
  const openFiles = useStore((state) => state.openFiles)
  const workspace = useStore((state) => state.workspace)
  const scenarioPreferences = useStore((state) => state.scenarioPreferences)

  useEffect(() => {
    const parts: string[] = []
    const domain = scenarioPreferences?.activeDomain ?? 'general'
    const policy = SCENARIO_WINDOW_TITLE_POLICIES[domain]

    // 场景标签（前缀）
    if (policy.showScenarioTag && policy.titleTag) {
      parts.push(policy.titleTag)
    }

    // 活动文件
    if (activeFilePath) {
      const activeFile = openFiles.find((f) => f.path === activeFilePath)
      const dirtySuffix = activeFile?.isDirty ? DIRTY_MARKER : ''
      parts.push(`${getFileName(activeFilePath)}${dirtySuffix}`)
    }

    // 工作区
    if (workspace?.roots?.length) {
      parts.push(getFileName(workspace.roots[0]))
    }

    // 合规模式标记
    if (policy.showComplianceMarker && scenarioPreferences?.complianceModeEnabled) {
      parts.push(policy.complianceMarker.trim())
    }

    // 应用名
    parts.push(BRAND.name)

    document.title = parts.join(TITLE_SEPARATOR)
  }, [activeFilePath, openFiles, workspace, scenarioPreferences])
}

/**
 * 获取场景窗口标题策略
 */
export function getScenarioWindowTitlePolicy(
  domain: ScenarioDomain,
): ScenarioWindowTitlePolicy {
  return SCENARIO_WINDOW_TITLE_POLICIES[domain]
}
