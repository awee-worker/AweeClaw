/**
 * 视觉设置面板（左侧菜单「视觉设置」的容器）
 *
 * 整合：
 * 1. 视觉模型配置（VisionModelPanel）：Provider / Model / API Key / Base URL
 * 2. 后续可扩展：视觉行为偏好（截图分辨率、识别精度等）
 */

import { VisionModelPanel } from './VisionModelPanel'
import type { Language } from '@renderer/i18n'

interface VisionSettingsPanelProps {
  language: Language
}

export default function VisionSettingsPanel({ language }: VisionSettingsPanelProps) {
  return (
    <div className="space-y-6">
      {/* 视觉模型配置 */}
      <VisionModelPanel language={language} />
    </div>
  )
}
