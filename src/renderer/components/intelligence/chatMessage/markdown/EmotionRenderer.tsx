/**
 * 表情包渲染组件
 *
 * 功能：
 * 1. 识别 AI 回复中的表情标记（如 `[emo:开心]` 或 `:happy:`）
 * 2. 渲染为对应的图片
 * 3. 支持角色卡资产中的表情包
 * 4. 支持用户自建表情包目录
 * 5. 失败降级：找不到表情时保留原始标记文本
 *
 * 设计要点：
 * 1. 资源协议：表情图若是本地文件，必须走自定义协议加载
 * 2. 缓存：按表情名称缓存图片 URL，避免重复加载
 * 3. 性能：懒加载图片，避免阻塞渲染
 *
 * @module intelligence/chatMessage/markdown/EmotionRenderer
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { logger } from '@shared/toolkit/LogEngine'

interface EmotionRendererProps {
  /** 表情标记（如 `[emo:开心]` 或 `:happy:`） */
  emotionTag: string
  /** 角色卡 ID（用于加载角色卡资产中的表情包） */
  characterCardId?: string
  /** 语言 */
  language?: 'zh-CN' | 'en-US'
}

interface EmotionState {
  imageUrl: string | null
  isLoading: boolean
  error: boolean
  emotionName: string
}

/** 表情标记正则表达式 */
const EMOTION_PATTERNS = [
  /\[emo:([^\]]+)\]/,  // [emo:开心]
  /:([a-zA-Z0-9_]+):/, // :happy:
]

/** 解析表情标记 */
function parseEmotionTag(tag: string): string | null {
  for (const pattern of EMOTION_PATTERNS) {
    const match = tag.match(pattern)
    if (match) {
      return match[1]
    }
  }
  return null
}

/** 表情包缓存 */
const emotionCache = new Map<string, string>()

/** 加载表情包图片 */
async function loadEmotionImage(
  emotionName: string,
  characterCardId?: string
): Promise<string | null> {
  // 检查缓存
  const cacheKey = `${characterCardId || 'global'}:${emotionName}`
  if (emotionCache.has(cacheKey)) {
    return emotionCache.get(cacheKey)!
  }

  try {
    // 1. 首先尝试从角色卡资产加载
    if (characterCardId) {
      const characterAssetUrl = await loadFromCharacterAssets(emotionName, characterCardId)
      if (characterAssetUrl) {
        emotionCache.set(cacheKey, characterAssetUrl)
        return characterAssetUrl
      }
    }

    // 2. 然后尝试从全局表情包目录加载
    const globalAssetUrl = await loadFromGlobalAssets(emotionName)
    if (globalAssetUrl) {
      emotionCache.set(cacheKey, globalAssetUrl)
      return globalAssetUrl
    }

    // 3. 最后尝试从内置表情包加载
    const builtinAssetUrl = await loadFromBuiltinAssets(emotionName)
    if (builtinAssetUrl) {
      emotionCache.set(cacheKey, builtinAssetUrl)
      return builtinAssetUrl
    }

    return null
  } catch (error) {
    logger.ui.warn('[EmotionRenderer] Failed to load emotion image:', emotionName, error)
    return null
  }
}

/** 从角色卡资产加载表情包 */
async function loadFromCharacterAssets(
  emotionName: string,
  characterCardId: string
): Promise<string | null> {
  try {
    // 通过 IPC 查询角色卡资产
    const result = await window.electronAPI.invoke('character-card:get-card', {
      cardId: characterCardId,
    })

    if (result.success && result.data) {
      const card = result.data
      const emotionAsset = card.assets.find(
        (asset: any) => asset.type === 'emotion' && asset.name === emotionName
      )

      if (emotionAsset) {
        // 如果有本地路径，使用自定义协议加载
        if (emotionAsset.local_path) {
          return `aweclaw-emotion://${emotionAsset.local_path}`
        }
        // 如果有 URL，直接使用
        if (emotionAsset.url) {
          return emotionAsset.url
        }
      }
    }
  } catch (error) {
    logger.ui.debug('[EmotionRenderer] Failed to load from character assets:', error)
  }

  return null
}

/** 从全局表情包目录加载 */
async function loadFromGlobalAssets(emotionName: string): Promise<string | null> {
  try {
    // 通过 IPC 查询全局表情包
    const result = await window.electronAPI.invoke('emotion:get-emotion', {
      name: emotionName,
    })

    if (result.success && result.data?.url) {
      return result.data.url
    }
  } catch (error) {
    logger.ui.debug('[EmotionRenderer] Failed to load from global assets:', error)
  }

  return null
}

/** 从内置表情包加载 */
async function loadFromBuiltinAssets(emotionName: string): Promise<string | null> {
  // 内置表情包映射
  const builtinEmotions: Record<string, string> = {
    'happy': '/assets/emotions/happy.png',
    'sad': '/assets/emotions/sad.png',
    'angry': '/assets/emotions/angry.png',
    'surprised': '/assets/emotions/surprised.png',
    'confused': '/assets/emotions/confused.png',
    'love': '/assets/emotions/love.png',
    'laughing': '/assets/emotions/laughing.png',
    'crying': '/assets/emotions/crying.png',
    'thinking': '/assets/emotions/thinking.png',
    'cool': '/assets/emotions/cool.png',
    // 中文表情
    '开心': '/assets/emotions/happy.png',
    '难过': '/assets/emotions/sad.png',
    '生气': '/assets/emotions/angry.png',
    '惊讶': '/assets/emotions/surprised.png',
    '困惑': '/assets/emotions/confused.png',
    '爱心': '/assets/emotions/love.png',
    '大笑': '/assets/emotions/laughing.png',
    '哭泣': '/assets/emotions/crying.png',
    '思考': '/assets/emotions/thinking.png',
    '酷': '/assets/emotions/cool.png',
  }

  return builtinEmotions[emotionName] || null
}

export const EmotionRenderer: React.FC<EmotionRendererProps> = memo(function EmotionRenderer({
  emotionTag,
  characterCardId,
  language = 'zh-CN',
}) {
  const [state, setState] = useState<EmotionState>({
    imageUrl: null,
    isLoading: true,
    error: false,
    emotionName: '',
  })

  const isZh = language === 'zh-CN'

  // 解析表情标记
  useEffect(() => {
    const emotionName = parseEmotionTag(emotionTag)
    if (emotionName) {
      setState(prev => ({ ...prev, emotionName, isLoading: true, error: false }))

      loadEmotionImage(emotionName, characterCardId)
        .then(url => {
          if (url) {
            setState(prev => ({ ...prev, imageUrl: url, isLoading: false }))
          } else {
            setState(prev => ({ ...prev, isLoading: false, error: true }))
          }
        })
        .catch(error => {
          logger.ui.error('[EmotionRenderer] Failed to load emotion:', error)
          setState(prev => ({ ...prev, isLoading: false, error: true }))
        })
    } else {
      setState(prev => ({ ...prev, isLoading: false, error: true }))
    }
  }, [emotionTag, characterCardId])

  // 如果加载失败或找不到表情，返回原始标记
  if (state.error || !state.emotionName) {
    return <span className="emotion-fallback">{emotionTag}</span>
  }

  // 如果正在加载，显示加载状态
  if (state.isLoading) {
    return (
      <span className="emotion-loading inline-flex items-center gap-1 px-1 py-0.5 rounded bg-surface-secondary animate-pulse">
        <span className="w-4 h-4 rounded bg-border-secondary" />
        <span className="text-xs text-text-secondary">
          {isZh ? '加载中...' : 'Loading...'}
        </span>
      </span>
    )
  }

  // 渲染表情图片
  return (
    <span className="emotion-container inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-surface-secondary transition-colors">
      <img
        src={state.imageUrl!}
        alt={state.emotionName}
        title={state.emotionName}
        className="w-5 h-5 object-contain"
        onError={() => {
          logger.ui.warn('[EmotionRenderer] Failed to load emotion image:', state.imageUrl)
          setState(prev => ({ ...prev, error: true }))
        }}
        loading="lazy"
      />
      <span className="text-xs text-text-secondary select-none">
        {state.emotionName}
      </span>
    </span>
  )
})

/** 检查文本是否包含表情标记 */
export function containsEmotionTags(text: string): boolean {
  return EMOTION_PATTERNS.some(pattern => pattern.test(text))
}

/** 提取文本中的所有表情标记 */
export function extractEmotionTags(text: string): string[] {
  const tags: string[] = []

  for (const pattern of EMOTION_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, 'g')
    let match

    while ((match = globalPattern.exec(text)) !== null) {
      tags.push(match[0])
    }
  }

  return [...new Set(tags)] // 去重
}

/** 替换文本中的表情标记为占位符 */
export function replaceEmotionTagsWithPlaceholders(
  text: string,
  placeholderMap: Map<string, string>
): string {
  let result = text

  for (const pattern of EMOTION_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, 'g')
    result = result.replace(globalPattern, (match) => {
      const placeholder = `__EMOTION_${placeholderMap.size}__`
      placeholderMap.set(placeholder, match)
      return placeholder
    })
  }

  return result
}

/** 从占位符恢复表情标记 */
export function restoreEmotionTagsFromPlaceholders(
  text: string,
  placeholderMap: Map<string, string>
): string {
  let result = text

  for (const [placeholder, originalTag] of placeholderMap) {
    result = result.replace(placeholder, originalTag)
  }

  return result
}