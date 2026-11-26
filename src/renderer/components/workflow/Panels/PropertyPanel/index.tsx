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
import { t, type Language } from '@renderer/i18n'

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
      <aside className="w-80 flex-shrink-0 border-l border-border/80 bg-background-secondary flex flex-col items-center justify-center gap-4 select-none">
        <div className="w-14 h-14 rounded-2xl bg-surface-hover flex items-center justify-center">
          <Settings2 className="w-6 h-6 text-text-muted" />
        </div>
        <div className="text-center px-8">
          <p className="text-sm font-semibold text-text-secondary mb-1.5">
            {t('wf.properties', language as Language)}
          </p>
          <p className="text-xs text-text-muted leading-relaxed max-w-[200px]">
            {t('wf.clickanodeonthe', language as Language)}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1.5 mt-2">
          <div className="flex gap-1">
            <span className="w-1 h-1 rounded-full bg-surface-muted" />
            <span className="w-1 h-1 rounded-full bg-surface-active" />
            <span className="w-1 h-1 rounded-full bg-surface-active" />
          </div>
          <p className="text-[10px] text-text-muted tracking-wide">
            {t('wf.selectanodetostart', language as Language)}
          </p>
        </div>
      </aside>
    )
  }

  const color = getNodeColor(node.type)
  const nodeLabel = getNodeLabel(node.type, language)
  const ActiveTabContent = tabComponents[activeTab]

  return (
    <aside className="w-80 flex-shrink-0 border-l border-border/80 bg-background-secondary flex flex-col h-full overflow-hidden select-none">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2.5 border-b border-border-subtle">
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
          className="w-full h-9 px-3 text-sm font-medium rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-background-secondary transition-all"
          placeholder={t('wf.nodename', language as Language)}
        />
      </div>

      {/* Tabs */}
      <div className="flex px-3 pt-1 gap-0.5 border-b border-border-subtle bg-surface/50 overflow-x-auto scrollbar-none">
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
                  ? 'text-text-primary bg-background-secondary shadow-sm'
                  : 'text-text-secondary hover:text-text-secondary hover:bg-background-secondary/60'
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
      <div className="px-4 py-3 border-t border-border-subtle bg-surface/30">
        <button
          onClick={() => onDeleteNode(node.id)}
          className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-medium text-red-500 rounded-lg border border-red-500/30 bg-background-secondary hover:bg-red-500/10 hover:border-red-300 active:bg-red-500/15 transition-all"
        >
          <Trash2 className="w-3 h-3" />
          {t('wf.deletenode', language as Language)}
        </button>
      </div>
    </aside>
  )
}

const PropertyPanel = memo(PropertyPanelInner)
export default PropertyPanel