import {
  Undo2,
  Redo2,
  Save,
  Play,
  LayoutGrid,
  FilePlus2,
  BarChart3,
  Users,
} from 'lucide-react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'

interface WorkflowToolbarProps {
  workflow: WorkflowDefinitionV2 | null
  onSave: () => void
  onRun: () => void
  onMonitor?: () => void
  onShare?: () => void
  onAutoLayout: () => void
  onNew: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  isModified: boolean
  language?: 'en' | 'zh'
}

export default function WorkflowToolbar({
  workflow,
  onSave,
  onRun,
  onMonitor,
  onShare,
  onAutoLayout,
  onNew,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  isModified,
  language = 'zh',
}: WorkflowToolbarProps) {
  return (
    <header className="h-10 bg-gray-50/80 dark:bg-gray-850/50 border-b border-gray-100 dark:border-gray-700/30 flex items-center px-3 gap-1.5 flex-shrink-0 select-none">

      {/* Title */}
      {workflow ? (
        <div className="flex items-center gap-2 min-w-0 flex-1 ml-1">
          <span className="text-sm font-semibold text-gray-800 truncate">
            {language === 'zh' ? workflow.nameZh : workflow.name}
          </span>
          <span className="text-[10px] text-gray-400 flex-shrink-0 tabular-nums">
            {workflow.nodes.length}N / {workflow.edges.length}E
          </span>
          {isModified && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {language === 'zh' ? '未保存' : 'Unsaved'}
            </span>
          )}
        </div>
      ) : (
        <span className="text-sm font-medium text-gray-400 flex-1 ml-1">
          {language === 'zh' ? '新建工作流' : 'New Workflow'}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 ml-auto">
        {onUndo && onRedo && (
          <>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1.5 rounded-lg text-gray-450 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              title={`${language === 'zh' ? '撤销' : 'Undo'} (Ctrl+Z)`}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1.5 rounded-lg text-gray-450 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              title={`${language === 'zh' ? '重做' : 'Redo'} (Ctrl+Shift+Z)`}
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-gray-200 mx-1" />
          </>
        )}

        <button
          onClick={onNew}
          className="flex items-center gap-1 h-7 px-2 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          title={language === 'zh' ? '新建工作流' : 'New Workflow'}
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {language === 'zh' ? '新建' : 'New'}
          </span>
        </button>

        <button
          onClick={onAutoLayout}
          className="flex items-center gap-1 h-7 px-2 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          title={language === 'zh' ? '自动布局' : 'Auto Layout'}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {language === 'zh' ? '布局' : 'Layout'}
          </span>
        </button>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <button
          onClick={onSave}
          disabled={!isModified}
          className="flex items-center gap-1 h-7 px-3 text-xs font-semibold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200/50"
          title={language === 'zh' ? '保存 (Ctrl+S)' : 'Save (Ctrl+S)'}
        >
          <Save className="w-3 h-3" />
          {language === 'zh' ? '保存' : 'Save'}
        </button>

        <button
          onClick={onRun}
          className="flex items-center gap-1 h-7 px-3 text-xs font-semibold rounded-lg transition-all bg-green-500 text-white hover:bg-green-600 shadow-sm shadow-green-500/15 active:scale-[0.97]"
          title={language === 'zh' ? '运行工作流' : 'Run Workflow'}
        >
          <Play className="w-3 h-3 fill-current" />
          <span className="hidden sm:inline">
            {language === 'zh' ? '运行' : 'Run'}
          </span>
        </button>

        {onMonitor && (
          <button
            onClick={onMonitor}
            className="flex items-center gap-1 h-7 px-2 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            title={language === 'zh' ? '运行监控' : 'Run Monitor'}
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
        )}

        {onShare && (
          <button
            onClick={onShare}
            className="flex items-center gap-1 h-7 px-2 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            title={language === 'zh' ? '共享管理' : 'Share'}
          >
            <Users className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  )
}