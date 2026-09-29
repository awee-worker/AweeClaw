/**
 * 专家库设置面板
 */

import { useMemo, useState } from 'react'
import {
  Plus,
  Copy,
  Pencil,
  Trash2,
  Search,
  Info,
} from 'lucide-react'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { RoleDescriptor } from '@intelligence/capabilities/role/RoleDescriptor'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'
import { RoleEditForm } from './role/RoleEditForm'
import { ToggleSwitch } from '@components/ui'
import { toast } from '@components/foundation/InlineNotification'

const SCENES: Array<{ id: SceneMode; label: string }> = [
  { id: 'work', label: '日常办公' },
  { id: 'life', label: '生活陪伴' },
  { id: 'study', label: '学习探索' },
  { id: 'dev', label: '代码开发' },
]

export function RoleLibraryPanel() {
  const [activeScene, setActiveScene] = useState<SceneMode>('work')
  const [search, setSearch] = useState('')
  const [editingRole, setEditingRole] = useState<RoleDescriptor | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const roles = useRoleLibraryStore(s => s.roles)
  const overrides = useRoleLibraryStore(s => s.overrides)
  const autoMatchEnabled = useRoleLibraryStore(s => s.autoMatchEnabled)
  const defaultRoleIds = useRoleLibraryStore(s => s.defaultRoleIds)
  const setAutoMatchEnabled = useRoleLibraryStore(s => s.setAutoMatchEnabled)
  const setRoleEnabled = useRoleLibraryStore(s => s.setRoleEnabled)
  const removeCustomRole = useRoleLibraryStore(s => s.removeCustomRole)
  const setDefaultRole = useRoleLibraryStore(s => s.setDefaultRole)
  const getRolesByScene = useRoleLibraryStore(s => s.getRolesByScene)

  const sceneRoles = useMemo(() => getRolesByScene(activeScene), [getRolesByScene, activeScene, roles, overrides])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sceneRoles
    return sceneRoles.filter(r =>
      r.nameZh.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)
    )
  }, [sceneRoles, search])

  /** 打开新建表单（基于当前场景生成 id 前缀） */
  const handleCreate = () => {
    setEditingRole(null)
    setFormOpen(true)
  }

  /** 打开编辑表单 */
  const handleEdit = (role: RoleDescriptor) => {
    setEditingRole(role)
    setFormOpen(true)
  }

  /** 复制为自定义专家（可跨场景） */
  const handleCopy = (role: RoleDescriptor) => {
    const now = Date.now()
    const copy: RoleDescriptor = {
      ...role,
      id: `${activeScene}.${role.id.split('.')[1] ?? 'role'}-copy-${now.toString(36)}`,
      sceneMode: activeScene,
      builtin: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    const issues = useRoleLibraryStore.getState().addRole(copy)
    if (issues.length > 0) {
      toast.error(`复制失败：${issues[0].message}`)
      return
    }
    toast.success('已复制为自定义专家，技能引用如越界已清空')
  }

  const handleDelete = (role: RoleDescriptor) => {
    if (role.builtin) return
    removeCustomRole(role.id)
    toast.success(`已删除专家：${role.nameZh}`)
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* 顶部：场景切换 + 自动匹配开关 + 搜索 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-hover rounded-lg p-0.5">
          {SCENES.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveScene(s.id)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                activeScene === s.id
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-text-muted select-none">
            <span>自动匹配专家</span>
            <ToggleSwitch
              switchSize="sm"
              checked={autoMatchEnabled}
              onChange={e => setAutoMatchEnabled(e.target.checked)}
            />
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索专家"
              className="pl-7 pr-2 py-1 text-xs bg-input border border-input-border rounded-md outline-none focus:border-accent w-36"
            />
          </div>

          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />创建专家
          </button>
        </div>
      </div>

      {/* 专家卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {filtered.map(role => (
          <div
            key={role.id}
            className={`rounded-lg border p-3 transition-all ${
              role.enabled ? 'border-border hover:border-border-hover' : 'border-border opacity-60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-primary">{role.nameZh}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-text-muted">
                    {role.builtin ? '内置' : '自定义'}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    技能 {role.skillRefs.length} · 触发词 {role.triggers.keywords.length}
                  </span>
                  {defaultRoleIds[activeScene] === role.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">默认</span>
                  )}
                </div>
                <div className="text-xs text-text-muted mt-1 truncate">{role.description}</div>
                <div className="text-[10px] text-text-muted/70 mt-0.5 truncate">{role.id}</div>
              </div>

              {/* 启停开关 */}
              <ToggleSwitch
                switchSize="sm"
                checked={role.enabled}
                onChange={e => setRoleEnabled(role.id, e.target.checked)}
                className="flex-shrink-0"
              />
            </div>

            <div className="flex items-center gap-1 mt-2">
              <button
                onClick={() => handleEdit(role)}
                className="px-2 py-0.5 text-[11px] text-text-muted hover:text-accent hover:bg-accent/5 rounded transition-colors"
              >
                <Pencil className="w-3 h-3 inline mr-0.5" />编辑专家
              </button>
              <button
                onClick={() => handleCopy(role)}
                className="px-2 py-0.5 text-[11px] text-text-muted hover:text-accent hover:bg-accent/5 rounded transition-colors"
              >
                <Copy className="w-3 h-3 inline mr-0.5" />复制为自定义专家
              </button>
              {!role.builtin && (
                <button
                  onClick={() => handleDelete(role)}
                  className="px-2 py-0.5 text-[11px] text-text-muted hover:text-status-error hover:bg-status-error/5 rounded transition-colors"
                >
                  <Trash2 className="w-3 h-3 inline mr-0.5" />删除
                </button>
              )}
              {role.enabled && defaultRoleIds[activeScene] !== role.id && (
                <button
                  onClick={() => setDefaultRole(activeScene, role.id)}
                  className="ml-auto px-2 py-0.5 text-[11px] text-text-muted hover:text-accent hover:bg-accent/5 rounded transition-colors"
                >
                  设为默认
                </button>
              )}
              {defaultRoleIds[activeScene] === role.id && (
                <button
                  onClick={() => setDefaultRole(activeScene, null)}
                  className="ml-auto px-2 py-0.5 text-[11px] text-accent hover:bg-accent/5 rounded transition-colors"
                >
                  取消默认
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-xs text-text-muted py-8">
            当前场景暂无专家
          </div>
        )}
      </div>

      {/* 边界提示 */}
      <div className="flex items-start gap-1.5 text-[11px] text-text-muted pt-1">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>专家决定「用哪套方法做事」，不会改变 AweeClaw 的身份与安全边界；停用专家后仍可用场景默认方式完成同类任务。</span>
      </div>

      {/* 编辑表单 */}
      {formOpen && (
        <RoleEditForm
          sceneMode={activeScene}
          existing={editingRole}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  )
}
