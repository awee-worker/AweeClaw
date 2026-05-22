import { useState, useMemo } from 'react'
import { X, Search, Keyboard } from 'lucide-react'
import { NODE_TYPE_LABELS } from '@shared/protocols/workflowV2'
import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'

interface ShortcutEntry {
  key: string
  macKey: string
  descEn: string
  descZh: string
  category: 'general' | 'canvas' | 'nodes'
}

const SHORTCUTS: ShortcutEntry[] = [
  { key: 'Ctrl+S', macKey: '⌘S', descEn: 'Save workflow', descZh: '保存工作流', category: 'general' },
  { key: 'Ctrl+Z', macKey: '⌘Z', descEn: 'Undo', descZh: '撤销', category: 'general' },
  { key: 'Ctrl+Shift+Z', macKey: '⌘⇧Z', descEn: 'Redo', descZh: '重做', category: 'general' },
  { key: 'Delete', macKey: '⌫', descEn: 'Delete selected node', descZh: '删除选中的节点', category: 'nodes' },
  { key: 'Ctrl+D', macKey: '⌘D', descEn: 'Duplicate selected node', descZh: '复制选中的节点', category: 'nodes' },
  { key: 'G', macKey: 'G', descEn: 'Auto layout', descZh: '自动布局', category: 'canvas' },
  { key: 'Scroll', macKey: 'Scroll', descEn: 'Zoom in/out', descZh: '缩放画布', category: 'canvas' },
  { key: 'Middle-drag', macKey: 'Middle-drag', descEn: 'Pan canvas', descZh: '平移画布', category: 'canvas' },
  { key: 'Click', macKey: 'Click', descEn: 'Select node', descZh: '选中节点', category: 'nodes' },
  { key: 'Shift+Click', macKey: '⇧+Click', descEn: 'Multi-select nodes', descZh: '多选节点', category: 'nodes' },
  { key: '?', macKey: '?', descEn: 'Toggle this help', descZh: '切换帮助面板', category: 'general' },
]

const NODE_CATEGORIES: { key: string; labelEn: string; labelZh: string; types: WorkflowNodeTypeV2[] }[] = [
  { key: 'trigger', labelEn: 'Triggers', labelZh: '触发器', types: ['start', 'webhook_trigger'] },
  { key: 'ai', labelEn: 'AI', labelZh: '人工智能', types: ['agent_task', 'agent_group', 'knowledge_query'] },
  { key: 'logic', labelEn: 'Logic', labelZh: '逻辑控制', types: ['condition', 'switch_case', 'loop', 'parallel', 'merge'] },
  { key: 'tool', labelEn: 'Tools', labelZh: '工具', types: ['tool_call', 'mcp_service', 'code_runner', 'http_request'] },
  { key: 'data', labelEn: 'Data', labelZh: '数据处理', types: ['variable_set', 'data_transform'] },
  { key: 'io', labelEn: 'I/O', labelZh: '输入输出', types: ['user_input', 'user_approval', 'form_collector', 'text_output', 'file_output', 'notification'] },
  { key: 'flow', labelEn: 'Flow', labelZh: '流程控制', types: ['sub_workflow', 'delay', 'event_wait'] },
]

interface HelpPanelProps {
  visible: boolean
  onClose: () => void
  language: 'en' | 'zh'
}

export default function HelpPanel({ visible, onClose, language }: HelpPanelProps) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'shortcuts' | 'nodes'>('shortcuts')
  const isMac = useMemo(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0, [])

  if (!visible) return null

  const filteredNodes = search
    ? (Object.keys(NODE_TYPE_LABELS) as WorkflowNodeTypeV2[]).filter((type) => {
        const info = NODE_TYPE_LABELS[type]
        return (
          info.en.toLowerCase().includes(search.toLowerCase()) ||
          info.zh.includes(search) ||
          info.descEn.toLowerCase().includes(search.toLowerCase()) ||
          info.descZh.includes(search)
        )
      })
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/30" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Keyboard size={18} className="text-blue-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              {language === 'zh' ? '帮助与快捷键' : 'Help & Shortcuts'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 py-2 border-b border-gray-100 dark:border-gray-750">
          <button
            onClick={() => setTab('shortcuts')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === 'shortcuts'
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {language === 'zh' ? '快捷键' : 'Shortcuts'}
          </button>
          <button
            onClick={() => setTab('nodes')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === 'nodes'
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {language === 'zh' ? '节点参考' : 'Node Reference'}
          </button>
        </div>

        {tab === 'nodes' && (
          <div className="px-5 py-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={language === 'zh' ? '搜索节点...' : 'Search nodes...'}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {tab === 'shortcuts' && (
            <div className="space-y-4">
              {(['general', 'canvas', 'nodes'] as const).map((category) => (
                <div key={category}>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                    {category === 'general' ? (language === 'zh' ? '通用' : 'General') : ''}
                    {category === 'canvas' ? (language === 'zh' ? '画布' : 'Canvas') : ''}
                    {category === 'nodes' ? (language === 'zh' ? '节点操作' : 'Node Operations') : ''}
                  </h3>
                  <div className="space-y-1">
                    {SHORTCUTS.filter((s) => s.category === category).map((s) => (
                      <div
                        key={s.key}
                        className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {language === 'zh' ? s.descZh : s.descEn}
                        </span>
                        <kbd className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                          {isMac ? s.macKey : s.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'nodes' && (
            <div className="space-y-5">
              {(filteredNodes
                ? [{ key: 'search', labelEn: language === 'zh' ? '搜索结果' : 'Search Results', labelZh: '搜索结果', types: filteredNodes }]
                : NODE_CATEGORIES
              ).map((category) => (
                <div key={category.key}>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                    {language === 'zh' ? category.labelZh : category.labelEn}
                  </h3>
                  <div className="space-y-1">
                    {category.types.map((type) => {
                      const info = NODE_TYPE_LABELS[type]
                      return (
                        <div
                          key={type}
                          className="flex items-start gap-3 py-2 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <div className="flex-shrink-0 w-16 pt-0.5">
                            <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                              {language === 'zh' ? info.zh : info.en}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                              {language === 'zh' ? info.descZh : info.descEn}
                            </p>
                          </div>
                          <code className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">
                            {type}
                          </code>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-2 border-t border-gray-100 dark:border-gray-750 text-center">
          <p className="text-[10px] text-gray-400">
            {language === 'zh' ? '按 ? 键打开此面板' : 'Press ? to toggle this panel'}
          </p>
        </div>
      </div>
    </div>
  )
}