/**
 * 数据库脚本编辑器（DbScriptEditor）
 *
 * 专用编辑 db/*.sql 安装 / 卸载脚本，包装 FileEditorShell。
 * 预设两个内置 SQL 脚本：install / uninstall。
 *
 * SQL 脚本在场景安装 / 卸载时执行于场景数据库，应：
 * - 使用 CREATE TABLE IF NOT EXISTS 防止重复创建
 * - 使用 DROP TABLE IF EXISTS 防止卸载失败
 * - 索引命名规范：idx_表名_字段名
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import FileEditorShell from './FileEditorShell'

/** 数据库脚本预设列表 */
const PRESET_FILES = [
  'db/install.sql',
  'db/uninstall.sql',
]

const DbScriptEditor: React.FC = () => {
  const { t } = useI18n()
  return (
    <FileEditorShell
      title={t('builder.dbScriptEditor.title')}
      tip={t('builder.dbScriptEditor.tip')}
      presetFiles={PRESET_FILES}
      defaultFile={PRESET_FILES[0]}
      extension=".sql"
      filePathPlaceholder="db/install.sql"
      contentPlaceholder="-- 安装脚本：场景首次激活时执行\n\nCREATE TABLE IF NOT EXISTS items (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  created_at TEXT DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE INDEX IF NOT EXISTS idx_items_name ON items(name);\n"
      minHeight={400}
    />
  )
}

export default DbScriptEditor
