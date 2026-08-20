/**
 * 生命周期脚本编辑器（ScriptEditor）
 *
 * 专用编辑 scripts/*.js 生命周期脚本，包装 FileEditorShell。
 * 预设三个内置生命周期脚本：onActivate / onDeactivate / onHealthCheck。
 *
 * 生命周期脚本在场景运行于 Node.js 沙箱中执行，可访问上下文 API。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import FileEditorShell from './FileEditorShell'

/** 生命周期脚本预设列表 */
const PRESET_FILES = [
  'scripts/onActivate.js',
  'scripts/onDeactivate.js',
  'scripts/onHealthCheck.js',
]

const ScriptEditor: React.FC = () => {
  const { t } = useI18n()
  return (
    <FileEditorShell
      title={t('builder.scriptEditor.title')}
      tip={t('builder.scriptEditor.tip')}
      presetFiles={PRESET_FILES}
      defaultFile={PRESET_FILES[0]}
      extension=".js"
      filePathPlaceholder="scripts/onActivate.js"
      contentPlaceholder="// 生命周期脚本：场景激活时执行\n\nmodule.exports = async (ctx) => {\n  // 初始化逻辑\n  ctx.logger.info(\'onActivate triggered\')\n}\n"
      minHeight={400}
    />
  )
}

export default ScriptEditor
