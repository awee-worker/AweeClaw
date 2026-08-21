/**
 * 场景模式语音音色解析器
 *
 * 将场景模式的抽象 voiceId 映射为 TTS Provider 特定的音色 ID。
 *
 * 抽象 voiceId 定义（在 SceneModeProfile.voiceProfile 中）：
 * - 'professional-male'：干练男声（工作模式）
 * - 'warm-female'：温暖女声（生活模式）
 * - 'patient-mentor'：耐心导师声（学习模式）
 *
 * Provider 特定音色：
 * - OpenAI TTS: alloy, echo, fable, onyx, nova, shimmer
 * - Aliyun CosyVoice: longxiaochun, longcheng, longwan 等
 * - SiliconFlow: model:voice 格式
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/04-d-implementation.md} D-步骤2 设计
 */

import type { VoiceProfile } from './SceneModeDescriptor'

/** 抽象音色 → Provider 音色映射表 */
const VOICE_ID_MAPPING: Record<string, Record<string, string>> = {
  // 干练男声 — 工作模式
  'professional-male': {
    openai: 'echo',
    aliyun: 'longcheng',
    siliconflow: 'alex',
    default: 'echo',
  },
  // 温暖女声 — 生活模式
  'warm-female': {
    openai: 'nova',
    aliyun: 'longxiaochun',
    siliconflow: 'anna',
    default: 'nova',
  },
  // 耐心导师声 — 学习模式
  'patient-mentor': {
    openai: 'fable',
    aliyun: 'longwan',
    siliconflow: 'bella',
    default: 'fable',
  },
}

/** 解析后的 TTS 音色配置 */
export interface ResolvedVoiceConfig {
  /** TTS Provider 特定的音色 ID */
  voice: string
  /** 语速倍率 */
  speed: number
}

/**
 * 解析场景模式音色配置
 *
 * 优先级：场景模式 voiceProfile > 用户 TTS 配置 > 默认值
 *
 * @param sceneVoiceProfile  场景模式的 voiceProfile（null 时回退到用户配置）
 * @param ttsProvider        用户配置的 TTS Provider（openai/aliyun/siliconflow）
 * @param userTtsVoice       用户配置的 TTS 音色（fallback）
 * @param userTtsSpeed       用户配置的 TTS 语速（fallback）
 * @returns 解析后的 { voice, speed }
 */
export function resolveSceneVoice(
  sceneVoiceProfile: VoiceProfile | null | undefined,
  ttsProvider: string | undefined,
  userTtsVoice: string | undefined,
  userTtsSpeed: number | undefined,
): ResolvedVoiceConfig {
  // 无场景音色配置时，回退到用户配置
  if (!sceneVoiceProfile) {
    return {
      voice: userTtsVoice || 'alloy',
      speed: userTtsSpeed ?? 1.0,
    }
  }

  // 尝试映射抽象 voiceId 为 Provider 特定音色
  const providerKey = (ttsProvider || 'openai').toLowerCase()
  const mapping = VOICE_ID_MAPPING[sceneVoiceProfile.voiceId]
  const mappedVoice = mapping
    ? (mapping[providerKey] || mapping.default)
    : (userTtsVoice || 'alloy')

  return {
    voice: mappedVoice,
    speed: sceneVoiceProfile.speed ?? userTtsSpeed ?? 1.0,
  }
}
