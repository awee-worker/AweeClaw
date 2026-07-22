/**
 * 因果图视图
 *
 * 提供因果图的节点与边管理：
 * - 节点列表（按类型/来源筛选、关键字搜索）
 * - 节点新增/编辑/删除（含环检测预判）
 * - 边列表（按关系/来源筛选）
 * - 边新增（通过下拉选择源/目标节点，含环检测）
 * - 边编辑/删除
 *
 * 数据来源：window.electronAPI.causal.{listNodes,createNode,updateNode,deleteNode,
 *          listEdges,createEdge,updateEdge,deleteEdge}
 *
 * @module settings/tabs/causal/CausalGraphView
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Network,
  Plus,
  Trash2,
  Edit2,
  X,
  Search,
  AlertCircle,
  Check,
  ChevronRight,
} from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  CausalNode,
  CausalEdge,
  CausalNodeType,
  CausalNodeSource,
  CausalEdgeRelation,
  CausalEdgeSource,
} from '@main/preload/api/causalReasoning'

interface CausalGraphViewProps {
  language: Language
}

/** 节点类型标签 */
const NODE_TYPE_LABELS: Record<CausalNodeType, { zh: string; en: string }> = {
  event: { zh: '事件', en: 'Event' },
  action: { zh: '动作', en: 'Action' },
  state: { zh: '状态', en: 'State' },
  metric: { zh: '指标', en: 'Metric' },
}

/** 节点来源标签 */
const NODE_SOURCE_LABELS: Record<CausalNodeSource, { zh: string; en: string }> = {
  llm: { zh: 'LLM', en: 'LLM' },
  rule: { zh: '规则', en: 'Rule' },
  manual: { zh: '手动', en: 'Manual' },
  system: { zh: '系统', en: 'System' },
}

/** 边关系标签 */
const EDGE_RELATION_LABELS: Record<CausalEdgeRelation, { zh: string; en: string; color: string }> = {
  causes: { zh: '导致', en: 'Causes', color: 'text-red-500' },
  enables: { zh: '促进', en: 'Enables', color: 'text-emerald-500' },
  prevents: { zh: '阻止', en: 'Prevents', color: 'text-amber-500' },
  inhibits: { zh: '抑制', en: 'Inhibits', color: 'text-violet-500' },
}

/** 边来源标签 */
const EDGE_SOURCE_LABELS: Record<CausalEdgeSource, { zh: string; en: string }> = {
  llm: { zh: 'LLM', en: 'LLM' },
  rule: { zh: '规则', en: 'Rule' },
  manual: { zh: '手动', en: 'Manual' },
  statistical: { zh: '统计', en: 'Statistical' },
}

/** Tab 切换：节点 / 边 */
type GraphTab = 'nodes' | 'edges'

export function CausalGraphView({ language }: CausalGraphViewProps) {
  const isZh = language === 'zh'
  const [activeTab, setActiveTab] = useState<GraphTab>('nodes')

  return (
    <div className="flex flex-col h-full">
      {/* 子 Tab */}
      <div className="flex items-center gap-1 p-2 border-b border-border/40 bg-surface/30">
        <TabButton
          active={activeTab === 'nodes'}
          onClick={() => setActiveTab('nodes')}
          label={isZh ? '节点' : 'Nodes'}
        />
        <TabButton
          active={activeTab === 'edges'}
          onClick={() => setActiveTab('edges')}
          label={isZh ? '边' : 'Edges'}
        />
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'nodes' ? (
          <NodesView language={language} />
        ) : (
          <EdgesView language={language} />
        )}
      </div>
    </div>
  )
}

/** Tab 按钮 */
function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
        active
          ? 'bg-accent text-white shadow-sm'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  )
}

// ============================================================
// 节点视图
// ============================================================

function NodesView({ language }: { language: Language }) {
  const isZh = language === 'zh'
  const [nodes, setNodes] = useState<CausalNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<CausalNodeType | ''>('')
  const [keyword, setKeyword] = useState('')
  const [editingNode, setEditingNode] = useState<CausalNode | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  /** 加载节点列表 */
  const loadNodes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.causal.listNodes({
        type: filterType || undefined,
        keyword: keyword || undefined,
      })
      if (result.success && result.data) {
        setNodes(result.data as CausalNode[])
      } else {
        setError(result.error || (isZh ? '加载失败' : 'Load failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to load nodes:', e)
    } finally {
      setLoading(false)
    }
  }, [filterType, keyword, isZh])

  useEffect(() => {
    void loadNodes()
  }, [loadNodes])

  /** 删除节点 */
  const handleDelete = useCallback(
    async (nodeId: string) => {
      if (!confirm(isZh ? '确定删除该节点？相关边也会被删除。' : 'Delete node? Related edges will also be removed.')) {
        return
      }
      try {
        const result = await window.electronAPI.causal.deleteNode(nodeId)
        if (result.success) {
          await loadNodes()
        } else {
          alert(result.error || (isZh ? '删除失败' : 'Delete failed'))
        }
      } catch (e) {
        logger.causal?.error('Failed to delete node:', e)
        alert(e instanceof Error ? e.message : String(e))
      }
    },
    [isZh, loadNodes],
  )

  /** 切换节点启用状态 */
  const handleToggleEnabled = useCallback(
    async (node: CausalNode) => {
      try {
        const result = await window.electronAPI.causal.updateNode(node.id, {
          enabled: !node.enabled,
        })
        if (result.success) {
          await loadNodes()
        } else {
          alert(result.error)
        }
      } catch (e) {
        logger.causal?.error('Failed to toggle node:', e)
      }
    },
    [loadNodes],
  )

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-3 border-b border-border/40">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={isZh ? '搜索节点名称…' : 'Search nodes…'}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as CausalNodeType | '')}
          className="px-2 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
        >
          <option value="">{isZh ? '全部类型' : 'All types'}</option>
          {Object.entries(NODE_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {isZh ? label.zh : label.en}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setEditingNode(null)
            setShowEditor(true)
          }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          {isZh ? '新增' : 'Add'}
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-muted text-[12px]">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
            {isZh ? '加载中…' : 'Loading…'}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-10 text-red-500 text-[12px]">
            <AlertCircle className="w-4 h-4 mr-2" />
            {error}
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-text-muted text-[12px]">
            <Network className="w-8 h-8 mb-2 opacity-40" />
            {isZh ? '暂无节点，点击右上角新增' : 'No nodes yet, click Add to create'}
          </div>
        ) : (
          nodes.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              isZh={isZh}
              onEdit={() => {
                setEditingNode(node)
                setShowEditor(true)
              }}
              onDelete={() => void handleDelete(node.id)}
              onToggle={() => void handleToggleEnabled(node)}
            />
          ))
        )}
      </div>

      {/* 编辑器弹层 */}
      {showEditor && (
        <NodeEditor
          language={language}
          node={editingNode}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false)
            void loadNodes()
          }}
        />
      )}
    </div>
  )
}

/** 节点行 */
function NodeRow({
  node,
  isZh,
  onEdit,
  onDelete,
  onToggle,
}: {
  node: CausalNode
  isZh: boolean
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const typeLabel = NODE_TYPE_LABELS[node.type]
  const sourceLabel = NODE_SOURCE_LABELS[node.source]
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-surface/40 border border-border/40 hover:border-border transition-all">
      <button
        onClick={onToggle}
        className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${node.enabled ? 'bg-emerald-500' : 'bg-text-muted/40'}`}
        title={node.enabled ? (isZh ? '已启用' : 'Enabled') : isZh ? '已禁用' : 'Disabled'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary truncate">{node.name}</span>
          <span className="px-1.5 py-0.5 rounded text-[11px] bg-purple-500/10 text-purple-500">
            {isZh ? typeLabel.zh : typeLabel.en}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[11px] bg-surface/60 text-text-muted">
            {isZh ? sourceLabel.zh : sourceLabel.en}
          </span>
        </div>
        {node.description && (
          <p className="text-[12px] text-text-secondary mt-1 line-clamp-2">{node.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg text-text-muted hover:text-accent hover:bg-surface-hover transition-all"
          title={isZh ? '编辑' : 'Edit'}
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          title={isZh ? '删除' : 'Delete'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

/** 节点编辑器 */
function NodeEditor({
  language,
  node,
  onClose,
  onSaved,
}: {
  language: Language
  node: CausalNode | null
  onClose: () => void
  onSaved: () => void
}) {
  const isZh = language === 'zh'
  const isEdit = !!node
  const [name, setName] = useState(node?.name || '')
  const [type, setType] = useState<CausalNodeType>(node?.type || 'event')
  const [description, setDescription] = useState(node?.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError(isZh ? '名称不能为空' : 'Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = isEdit
        ? await window.electronAPI.causal.updateNode(node!.id, { description: description.trim() })
        : await window.electronAPI.causal.createNode({
            type,
            name: name.trim(),
            description: description.trim() || undefined,
            source: 'manual',
          })
      if (result.success) {
        onSaved()
      } else {
        setError(result.error || (isZh ? '保存失败' : 'Save failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to save node:', e)
    } finally {
      setSaving(false)
    }
  }, [name, type, description, isEdit, isZh, node, onSaved])

  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-border shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <h3 className="text-sm font-bold text-text-primary">
            {isEdit ? (isZh ? '编辑节点' : 'Edit Node') : isZh ? '新增节点' : 'Add Node'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {/* 名称 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '名称' : 'Name'}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50 disabled:opacity-60"
              placeholder={isZh ? '如：写代码、开会、咖啡因摄入' : 'e.g., coding, meeting, caffeine intake'}
            />
            {isEdit && (
              <p className="text-[11px] text-text-muted mt-1">
                {isZh ? '节点名称不可修改' : 'Node name cannot be changed'}
              </p>
            )}
          </div>
          {/* 类型 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '类型' : 'Type'}
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CausalNodeType)}
              disabled={isEdit}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50 disabled:opacity-60"
            >
              {Object.entries(NODE_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {isZh ? label.zh : label.en}
                </option>
              ))}
            </select>
          </div>
          {/* 描述 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '描述' : 'Description'}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50 resize-none"
              placeholder={isZh ? '可选：节点的详细描述' : 'Optional: detailed description'}
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-500 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {isZh ? '保存' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ============================================================
// 边视图
// ============================================================

function EdgesView({ language }: { language: Language }) {
  const isZh = language === 'zh'
  const [edges, setEdges] = useState<CausalEdge[]>([])
  const [nodes, setNodes] = useState<CausalNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterRelation, setFilterRelation] = useState<CausalEdgeRelation | ''>('')
  const [showEditor, setShowEditor] = useState(false)

  /** 加载边和节点（节点用于显示名称） */
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [edgeRes, nodeRes] = await Promise.all([
        window.electronAPI.causal.listEdges({
          relation: filterRelation || undefined,
        }),
        window.electronAPI.causal.listNodes(),
      ])
      if (edgeRes.success && edgeRes.data) setEdges(edgeRes.data as CausalEdge[])
      else setError(edgeRes.error || (isZh ? '加载边失败' : 'Failed to load edges'))
      if (nodeRes.success && nodeRes.data) setNodes(nodeRes.data as CausalNode[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to load edges:', e)
    } finally {
      setLoading(false)
    }
  }, [filterRelation, isZh])

  useEffect(() => {
    void loadData()
  }, [loadData])

  /** 节点 id → name 映射 */
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>()
    nodes.forEach((n) => map.set(n.id, n.name))
    return map
  }, [nodes])

  /** 删除边 */
  const handleDelete = useCallback(
    async (edgeId: string) => {
      if (!confirm(isZh ? '确定删除该边？' : 'Delete edge?')) return
      try {
        const result = await window.electronAPI.causal.deleteEdge(edgeId)
        if (result.success) {
          await loadData()
        } else {
          alert(result.error)
        }
      } catch (e) {
        logger.causal?.error('Failed to delete edge:', e)
      }
    },
    [isZh, loadData],
  )

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-3 border-b border-border/40">
        <select
          value={filterRelation}
          onChange={(e) => setFilterRelation(e.target.value as CausalEdgeRelation | '')}
          className="px-2 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50"
        >
          <option value="">{isZh ? '全部关系' : 'All relations'}</option>
          {Object.entries(EDGE_RELATION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {isZh ? label.zh : label.en}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setShowEditor(true)}
          disabled={nodes.length < 2}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-60 transition-all"
          title={nodes.length < 2 ? (isZh ? '至少需要 2 个节点' : 'Need at least 2 nodes') : ''}
        >
          <Plus className="w-3.5 h-3.5" />
          {isZh ? '新增' : 'Add'}
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-muted text-[12px]">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
            {isZh ? '加载中…' : 'Loading…'}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-10 text-red-500 text-[12px]">
            <AlertCircle className="w-4 h-4 mr-2" />
            {error}
          </div>
        ) : edges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-text-muted text-[12px]">
            <Network className="w-8 h-8 mb-2 opacity-40" />
            {isZh ? '暂无边' : 'No edges yet'}
          </div>
        ) : (
          edges.map((edge) => (
            <EdgeRow
              key={edge.id}
              edge={edge}
              fromName={nodeNameMap.get(edge.fromNodeId) || edge.fromNodeId}
              toName={nodeNameMap.get(edge.toNodeId) || edge.toNodeId}
              isZh={isZh}
              onDelete={() => void handleDelete(edge.id)}
              onSaved={() => void loadData()}
            />
          ))
        )}
      </div>

      {showEditor && (
        <EdgeEditor
          language={language}
          nodes={nodes}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false)
            void loadData()
          }}
        />
      )}
    </div>
  )
}

/** 边行 */
function EdgeRow({
  edge,
  fromName,
  toName,
  isZh,
  onDelete,
  onSaved,
}: {
  edge: CausalEdge
  fromName: string
  toName: string
  isZh: boolean
  onDelete: () => void
  onSaved: () => void
}) {
  const relationLabel = EDGE_RELATION_LABELS[edge.relation]
  const sourceLabel = EDGE_SOURCE_LABELS[edge.source]
  const [editing, setEditing] = useState(false)
  const [strength, setStrength] = useState(edge.strength)

  const handleUpdateStrength = useCallback(async () => {
    try {
      const result = await window.electronAPI.causal.updateEdge(edge.id, { strength })
      if (result.success) {
        setEditing(false)
        onSaved()
      }
    } catch (e) {
      logger.causal?.error('Failed to update edge:', e)
    }
  }, [edge.id, strength, onSaved])

  return (
    <div className="p-3 rounded-xl bg-surface/40 border border-border/40 hover:border-border transition-all">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-medium text-text-primary">{fromName}</span>
        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        <span className={`text-[12px] font-medium ${relationLabel.color}`}>
          {isZh ? relationLabel.zh : relationLabel.en}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-sm font-medium text-text-primary">{toName}</span>
        <span className="ml-auto px-1.5 py-0.5 rounded text-[11px] bg-surface/60 text-text-muted">
          {isZh ? sourceLabel.zh : sourceLabel.en}
        </span>
        {!edge.enabled && (
          <span className="px-1.5 py-0.5 rounded text-[11px] bg-text-muted/20 text-text-muted">
            {isZh ? '已禁用' : 'Disabled'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[11px] text-text-muted">{isZh ? '强度' : 'Strength'}</span>
          {editing ? (
            <>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                className="flex-1 max-w-[160px]"
              />
              <span className="text-[12px] text-text-secondary tabular-nums w-10">
                {strength.toFixed(2)}
              </span>
              <button
                onClick={() => void handleUpdateStrength()}
                className="px-2 py-0.5 rounded text-[11px] bg-accent text-white hover:bg-accent/90"
              >
                {isZh ? '保存' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <div className="flex-1 max-w-[160px] h-1.5 rounded-full bg-surface/60 overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full"
                  style={{ width: `${Math.round(strength * 100)}%` }}
                />
              </div>
              <span className="text-[12px] text-text-secondary tabular-nums w-10">
                {strength.toFixed(2)}
              </span>
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded text-text-muted hover:text-accent hover:bg-surface-hover"
                title={isZh ? '编辑强度' : 'Edit strength'}
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
        <button
          onClick={onDelete}
          className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10"
          title={isZh ? '删除' : 'Delete'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {edge.evidence && (
        <p className="text-[11px] text-text-muted mt-2 italic line-clamp-1">证据：{edge.evidence}</p>
      )}
    </div>
  )
}

/** 边编辑器 */
function EdgeEditor({
  language,
  nodes,
  onClose,
  onSaved,
}: {
  language: Language
  nodes: CausalNode[]
  onClose: () => void
  onSaved: () => void
}) {
  const isZh = language === 'zh'
  const enabledNodes = useMemo(() => nodes.filter((n) => n.enabled), [nodes])
  const [fromNodeId, setFromNodeId] = useState(enabledNodes[0]?.id || '')
  const [toNodeId, setToNodeId] = useState(enabledNodes[1]?.id || '')
  const [relation, setRelation] = useState<CausalEdgeRelation>('causes')
  const [strength, setStrength] = useState(0.7)
  const [evidence, setEvidence] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!fromNodeId || !toNodeId) {
      setError(isZh ? '请选择源节点和目标节点' : 'Please select source and target nodes')
      return
    }
    if (fromNodeId === toNodeId) {
      setError(isZh ? '源节点和目标节点不能相同' : 'Source and target cannot be the same')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.causal.createEdge({
        fromNodeId,
        toNodeId,
        relation,
        strength,
        evidence: evidence.trim() || undefined,
        source: 'manual',
      })
      if (result.success) {
        onSaved()
      } else {
        setError(result.error || (isZh ? '保存失败' : 'Save failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      logger.causal?.error('Failed to save edge:', e)
    } finally {
      setSaving(false)
    }
  }, [fromNodeId, toNodeId, relation, strength, evidence, isZh, onSaved])

  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-border shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '新增边' : 'Add Edge'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {/* 源节点 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '源节点（因）' : 'Source (Cause)'}
            </label>
            <select
              value={fromNodeId}
              onChange={(e) => setFromNodeId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            >
              {enabledNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          {/* 关系 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '关系' : 'Relation'}
            </label>
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value as CausalEdgeRelation)}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            >
              {Object.entries(EDGE_RELATION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {isZh ? label.zh : label.en}
                </option>
              ))}
            </select>
          </div>
          {/* 目标节点 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '目标节点（果）' : 'Target (Effect)'}
            </label>
            <select
              value={toNodeId}
              onChange={(e) => setToNodeId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            >
              {enabledNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          {/* 强度 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '强度' : 'Strength'}: {strength.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={strength}
              onChange={(e) => setStrength(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          {/* 证据 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '证据' : 'Evidence'}
            </label>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50 resize-none"
              placeholder={isZh ? '可选：支持这条因果关系的证据' : 'Optional: evidence supporting this relation'}
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-500 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {isZh ? '保存' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
