import { useState, useCallback, useMemo, memo } from 'react'
import type { PropertyPanelProps, TabId } from './types'
import { getAvailableTabs } from './types'
import { getNodeLabel, getNodeColor, getNodeIcon } from '../../shared/nodeTypes'
import { TAB_LABELS } from './shared'
import { NodeSvgIcon } from '../../Canvas/nodes/NodeSvgIcon'
import { Trash2, Settings2 } from 'lucide-react'
import TabSvgIcon from './TabIcon'
import { BasicTab } from './tabs/BasicTab'
import { RoleTab } from './tabs/RoleTab'
import { ToolsTab } from './tabs/ToolsTab'
import { IOTab } from './tabs/IOTab'
import { ErrorTab } from './tabs/ErrorTab'
import { AdvancedTab } from './tabs/AdvancedTab'

const tabComponents: Record<TabId, React.ComponentType<import('./types').TabProps>> = {
  basic: BasicTab,
  role: RoleTab,
  tools: ToolsTab,
  io: IOTab,
  error: ErrorTab,
  advanced: AdvancedTab,
}

const PropertyPanelInner = function PropertyPanel({
  node,
  onUpdateNodeData,
  onUpdateNodeName,
  onDeleteNode,
  language = 'zh',
}: PropertyPanelProps) {
  const availableTabs = useMemo(() => (node ? getAvailableTabs(node.type) : ['basic' as TabId]), [node])
  const [activeTab, setActiveTab] = useState<TabId>('basic')

  const handleDataChange = useCallback(
    (field: string, value: unknown) => {
      if (!node) return
      onUpdateNodeData(node.id, { [field]: value })
    },
    [node, onUpdateNodeData],
  )

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!node) return
      onUpdateNodeName(node.id, e.target.value)
    },
    [node, onUpdateNodeName],
  )

  if (!node) {
    return (
      <aside className="w-80 flex-shrink-0 border-l border-gray-200/80 bg-white flex flex-col items-center justify-center gap-4 select-none">
        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
          <Settings2 className="w-6 h-6 text-gray-350" />
        </div>
        <div className="text-center px-8">
          <p className="text-sm font-semibold text-gray-500 mb-1.5">
            {language === 'zh' ? '属性面板' : 'Properties'}
          </p>
          <p className="text-xs text-gray-400 leading-relaxed max-w-[200px]">
            {language === 'zh'
              ? '点击画布上的节点查看和编辑属性'
              : 'Click a node on the canvas to view and edit its properties'}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1.5 mt-2">
          <div className="flex gap-1">
            <span className="w-1 h-1 rounded-full bg-gray-300" />
            <span className="w-1 h-1 rounded-full bg-gray-200" />
            <span className="w-1 h-1 rounded-full bg-gray-200" />
          </div>
          <p className="text-[10px] text-gray-350 tracking-wide">
            {language === 'zh' ? '选择节点开始编辑' : 'Select a node to start'}
          </p>
        </div>
      </aside>
    )
  }

  const color = getNodeColor(node.type)
  const nodeLabel = getNodeLabel(node.type, language)
  const ActiveTabContent = tabComponents[activeTab]

  return (
    <aside className="w-80 flex-shrink-0 border-l border-gray-200/80 bg-white flex flex-col h-full overflow-hidden select-none">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 shadow-sm"
            style={{ backgroundColor: `${color}1a`, color }}
          >
            <NodeSvgIcon iconName={getNodeIcon(node.type)} size={14} />
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md"
            style={{ backgroundColor: `${color}14`, color }}
          >
            {nodeLabel}
          </span>
        </div>

        <input
          type="text"
          value={node.name}
          onChange={handleNameChange}
          className="w-full h-9 px-3 text-sm font-medium rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-white transition-all"
          placeholder={language === 'zh' ? '节点名称' : 'Node name'}
        />
      </div>

      {/* Tabs */}
      <div className="flex px-3 pt-1 gap-0.5 border-b border-gray-100 bg-gray-50/50 overflow-x-auto scrollbar-none">
        {availableTabs.map(tabId => {
          const tabInfo = TAB_LABELS[tabId]
          const isActive = activeTab === tabId
          const tabColors: Record<string, string> = {
            basic: '#3b82f6',
            role: '#8b5cf6',
            tools: '#14b8a6',
            io: '#f59e0b',
            error: '#ef4444',
            advanced: '#6b7280',
          }

          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={`flex items-center gap-1 px-1.5 py-2 text-[11px] font-medium rounded-t-lg transition-all relative flex-shrink-0 whitespace-nowrap ${
                isActive
                  ? 'text-gray-700 bg-white shadow-sm'
                  : 'text-gray-450 hover:text-gray-600 hover:bg-white/60'
              }`}
              title={language === 'zh' ? tabInfo.zh : tabInfo.en}
            >
              <TabSvgIcon tabId={tabId} />
              <span>{language === 'zh' ? tabInfo.zh : tabInfo.en}</span>
              {isActive && (
                <div
                  className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full"
                  style={{ backgroundColor: tabColors[tabId] || tabColors.basic }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {ActiveTabContent && (
          <ActiveTabContent nodeType={node.type} data={node.data} onChange={handleDataChange} language={language} />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/30">
        <button
          onClick={() => onDeleteNode(node.id)}
          className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-medium text-red-500 rounded-lg border border-red-200 bg-white hover:bg-red-50 hover:border-red-300 active:bg-red-100 transition-all"
        >
          <Trash2 className="w-3 h-3" />
          {language === 'zh' ? '删除节点' : 'Delete Node'}
        </button>
      </div>
    </aside>
  )
}

const PropertyPanel = memo(PropertyPanelInner)
export default PropertyPanel