/**
 * 实体类型差异化配置面板（阶段7 s7-08 新增）
 *
 * 功能：
 * - 可视化管理 SensorFusionConfig.entityTypeOverrides
 * - 为每个实体类型配置差异化阈值（覆盖全局默认值）
 * - 所有字段均为可选（留空或 0 表示使用全局配置）
 * - 支持添加/移除覆盖配置
 * - 实时保存到后端 SensorFusionService.updateConfig
 *
 * 数据流：
 * - 读取：window.electronAPI.sensorFusion.getConfig()
 * - 保存：window.electronAPI.sensorFusion.updateConfig({ entityTypeOverrides })
 *
 * @module settings/tabs/iot/EntityTypeOverridesPanel
 */

import { useState, useCallback } from 'react'
import { Layers, Plus, Trash2, X } from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'

interface EntityTypeOverridesPanelProps {
  language: Language
  /** 当前配置中的 entityTypeOverrides */
  overrides: Record<string, Partial<EntityTypeOverride>>
  /** 配置变更回调（父组件统一调用 updateConfig） */
  onChange: (
    overrides: Record<string, Partial<EntityTypeOverride>>,
  ) => void
}

/** 实体类型参数覆盖 */
interface EntityTypeOverride {
  windowSize?: number
  zscoreThreshold?: number
  rateOfChangeThreshold?: number
  stuckValueTimeoutMs?: number
  stuckMinReadings?: number
  cooldownMs?: number
}

/** 可选的实体类型 */
const ENTITY_TYPES = [
  'sensor',
  'binary_sensor',
  'switch',
  'light',
  'climate',
  'cover',
  'lock',
  'media_player',
  'device_tracker',
  'unknown',
] as const

/**
 * EntityTypeOverridesPanel
 */
export function EntityTypeOverridesPanel({
  language,
  overrides,
  onChange,
}: EntityTypeOverridesPanelProps) {
  const t = createTranslator(language)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newEntityType, setNewEntityType] = useState<string>('')

  /** 添加新覆盖 */
  const handleAdd = useCallback(() => {
    if (!newEntityType) return
    if (overrides[newEntityType]) {
      return // 已存在
    }
    const newOverrides = {
      ...overrides,
      [newEntityType]: {},
    }
    onChange(newOverrides)
    setShowAddDialog(false)
    setNewEntityType('')
  }, [newEntityType, overrides, onChange])

  /** 移除覆盖 */
  const handleRemove = useCallback(
    (entityType: string) => {
      const newOverrides = { ...overrides }
      delete newOverrides[entityType]
      onChange(newOverrides)
    },
    [overrides, onChange],
  )

  /** 更新单个字段 */
  const handleFieldChange = useCallback(
    (entityType: string, field: keyof EntityTypeOverride, value: number) => {
      const current = overrides[entityType] ?? {}
      const newOverride = { ...current }
      if (value === 0 || Number.isNaN(value)) {
        delete newOverride[field]
      } else {
        newOverride[field] = value
      }
      onChange({
        ...overrides,
        [entityType]: newOverride,
      })
    },
    [overrides, onChange],
  )

  /** 计算输入框显示值（0 或空表示使用全局） */
  const displayValue = (
    override: Partial<EntityTypeOverride> | undefined,
    field: keyof EntityTypeOverride,
  ): number => {
    const v = override?.[field]
    return typeof v === 'number' ? v : 0
  }

  /** 获取尚未配置的实体类型（用于添加下拉框） */
  const availableTypes = ENTITY_TYPES.filter((t) => !overrides[t])

  return (
    <section className="space-y-3 p-5 bg-surface/30 backdrop-blur-md rounded-xl border border-border shadow-sm">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-text-muted" />
          <div>
            <h4 className="text-sm font-bold text-text-primary">
              {t('iot.fusion.overridesTitle')}
            </h4>
            <p className="text-[12px] text-text-muted mt-0.5">
              {t('iot.fusion.overridesSubtitle')}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          disabled={availableTypes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('iot.fusion.overridesAddButton')}
        </button>
      </div>

      {/* 空状态 */}
      {Object.keys(overrides).length === 0 ? (
        <div className="py-6 text-center text-[12px] text-text-muted">
          {t('iot.fusion.overridesEmpty')}
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(overrides).map(([entityType, override]) => (
            <div
              key={entityType}
              className="p-4 rounded-lg bg-surface/20 border border-border/30 space-y-3"
            >
              {/* 类型标题 + 移除按钮 */}
              <div className="flex items-center justify-between">
                <span className="px-2 py-1 rounded-md bg-accent/10 text-accent text-[12px] font-medium border border-accent/20">
                  {entityType}
                </span>
                <button
                  onClick={() => handleRemove(entityType)}
                  className="flex items-center gap-1 px-2 py-1 text-[12px] rounded-md text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 className="w-3 h-3" />
                  {t('iot.fusion.overridesRemove')}
                </button>
              </div>

              {/* 字段网格 */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <OverrideNumberInput
                  label={t('iot.fusion.overridesWindow')}
                  value={displayValue(override, 'windowSize')}
                  min={5}
                  max={500}
                  onChange={(v) =>
                    handleFieldChange(entityType, 'windowSize', v)
                  }
                />
                <OverrideNumberInput
                  label={t('iot.fusion.overridesZscore')}
                  value={displayValue(override, 'zscoreThreshold')}
                  min={1.5}
                  max={10}
                  step={0.5}
                  onChange={(v) =>
                    handleFieldChange(entityType, 'zscoreThreshold', v)
                  }
                />
                <OverrideNumberInput
                  label={t('iot.fusion.overridesRate')}
                  value={displayValue(override, 'rateOfChangeThreshold')}
                  min={1.5}
                  max={10}
                  step={0.5}
                  onChange={(v) =>
                    handleFieldChange(
                      entityType,
                      'rateOfChangeThreshold',
                      v,
                    )
                  }
                />
                <OverrideNumberInput
                  label={t('iot.fusion.overridesStuckTimeout')}
                  value={Math.floor(
                    (displayValue(override, 'stuckValueTimeoutMs') || 0) /
                      1000,
                  )}
                  min={30}
                  max={3600}
                  onChange={(v) =>
                    handleFieldChange(
                      entityType,
                      'stuckValueTimeoutMs',
                      v * 1000,
                    )
                  }
                />
                <OverrideNumberInput
                  label={t('iot.fusion.overridesStuckMin')}
                  value={displayValue(override, 'stuckMinReadings')}
                  min={2}
                  max={50}
                  onChange={(v) =>
                    handleFieldChange(entityType, 'stuckMinReadings', v)
                  }
                />
                <OverrideNumberInput
                  label={t('iot.fusion.overridesCooldown')}
                  value={Math.floor(
                    (displayValue(override, 'cooldownMs') || 0) / 1000,
                  )}
                  min={10}
                  max={3600}
                  onChange={(v) =>
                    handleFieldChange(entityType, 'cooldownMs', v * 1000)
                  }
                />
              </div>
              <p className="text-[12px] text-text-muted">
                {t('iot.fusion.overridesFieldHint')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 添加对话框 */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md p-5 rounded-xl bg-surface border border-border shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">
                {t('iot.fusion.overridesAddTitle')}
              </h3>
              <button
                onClick={() => {
                  setShowAddDialog(false)
                  setNewEntityType('')
                }}
                className="p-1 rounded-md hover:bg-surface/40"
              >
                <X className="w-4 h-4 text-text-muted" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1">
                  {t('iot.fusion.overridesEntityType')}
                </label>
                <select
                  value={newEntityType}
                  onChange={(e) => setNewEntityType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
                >
                  <option value="">
                    {t('iot.fusion.overridesSelectType')}
                  </option>
                  {availableTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {newEntityType && overrides[newEntityType] && (
                <p className="text-[12px] text-red-500">
                  {t('iot.fusion.overridesAlreadyExists')}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setShowAddDialog(false)
                  setNewEntityType('')
                }}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-surface/40 border border-border/40 hover:bg-surface/60 text-text-secondary"
              >
                {t('iot.fusion.overridesCancel')}
              </button>
              <button
                onClick={handleAdd}
                disabled={
                  !newEntityType || Boolean(overrides[newEntityType])
                }
                className="px-3 py-1.5 text-[12px] rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('iot.fusion.overridesConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ============================================================
// 通用子组件
// ============================================================

function OverrideNumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-text-secondary mb-1">
        {label}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value || ''}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-2.5 py-1.5 rounded-lg bg-surface/40 border border-border/40 text-[12px] text-text-primary focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
      />
    </div>
  )
}
