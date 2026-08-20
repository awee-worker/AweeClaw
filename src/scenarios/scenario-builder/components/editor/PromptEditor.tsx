/**
 * 提示词编辑器（PromptEditor）
 *
 * 专用编辑 prompts/*.md 提示词文件，包装 FileEditorShell。
 * 预设四个内置提示词文件：system / security / conventions / workflow。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import FileEditorShell from './FileEditorShell'

/** 提示词文件预设列表 */
const PRESET_FILES = [
  'prompts/system.md',
  'prompts/security.md',
  'prompts/conventions.md',
  'prompts/workflow.md',
]

const PromptEditor: React.FC = () => {
  const { t } = useI18n()
  return (
    <FileEditorShell
      title={t('builder.promptEditor.title')}
      tip={t('builder.promptEditor.tip')}
      presetFiles={PRESET_FILES}
      defaultFile={PRESET_FILES[0]}
      extension=".md"
      filePathPlaceholder="prompts/system.md"
      contentPlaceholder="# 系统提示词\n\n你是一个..."
      minHeight={400}
    />
  )
}

export default PromptEditor
