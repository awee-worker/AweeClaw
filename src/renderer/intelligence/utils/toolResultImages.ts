/**
 * 工具结果图片整理
 *
 * 把工具产出的图片（典型是内置浏览器截图 browser_take_screenshot）整理成可以随
 * 上下文送给模型的形态，并提供三条链路（主对话 / 语音对话 / 多智能体子循环）
 * 共用的「图片能否进模型」判定与消息构建。
 *
 * 与界面展示用的 ToolCall.richContent 分开：展示要原图清晰度，模型只要够看清内容，
 * 因此这里统一做一次降采样 + JPEG 压缩 —— 整屏 PNG 不经处理直接进请求体，体积与
 * 延迟都不可接受。
 */

import type { ToolRichContent } from '@protocols'
import type { ToolResultImage, LLMMessage, LLMConfig } from '@intelligence/providerTypes'
import { logger } from '@renderer/toolkit/LogEngine'
import { compressImageFromBase64 } from './imageCompressor'

/** 送入模型的图片长边上限（视觉模型按像素而非字节计费，1024 已足够看清页面结构） */
const MAX_DIMENSION = 1024
/** JPEG 质量：截图以文字与线条为主，0.8 在细节和体积之间最平衡 */
const JPEG_QUALITY = 0.8
/** 单次工具结果最多带入模型的图片数 */
const MAX_IMAGES_PER_RESULT = 4

/**
 * 判断当前请求链路是否允许把图片像素送进模型
 *
 * 不再按传输链路一刀切。客户端拿不到可靠的模型级视觉能力（内置 provider 的
 * features.vision 只是服务商级，对同服务商下的纯文本模型会误判），因此改用
 * 「先送、失败再去图」的策略：
 * - 云端链路（cloudMode / cloudVisionMode）：后端按模型能力直传或转交视觉模型，本就安全；
 * - 本地直连：可能是支持看图的本地 VLM（如 Ollama llava），一律不送会让它彻底失去
 *   视觉能力。这里同样放行，由「视觉错误 → 去图重试」兜底（见 isVisualUnsupportedError）。
 *
 * 唯一不放行的是缺少 LLM 配置——此时连请求都发不出去，收集图片只是白做功。
 *
 * @param config 本次请求实际使用的 LLM 配置
 */
export function canSendImagePixelsToModel(
  config?: Pick<LLMConfig, 'cloudMode' | 'cloudVisionMode'> | null,
): boolean {
  return !!config
}

/**
 * 已确认不支持图片输入的模型（`provider:model`）
 *
 * 本地直连的「先送、失败再去图」代价是失败时多一次请求。对确定不支持视觉的模型，
 * 每轮都先撞一次墙没有意义，命中此集合后直接去图，只把代价留在首次探测上。
 */
const visionUnsupportedModels = new Set<string>()

/** 组装视觉能力缓存键；缺少 model 时返回空串（不参与缓存） */
function visionCapabilityKey(
  config?: Pick<LLMConfig, 'provider' | 'model'> | null,
): string {
  if (!config?.model) return ''
  return `${config.provider || ''}:${config.model}`
}

/** 记录某模型已确认不支持图片输入（进程生命周期内生效） */
export function markVisionUnsupported(
  config?: Pick<LLMConfig, 'provider' | 'model'> | null,
): void {
  const key = visionCapabilityKey(config)
  if (key) visionUnsupportedModels.add(key)
}

/** 该模型是否已被确认不支持图片输入 */
export function isVisionKnownUnsupported(
  config?: Pick<LLMConfig, 'provider' | 'model'> | null,
): boolean {
  const key = visionCapabilityKey(config)
  return key ? visionUnsupportedModels.has(key) : false
}

/** 错误文本里指向「图片 / 视觉」的主题词 */
const VISUAL_SUBJECT_RE = /image|vision|multimodal|图片|图像|视觉|截图/i

/** 错误文本里指向「不接受该输入 / 参数非法」的判定词 */
const VISUAL_REJECT_RE =
  /not\s+support|unsupported|does\s+not\s+support|invalid|unknown\s+variant|unexpected|should\s+be|expected\s+one\s+of|cannot|can't|unable|不支持|无法|无效|不允许|类型/

/**
 * 判断错误是否源于「模型不接受图片输入」
 *
 * 仅当错误文本同时出现视觉主题词与拒绝语义时才判定命中：图片一旦真的让请求失败，
 * provider 的报错几乎都会带上 `image` / `vision` 之类的字段名，纯网络、鉴权类错误则不会。
 */
export function isVisualUnsupportedError(errorText?: string | null): boolean {
  if (!errorText) return false
  return VISUAL_SUBJECT_RE.test(errorText) && VISUAL_REJECT_RE.test(errorText)
}

/** 消息数组里是否含图片内容（多模态 user 消息） */
export function messagesContainImages(messages: LLMMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part?.type === 'image'),
  )
}

/**
 * 去掉消息里的图片内容，得到可降级重试的纯文本消息
 *
 * 被剥掉的图片不会无声消失：原消息保留其文本，并追加一句说明，让模型知道自己是
 * 在「看不到图」的前提下作答，而不是把空内容当成没有收到任何东西。
 * 无图片时原样返回入参，避免无谓的数组重建。
 */
export function stripImagesFromMessages(messages: LLMMessage[]): LLMMessage[] {
  if (!messagesContainImages(messages)) return messages

  const omissionNote =
    '[Image omitted: the current model does not accept image input. Answer using the text and tool output above only.]'

  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message
    if (!message.content.some((part) => part?.type === 'image')) return message

    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')

    return { ...message, content: text ? `${text}\n${omissionNote}` : omissionNote }
  })
}

/**
 * 构建工具附图消息
 *
 * 图片以 user 消息承载而非内联进 tool 消息：OpenAI 的 tool role 只接受字符串，
 * 多模态内容会被序列化成纯文本（base64 变文本，体积暴涨且模型看不到画面）；
 * user 消息的多模态是各 provider 一致支持的通道。
 *
 * 正文显式声明图片来自工具而非用户，否则模型会把工具输出误当成用户提供的素材。
 */
export function buildToolResultImageMessage(
  toolNames: string[],
  images: ToolResultImage[],
): LLMMessage {
  const names = [...new Set(toolNames)].join(', ')
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[Tool output: ${images.length} image(s) captured by ${names} just now.`
          + ' These are live tool results, not user-uploaded content.'
          + ' Inspect the image(s) directly and base your answer on what you see.]',
      },
      ...images.map((image) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mimeType,
          data: image.data,
        },
      })),
    ],
  }
}


/**
 * 从工具富内容里挑出图片并整理成可送入上下文的形态
 *
 * @param richContent 工具返回的富内容（界面展示用的那一份）
 * @returns 整理后的图片列表；没有可用图片时返回 undefined
 */
export async function collectToolResultImages(
  richContent?: ToolRichContent[],
): Promise<ToolResultImage[] | undefined> {
  if (!richContent?.length) return undefined

  const candidates = richContent.filter(
    (item): item is ToolRichContent & { data: string } =>
      item.type === 'image' && typeof item.data === 'string' && item.data.length > 0,
  )
  if (candidates.length === 0) return undefined

  const images: ToolResultImage[] = []
  for (const item of candidates.slice(0, MAX_IMAGES_PER_RESULT)) {
    try {
      const compressed = await compressImageFromBase64(item.data, item.mimeType || 'image/png', {
        maxDimension: MAX_DIMENSION,
        quality: JPEG_QUALITY,
      })
      images.push({
        data: compressed.base64,
        mimeType: compressed.mimeType,
        caption: item.title,
      })
    } catch (error) {
      // 压缩依赖 Canvas 与图片解码：个别图片失败不应影响工具结果本身
      logger.agent.warn('[ToolResultImages] Failed to prepare image for model context:', error)
    }
  }

  return images.length > 0 ? images : undefined
}
