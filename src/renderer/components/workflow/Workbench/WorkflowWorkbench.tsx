import { useState, useCallback, useEffect, useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { GitBranch, HelpCircle, X } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import type { WorkflowDefinition } from '@shared/protocols/workflow'
import FlowCanvas from '../Canvas/FlowCanvas'
import NodePalette from '../Panels/NodePalette'
import WorkflowList from '../Panels/WorkflowList'
import WorkflowToolbar from './WorkflowToolbar'
import DebugPanel, { DebugPanelToggle } from './DebugPanel'
import VersionPanel from './VersionPanel'
import MonitorDashboard from './MonitorDashboard'
import SharePanel from './SharePanel'
import TemplateMarket from '../TemplateMarket'
import WorkflowTour, { isTourCompleted } from '../WorkflowTour'
import HelpPanel from '../HelpPanel'
import { useWorkflowEditor } from './useWorkflowEditor'

interface WorkflowWorkbenchInnerProps {
  onClose: () => void
  initialWorkflow?: WorkflowDefinition | WorkflowDefinitionV2 | null
  language?: 'en' | 'zh'
}

function WorkflowWorkbenchInner({ onClose, initialWorkflow, language = 'zh' }: WorkflowWorkbenchInnerProps) {
  const [view, setView] = useState<'list' | 'editor' | 'market'>(() =>
    initialWorkflow ? 'editor' : 'list',
  )
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [showVersionPanel, setShowVersionPanel] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const [showSharePanel, setShowSharePanel] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const isMac = useMemo(() => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0, [])

  useEffect(() => {
    if (view === 'editor' && !isTourCompleted()) {
      const timer = setTimeout(() => setShowTour(true), 500)
      return () => clearTimeout(timer)
    }
  }, [view])

  const editor = useWorkflowEditor(initialWorkflow)

  useEffect(() => {
    if (view !== 'editor') return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const mod = isMac ? e.metaKey : e.ctrlKey

      if (mod && e.key === 's') {
        e.preventDefault()
        editor.handleSave()
        return
      }

      if (mod && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        editor.handleUndo()
        return
      }

      if (mod && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        editor.handleRedo()
        return
      }

      if (mod && e.key === 'd') {
        e.preventDefault()
        if (editor.selectedNodeId) {
          editor.handleDuplicateNode(editor.selectedNodeId)
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selectedNodeId) {
          e.preventDefault()
          editor.handleDeleteNode(editor.selectedNodeId)
        }
        return
      }

      if (e.key === 'g' && !mod) {
        e.preventDefault()
        editor.handleAutoLayout()
        return
      }

      if (e.key === '?' && !mod) {
        e.preventDefault()
        setShowHelp((prev) => !prev)
        return
      }

      if (e.key === 'Escape' && !mod && !e.shiftKey) {
        if (showHelp) {
          setShowHelp(false)
          return
        }
        if (showTour) {
          setShowTour(false)
          return
        }
        if (showDebugPanel) {
          setShowDebugPanel(false)
          return
        }
        if (showVersionPanel) {
          setShowVersionPanel(false)
          return
        }
        if (showDashboard) {
          setShowDashboard(false)
          return
        }
        if (showSharePanel) {
          setShowSharePanel(false)
          return
        }
        onClose()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [view, editor, setShowHelp, showHelp, showTour, showDebugPanel, showVersionPanel, showDashboard, showSharePanel, onClose])

  const handleBackToList = useCallback(() => {
    setView('list')
    editor.setWorkflow(null)
    editor.setSelectedNodeId(null)
    editor.setIsModified(false)
  }, [editor])

  const handleSelectWorkflow = useCallback((wf: WorkflowDefinitionV2) => {
    editor.handleSelectWorkflow(wf)
    setView('editor')
  }, [editor])

  const handleCreateNew = useCallback(() => {
    editor.handleCreateNew()
    setView('editor')
  }, [editor])

  const handleUseTemplate = useCallback(
    (_template: unknown) => {
      editor.handleCreateNew()
      setView('editor')
    },
    [editor],
  )

  const handleBack = useCallback(() => {
    if (view === 'editor' || view === 'market') {
      handleBackToList()
    } else {
      onClose()
    }
  }, [view, handleBackToList, onClose])

  const headerTitle = useMemo(() => {
    if (view === 'list') return language === 'zh' ? '工作流' : 'Workflows'
    if (view === 'market') return language === 'zh' ? '模板市场' : 'Template Market'
    return editor.workflow?.name || (language === 'zh' ? '未命名工作流' : 'Untitled workflow')
  }, [view, language, editor.workflow?.name])

  return (
    <div className="relative flex flex-col h-full w-full bg-[var(--background)]">

      <div
        className={`flex items-center justify-between h-11 px-3 bg-white dark:bg-gray-850 flex-shrink-0 select-none app-drag-region ${isMac ? 'pl-[70px]' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0 app-no-drag">
          {view !== 'list' && (
            <button
              onClick={handleBack}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
              title={language === 'zh' ? '返回列表' : 'Back to list'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15,18 9,12 15,6" />
              </svg>
            </button>
          )}
          {view !== 'list' && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
              {headerTitle}
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors app-no-drag"
          title={language === 'zh' ? '关闭工作流' : 'Close workflow'}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {view === 'list' ? (
        <WorkflowList
          onSelect={handleSelectWorkflow}
          onCreateNew={handleCreateNew}
          onOpenMarket={() => setView('market')}
          language={language}
        />
      ) : view === 'market' ? (
        <TemplateMarket
          onUseTemplate={handleUseTemplate}
          language={language}
        />
      ) : (
        <>
          <div className="workflow-toolbar">
            <WorkflowToolbar
              workflow={editor.workflow}
              onSave={editor.handleSave}
              onRun={() => setShowDebugPanel(true)}
              onMonitor={() => setShowDashboard(true)}
              onShare={() => setShowSharePanel(true)}
              onAutoLayout={editor.handleAutoLayout}
              onNew={handleCreateNew}
              onUndo={editor.handleUndo}
              onRedo={editor.handleRedo}
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              isModified={editor.isModified}
              language={language}
            />
            <button
              onClick={() => setShowTour(true)}
              className="ml-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500 transition-colors"
              title={language === 'zh' ? '新手引导' : 'Guide'}
            >
              <HelpCircle size={16} />
            </button>
          </div>

          <div className="flex-1 flex min-h-0 overflow-hidden">
            <div className="node-palette">
              <NodePalette onAddNode={editor.handleAddNode} language={language} />
            </div>

            <div className="flow-canvas flex-1">
              <FlowCanvas
                key={editor.workflow?.id || 'empty'}
                nodes={editor.rfNodes}
                edges={editor.rfEdges}
                onNodesChange={editor.handleNodesChange}
                onEdgesChange={editor.handleEdgesChange}
                onConnect={editor.handleConnect}
                onNodeSelect={editor.handleNodeSelect}
                onNodeDataUpdate={editor.handleUpdateNodeData}
                onAddNode={editor.handleAddNode}
                onDeleteNode={editor.handleDeleteNode}
                onDuplicateNode={editor.handleDuplicateNode}
                onDeleteEdge={editor.handleDeleteEdge}
              />
            </div>
          </div>

          <DebugPanel
            workflow={editor.workflow!}
            visible={showDebugPanel}
            onClose={() => setShowDebugPanel(false)}
            onNodeClick={editor.handleNodeSelect}
            language={language}
          />

          <VersionPanel
            workflowId={editor.workflow?.id || ''}
            visible={showVersionPanel}
            onClose={() => setShowVersionPanel(false)}
            onRestored={() => {
              setShowVersionPanel(false)
            }}
            language={language}
          />

          {!showDebugPanel && !showVersionPanel && (
            <div className="absolute bottom-4 right-4 z-10 flex gap-2">
              <button
                onClick={() => setShowVersionPanel(true)}
                className="p-2 rounded-lg bg-[var(--background)] border border-[var(--border)] shadow-lg hover:bg-[var(--border)]/50 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                title={language === 'zh' ? '版本管理' : 'Version History'}
              >
                <GitBranch className="w-4 h-4" />
              </button>
              <DebugPanelToggle onClick={() => setShowDebugPanel(true)} language={language} />
            </div>
          )}

          {!showDebugPanel && showVersionPanel && (
            <DebugPanelToggle onClick={() => setShowDebugPanel(true)} language={language} />
          )}

          {showDebugPanel && !showVersionPanel && (
            <button
              onClick={() => setShowVersionPanel(true)}
              className="absolute bottom-4 right-4 z-10 p-2 rounded-lg bg-[var(--background)] border border-[var(--border)] shadow-lg hover:bg-[var(--border)]/50 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
              title={language === 'zh' ? '版本管理' : 'Version History'}
            >
              <GitBranch className="w-4 h-4" />
            </button>
          )}

          <MonitorDashboard
            visible={showDashboard}
            onClose={() => setShowDashboard(false)}
            language={language}
          />

          <SharePanel
            workflowId={editor.workflow?.id || ''}
            visible={showSharePanel}
            onClose={() => setShowSharePanel(false)}
            language={language}
          />

          <WorkflowTour
            visible={showTour}
            onClose={() => setShowTour(false)}
            language={language}
          />

          <HelpPanel
            visible={showHelp}
            onClose={() => setShowHelp(false)}
            language={language}
          />
        </>
      )}
    </div>
  )
}

interface WorkflowWorkbenchProps {
  onClose: () => void
  initialWorkflow?: WorkflowDefinition | WorkflowDefinitionV2 | null
  language?: 'en' | 'zh'
}

export default function WorkflowWorkbench({ onClose, initialWorkflow, language = 'zh' }: WorkflowWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <WorkflowWorkbenchInner onClose={onClose} initialWorkflow={initialWorkflow} language={language} />
    </ReactFlowProvider>
  )
}
