/**
 * 记忆详情面板
 * 展示单条记忆的完整信息、关联、反馈、版本历史
 */
import { useState, useCallback } from 'react'
import {
  X,
  Edit3,
  Trash2,
  RefreshCw,
  Tag,
  Clock,
  MapPin,
  Link2,
  MessageSquare,
  History,
  Save,
  AlertTriangle,
} from 'lucide-react'
import { useMemoryStore } from '../store'
import {
  CategoryBadge,
  TierBadge,
  ImportanceIndicator,
  RetentionIndicator,
  TagList,
  RelationTypeBadge,
  LoadingState,
  formatRelativeTime,
  formatDate,
} from './shared'
import {
  CATEGORY_META,
  type MemoryCategory,
  type MemoryTier,
  type MemoryFeedbackType,
} from '../types'

type TabId = 'info' | 'relations' | 'feedback' | 'versions' | 'spatial'

const TABS: Array<{ id: TabId; label: string; icon: typeof Tag }> = [
  { id: 'info', label: '详情', icon: Tag },
  { id: 'relations', label: '关联', icon: Link2 },
  { id: 'spatial', label: '空间', icon: MapPin },
  { id: 'feedback', label: '反馈', icon: MessageSquare },
  { id: 'versions', label: '版本', icon: History },
]

export function MemoryDetailPanel({ floating = false }: { floating?: boolean } = {}) {
  const {
    currentMemory,
    spatialMemory,
    relations,
    feedbacks,
    loadingDetail,
    showDetailPanel,
    setShowDetailPanel,
    updateMemory,
    deleteMemory,
    classifyMemory,
    reviewMemory,
    createFeedback,
    deleteRelation,
  } = useMemoryStore()

  const [activeTab, setActiveTab] = useState<TabId>('info')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editImportance, setEditImportance] = useState(0.5)
  const [editCategory, setEditCategory] = useState<MemoryCategory | ''>('')
  const [editTier, setEditTier] = useState<MemoryTier | ''>('')
  const [editTags, setEditTags] = useState('')

  // 进入编辑模式
  const startEdit = useCallback(() => {
    if (!currentMemory) return
    setEditContent(currentMemory.content)
    setEditSummary(currentMemory.summary ?? '')
    setEditImportance(currentMemory.importance)
    setEditCategory(currentMemory.category ?? '')
    setEditTier(currentMemory.tier ?? '')
    setEditTags((currentMemory.tags ?? []).join(', '))
    setEditing(true)
  }, [currentMemory])

  // 保存编辑
  const handleSave = useCallback(async () => {
    if (!currentMemory) return
    const tags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    await updateMemory(currentMemory.id, {
      content: editContent,
      summary: editSummary || undefined,
      importance: editImportance,
      category: editCategory || undefined,
      tier: editTier || undefined,
      tags,
    })
    setEditing(false)
  }, [currentMemory, editContent, editSummary, editImportance, editCategory, editTier, editTags, updateMemory])

  // 删除
  const handleDelete = useCallback(async () => {
    if (!currentMemory) return
    if (!confirm('确定要删除这条记忆吗？归档后可恢复，硬删除不可恢复。')) return
    await deleteMemory(currentMemory.id, false)
  }, [currentMemory, deleteMemory])

  // 重新分类
  const handleReclassify = useCallback(async () => {
    if (!currentMemory) return
    await classifyMemory(currentMemory.id, true)
  }, [currentMemory, classifyMemory])

  // 复习
  const handleReview = useCallback(async () => {
    if (!currentMemory) return
    await reviewMemory(currentMemory.id)
  }, [currentMemory, reviewMemory])

  // 创建反馈
  const handleFeedback = useCallback(
    async (type: MemoryFeedbackType) => {
      if (!currentMemory) return
      await createFeedback(currentMemory.id, type)
    },
    [currentMemory, createFeedback],
  )

  if (!showDetailPanel) return null

  return (
    <div
      className={`flex flex-col h-full bg-surface/95 backdrop-blur border-l border-border/40 w-[420px] shrink-0 ${
        floating ? 'shadow-2xl' : ''
      }`}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold text-text-primary">记忆详情</h3>
        <div className="flex items-center gap-1">
          {currentMemory && !editing && (
            <>
              <button
                onClick={handleReview}
                title="标记为已复习"
                className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleReclassify}
                title="重新分类"
                className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              >
                <Tag className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={startEdit}
                title="编辑"
                className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDelete}
                title="删除"
                className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setShowDetailPanel(false)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      {loadingDetail ? (
        <LoadingState message="加载详情..." />
      ) : currentMemory ? (
        <>
          {/* 编辑模式 */}
          {editing ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">内容</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 text-sm bg-surface-hover/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">摘要</label>
                <input
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-hover/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">重要性</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={editImportance}
                    onChange={(e) => setEditImportance(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <span className="text-xs text-text-muted">{editImportance.toFixed(1)}</span>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">层级</label>
                  <select
                    value={editTier}
                    onChange={(e) => setEditTier(e.target.value as MemoryTier)}
                    className="w-full px-2 py-1.5 text-sm bg-surface-hover/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary"
                  >
                    <option value="">不变</option>
                    <option value="permanent">永久</option>
                    <option value="long_term">长期</option>
                    <option value="short_term">短期</option>
                    <option value="working">工作</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">分类</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as MemoryCategory)}
                  className="w-full px-2 py-1.5 text-sm bg-surface-hover/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary"
                >
                  <option value="">不变</option>
                  {Object.entries(CATEGORY_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">标签（逗号分隔）</label>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="标签1, 标签2"
                  className="w-full px-3 py-2 text-sm bg-surface-hover/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Tab 栏 */}
              <div className="flex items-center border-b border-border/40 px-2">
                {TABS.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                        activeTab === tab.id
                          ? 'text-accent border-accent'
                          : 'text-text-muted hover:text-text-primary border-transparent'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {tab.label}
                    </button>
                  )
                })}
              </div>

              {/* Tab 内容 */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                {/* 详情 Tab */}
                {activeTab === 'info' && (
                  <div className="space-y-4">
                    {/* 分类与层级 */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <CategoryBadge category={currentMemory.category} size="sm" />
                      <TierBadge tier={currentMemory.tier} size="sm" />
                      {currentMemory.classifiedBy && (
                        <span className="text-[10px] text-text-muted">
                          分类方式: {currentMemory.classifiedBy}
                        </span>
                      )}
                    </div>

                    {/* 内容 */}
                    <div>
                      <h4 className="text-xs text-text-muted mb-1.5">内容</h4>
                      <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                        {currentMemory.content}
                      </p>
                    </div>

                    {/* 摘要 */}
                    {currentMemory.summary && (
                      <div>
                        <h4 className="text-xs text-text-muted mb-1.5">摘要</h4>
                        <p className="text-sm text-text-secondary italic">{currentMemory.summary}</p>
                      </div>
                    )}

                    {/* 指标 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-surface-hover/30 rounded-lg p-3">
                        <div className="text-xs text-text-muted mb-1">重要性</div>
                        <ImportanceIndicator importance={currentMemory.importance} showLabel />
                      </div>
                      <div className="bg-surface-hover/30 rounded-lg p-3">
                        <div className="text-xs text-text-muted mb-1">保留值</div>
                        {currentMemory.retentionScore !== undefined ? (
                          <RetentionIndicator retentionScore={currentMemory.retentionScore} />
                        ) : (
                          <span className="text-xs text-text-muted">-</span>
                        )}
                      </div>
                    </div>

                    {/* 标签 */}
                    {currentMemory.tags && currentMemory.tags.length > 0 && (
                      <div>
                        <h4 className="text-xs text-text-muted mb-1.5">标签</h4>
                        <TagList tags={currentMemory.tags} max={20} size="sm" />
                      </div>
                    )}

                    {/* 元数据 */}
                    <div className="space-y-1.5 pt-2 border-t border-border/20">
                      <MetaRow icon={<Clock className="w-3 h-3" />} label="创建时间" value={formatDate(currentMemory.createdAt)} />
                      <MetaRow icon={<Clock className="w-3 h-3" />} label="更新时间" value={formatDate(currentMemory.updatedAt)} />
                      {currentMemory.lastReviewedAt && (
                        <MetaRow
                          icon={<RefreshCw className="w-3 h-3" />}
                          label="最后复习"
                          value={`${formatRelativeTime(currentMemory.lastReviewedAt)}（共 ${currentMemory.reviewCount ?? 0} 次）`}
                        />
                      )}
                      <MetaRow
                        icon={<Tag className="w-3 h-3" />}
                        label="访问次数"
                        value={`${currentMemory.accessCount} 次`}
                      />
                      {currentMemory.classificationConfidence !== null &&
                        currentMemory.classificationConfidence !== undefined && (
                          <MetaRow
                            icon={<AlertTriangle className="w-3 h-3" />}
                            label="分类置信度"
                            value={`${Math.round(currentMemory.classificationConfidence * 100)}%`}
                          />
                        )}
                    </div>

                    {/* 快速反馈 */}
                    <div className="pt-2 border-t border-border/20">
                      <h4 className="text-xs text-text-muted mb-2">快速反馈</h4>
                      <div className="flex items-center gap-2">
                        <FeedbackButton type="useful" onClick={() => handleFeedback('useful')} />
                        <FeedbackButton type="not_useful" onClick={() => handleFeedback('not_useful')} />
                        <FeedbackButton type="outdated" onClick={() => handleFeedback('outdated')} />
                        <FeedbackButton type="incorrect" onClick={() => handleFeedback('incorrect')} />
                      </div>
                    </div>
                  </div>
                )}

                {/* 关联 Tab */}
                {activeTab === 'relations' && (
                  <div className="space-y-2">
                    {relations.length === 0 ? (
                      <p className="text-xs text-text-muted text-center py-8">暂无关联记忆</p>
                    ) : (
                      relations.map((rel) => {
                        const otherMemory =
                          rel.sourceMemoryId === currentMemory.id ? rel.targetMemory : rel.sourceMemory
                        return (
                          <div
                            key={rel.id}
                            className="flex items-start gap-2 p-2.5 bg-surface-hover/30 rounded-lg border border-border/30"
                          >
                            <RelationTypeBadge relationType={rel.relationType} size="xs" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-text-primary line-clamp-2">
                                {otherMemory?.content ?? '已删除'}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-text-muted">
                                  权重: {rel.weight.toFixed(2)}
                                </span>
                                <button
                                  onClick={() => deleteRelation(rel.id)}
                                  className="text-[10px] text-text-muted hover:text-red-500 ml-auto"
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {/* 空间 Tab */}
                {activeTab === 'spatial' && (
                  <div className="space-y-3">
                    {spatialMemory ? (
                      <>
                        {spatialMemory.locationName && (
                          <MetaRow
                            icon={<MapPin className="w-3 h-3" />}
                            label="位置"
                            value={spatialMemory.locationName}
                          />
                        )}
                        {spatialMemory.address && (
                          <MetaRow
                            icon={<MapPin className="w-3 h-3" />}
                            label="地址"
                            value={spatialMemory.address}
                          />
                        )}
                        {spatialMemory.sceneType && (
                          <MetaRow
                            icon={<MapPin className="w-3 h-3" />}
                            label="场景"
                            value={spatialMemory.sceneType}
                          />
                        )}
                        {spatialMemory.deviceName && (
                          <MetaRow
                            icon={<MapPin className="w-3 h-3" />}
                            label="设备"
                            value={spatialMemory.deviceName}
                          />
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-text-muted text-center py-8">暂无空间上下文</p>
                    )}
                  </div>
                )}

                {/* 反馈 Tab */}
                {activeTab === 'feedback' && (
                  <div className="space-y-2">
                    {feedbacks.length === 0 ? (
                      <p className="text-xs text-text-muted text-center py-8">暂无反馈记录</p>
                    ) : (
                      feedbacks.map((fb) => (
                        <div
                          key={fb.id}
                          className="p-2.5 bg-surface-hover/30 rounded-lg border border-border/30"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <FeedbackBadge type={fb.feedbackType} />
                            <span className="text-[10px] text-text-muted">
                              {formatRelativeTime(fb.createdAt)}
                            </span>
                          </div>
                          {fb.comment && (
                            <p className="text-xs text-text-secondary mt-1">{fb.comment}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* 版本 Tab */}
                {activeTab === 'versions' && (
                  <div className="space-y-2">
                    {currentMemory.versions && currentMemory.versions.length > 0 ? (
                      currentMemory.versions.map((ver) => (
                        <div
                          key={ver.id}
                          className="p-2.5 bg-surface-hover/30 rounded-lg border border-border/30"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-text-primary">
                              v{ver.version}
                            </span>
                            <span className="text-[10px] text-text-muted">
                              {formatRelativeTime(ver.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary line-clamp-3">{ver.content}</p>
                          {ver.changeReason && (
                            <p className="text-[10px] text-text-muted mt-1">
                              原因: {ver.changeReason}
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-text-muted text-center py-8">暂无版本历史</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
          选择一条记忆查看详情
        </div>
      )}
    </div>
  )
}

// ============ 辅助组件 ============

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-text-muted">{icon}</span>
      <span className="text-text-muted">{label}:</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  )
}

function FeedbackButton({
  type,
  onClick,
}: {
  type: MemoryFeedbackType
  onClick: () => void
}) {
  const labels: Record<MemoryFeedbackType, string> = {
    useful: '👍 有用',
    not_useful: '👎 无用',
    outdated: '⏰ 过时',
    incorrect: '❌ 错误',
  }
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 text-xs rounded-lg border border-border/40 text-text-secondary hover:bg-surface-hover transition-colors"
    >
      {labels[type]}
    </button>
  )
}

function FeedbackBadge({ type }: { type: MemoryFeedbackType }) {
  const labels: Record<MemoryFeedbackType, { text: string; color: string }> = {
    useful: { text: '有用', color: '#10B981' },
    not_useful: { text: '无用', color: '#6B7280' },
    outdated: { text: '过时', color: '#F59E0B' },
    incorrect: { text: '错误', color: '#EF4444' },
  }
  const meta = labels[type]
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
    >
      {meta.text}
    </span>
  )
}
