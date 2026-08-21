/**
 * 场景模式语音命令识别（方向2）
 *
 * 从语音 STT 文本中识别场景切换命令，支持中英文。
 * 匹配规则优先于 LLM 调用，避免延迟。
 *
 * 支持的命令：
 * - 切换到工作模式 / 进入工作模式 / 工作模式
 * - 切换到生活模式 / 进入生活模式 / 生活模式
 * - 切换到学习模式 / 进入学习模式 / 学习模式
 * - switch to work mode / work mode
 * - switch to life mode / life mode
 * - switch to study mode / study mode
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/05-extensions.md} 方向2 设计
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'

/** 命令匹配规则 */
interface SceneCommandRule {
  /** 正则表达式（不区分大小写） */
  pattern: RegExp
  /** 目标模式 */
  mode: SceneMode
  /** 命令名称（用于日志） */
  name: string
}

/**
 * 场景命令规则集
 *
 * 设计原则：
 * - 中文匹配"切换到X模式"、"进入X模式"、"X模式"
 * - 英文匹配 "switch to X mode"、"X mode"
 * - 独立词匹配（避免误触发，要求"模式"或"mode"关键词）
 */
const SCENE_COMMANDS: SceneCommandRule[] = [
  // ── 工作模式 ──
  {
    pattern: /(?:切换到|进入|切换至|切到).{0,4}(?:工作|办公).{0,2}模式|(?:工作|办公)模式/,
    mode: 'work',
    name: 'work-mode-command',
  },
  {
    pattern: /\b(?:switch(?:\s+to)?|enter|change(?:\s+to)?)\s+(?:the\s+)?(?:work|office)\s+mode\b|\b(?:work|office)\s+mode\b/i,
    mode: 'work',
    name: 'work-mode-command-en',
  },

  // ── 生活模式 ──
  {
    pattern: /(?:切换到|进入|切换至|切到).{0,4}生活.{0,2}模式|生活模式/,
    mode: 'life',
    name: 'life-mode-command',
  },
  {
    pattern: /\b(?:switch(?:\s+to)?|enter|change(?:\s+to)?)\s+(?:the\s+)?(?:life|personal)\s+mode\b|\b(?:life|personal)\s+mode\b/i,
    mode: 'life',
    name: 'life-mode-command-en',
  },

  // ── 学习模式 ──
  {
    pattern: /(?:切换到|进入|切换至|切到).{0,4}(?:学习|读书|阅读).{0,2}模式|(?:学习|读书|阅读)模式/,
    mode: 'study',
    name: 'study-mode-command',
  },
  {
    pattern: /\b(?:switch(?:\s+to)?|enter|change(?:\s+to)?)\s+(?:the\s+)?(?:study|learning)\s+mode\b|\b(?:study|learning)\s+mode\b/i,
    mode: 'study',
    name: 'study-mode-command-en',
  },
]

/** 命令识别结果 */
export interface SceneCommandResult {
  /** 匹配到的模式 */
  mode: SceneMode
  /** 匹配的规则名称（日志用） */
  ruleName: string
  /** 匹配的原文片段 */
  matchedText: string
}

/**
 * 从 STT 文本中识别场景切换命令
 *
 * @param text STT 识别文本
 * @returns 匹配结果，未匹配返回 null
 */
export function recognizeSceneCommand(text: string): SceneCommandResult | null {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()

  for (const rule of SCENE_COMMANDS) {
    const match = trimmed.match(rule.pattern)
    if (match) {
      return {
        mode: rule.mode,
        ruleName: rule.name,
        matchedText: match[0],
      }
    }
  }

  return null
}
