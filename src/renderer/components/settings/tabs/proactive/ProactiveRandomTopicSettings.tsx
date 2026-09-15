/**
 * 主动助手 - 随机话题设置子面板（P2-3 新增）
 *
 * 职责：
 * 1. 随机话题开关（enabled）
 * 2. 情绪倾向选择（mood）
 * 3. 话题深度选择（depth）
 * 4. 分类选择（category）
 * 5. 单日话题上限（dailyLimit）
 *
 * 纯展示 + 回调组件，不直接调用 IPC。
 *
 * @module settings/tabs/proactive/ProactiveRandomTopicSettings
 */

import { memo } from 'react'
import { Sparkles, Heart, Layers, Tag, Hash } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language, t } from '@renderer/i18n'
import type { ProactivePermissionConfig } from './ProactiveSettingsPanel'

interface Props {
  config: ProactivePermissionConfig
  language: Language
  onUpdate: (patch: Partial<ProactivePermissionConfig>) => void
}

/** 情绪倾向选项 */
const MOOD_OPTIONS = [
  { value: '', label: '随机' },
  { value: 'light', label: '轻松' },
  { value: 'deep', label: '深度' },
  { value: 'warm', label: '温暖' },
  { value: 'curious', label: '好奇' },
  { value: 'motivational', label: '励志' },
  { value: 'humorous', label: '幽默' },
]

/** 话题深度选项 */
const DEPTH_OPTIONS = [
  { value: 1, label: '浅度', desc: '轻松闲聊' },
  { value: 2, label: '中度', desc: '有一定思考' },
  { value: 3, label: '深度', desc: '深入探讨' },
]

/** 分类选项 */
const CATEGORY_OPTIONS = [
  { value: '', label: '随机' },
  { value: 'daily', label: '日常' },
  { value: 'tech', label: '科技' },
  { value: 'work', label: '职场' },
  { value: 'hobby', label: '兴趣' },
  { value: 'philosophy', label: '哲学' },
  { value: 'creative', label: '创意' },
  { value: 'learning', label: '学习' },
  { value: 'social', label: '社交' },
  { value: 'health', label: '健康' },
  { value: 'entertainment', label: '娱乐' },
]

// ============================================================
// 组件
// ============================================================

export const ProactiveRandomTopicSettings = memo(function ProactiveRandomTopicSettings({
  config,
  language,
  onUpdate,
}: Props) {
  // 获取随机话题配置（提供默认值）
  const randomTopic = config.randomTopic ?? {
    enabled: false,
    mood: undefined,
    depth: 2,
    category: undefined,
    dailyLimit: 3,
  }

  // 更新随机话题配置
  const updateRandomTopic = (patch: Partial<typeof randomTopic>) => {
    onUpdate({
      randomTopic: {
        ...randomTopic,
        ...patch,
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-accent" />
        <h3 className="text-lg font-medium">
          {t('settings.proactive.randomTopic.title', language) || '随机话题'}
        </h3>
      </div>

      <p className="text-sm text-text-muted">
        {t('settings.proactive.randomTopic.desc', language) ||
          '主动发起有质量的话题，打破沉默，增进交流。'}
      </p>

      {/* 开关 */}
      <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-border">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium">
              {t('settings.proactive.randomTopic.enable', language) || '启用随机话题'}
            </div>
            <div className="text-sm text-text-muted">
              {t('settings.proactive.randomTopic.enable.desc', language) ||
                'AI 将在用户空闲时主动发起话题'}
            </div>
          </div>
        </div>
        <ToggleSwitch
          checked={randomTopic.enabled}
          onChange={(checked) => updateRandomTopic({ enabled: checked })}
          aria-label={t('settings.proactive.randomTopic.enable', language) || '启用随机话题'}
        />
      </div>

      {/* 详细设置（仅在启用时显示） */}
      {randomTopic.enabled && (
        <div className="space-y-4 p-4 bg-surface rounded-lg border border-border">
          {/* 情绪倾向 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-text-muted" />
              <label className="text-sm font-medium">
                {t('settings.proactive.randomTopic.mood', language) || '情绪倾向'}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {MOOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    updateRandomTopic({ mood: option.value || undefined })
                  }
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    (randomTopic.mood || '') === option.value
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* 话题深度 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-text-muted" />
              <label className="text-sm font-medium">
                {t('settings.proactive.randomTopic.depth', language) || '话题深度'}
              </label>
            </div>
            <div className="flex gap-2">
              {DEPTH_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => updateRandomTopic({ depth: option.value })}
                  className={`flex-1 p-3 text-sm rounded-md transition-colors ${
                    randomTopic.depth === option.value
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                  }`}
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs opacity-75">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 分类 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-text-muted" />
              <label className="text-sm font-medium">
                {t('settings.proactive.randomTopic.category', language) || '话题分类'}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    updateRandomTopic({ category: option.value || undefined })
                  }
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    (randomTopic.category || '') === option.value
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* 单日话题上限 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-text-muted" />
              <label className="text-sm font-medium">
                {t('settings.proactive.randomTopic.dailyLimit', language) || '单日话题上限'}
              </label>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1}
                max={10}
                value={randomTopic.dailyLimit ?? 3}
                onChange={(e) => updateRandomTopic({ dailyLimit: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="text-sm font-medium w-8 text-center">
                {randomTopic.dailyLimit ?? 3}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {t('settings.proactive.randomTopic.dailyLimit.desc', language) ||
                '避免话题过多造成打扰，建议 2-5 条'}
            </p>
          </div>
        </div>
      )}

      {/* 提示信息 */}
      <div className="p-4 bg-surface-hover rounded-lg border border-border">
        <h4 className="text-sm font-medium mb-2">
          {t('settings.proactive.randomTopic.tips', language) || '使用提示'}
        </h4>
        <ul className="text-sm text-text-muted space-y-1">
          <li>• {t('settings.proactive.randomTopic.tip1', language) || '话题会在用户空闲 5 分钟后触发'}</li>
          <li>• {t('settings.proactive.randomTopic.tip2', language) || '同一话题 24 小时内不会重复'}</li>
          <li>• {t('settings.proactive.randomTopic.tip3', language) || '可在"分类"标签中调整时间场景的开关'}</li>
          <li>• {t('settings.proactive.randomTopic.tip4', language) || '建议保持"时间"分类开启以使用此功能'}</li>
        </ul>
      </div>
    </div>
  )
})