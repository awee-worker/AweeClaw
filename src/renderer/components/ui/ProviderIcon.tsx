import React from 'react'

import openaiIcon from '@renderer/assets/ai-provider/openai.svg'
import anthropicIcon from '@renderer/assets/ai-provider/Anthropic.svg'
import googleIcon from '@renderer/assets/ai-provider/google.svg'
import deepseekIcon from '@renderer/assets/ai-provider/deepseek.svg'
import qwenIcon from '@renderer/assets/ai-provider/qwen.svg'
import glmIcon from '@renderer/assets/ai-provider/glm.svg'
import moonshotIcon from '@renderer/assets/ai-provider/Moonshot.svg'
import doubaoIcon from '@renderer/assets/ai-provider/doubao.svg'
import baichuanIcon from '@renderer/assets/ai-provider/baichuan.svg'
import minimaxIcon from '@renderer/assets/ai-provider/MiniMax.svg'
import xiaomiIcon from '@renderer/assets/ai-provider/xiaomi.svg'
import yiIcon from '@renderer/assets/ai-provider/yi-lightning.svg'
import stepfunIcon from '@renderer/assets/ai-provider/stepfun.svg'
import siliconflowIcon from '@renderer/assets/ai-provider/siliconflow.svg'
import ollamaIcon from '@renderer/assets/ai-provider/ollama.svg'
import customIcon from '@renderer/assets/ai-provider/custom.svg'

interface ProviderIconProps {
  providerId: string
  size?: number
  className?: string
}

const iconMap: Record<string, string> = {
  openai: openaiIcon,
  anthropic: anthropicIcon,
  gemini: googleIcon,
  deepseek: deepseekIcon,
  qwen: qwenIcon,
  zhipu: glmIcon,
  moonshot: moonshotIcon,
  doubao: doubaoIcon,
  baichuan: baichuanIcon,
  minimax: minimaxIcon,
  xiaomi: xiaomiIcon,
  yi: yiIcon,
  stepfun: stepfunIcon,
  siliconflow: siliconflowIcon,
  ollama: ollamaIcon,
}

export function ProviderIcon({ providerId, size = 16, className }: ProviderIconProps) {
  const src = iconMap[providerId] || customIcon
  return <img src={src} alt={providerId} width={size} height={size} className={className} style={{ objectFit: 'contain' }} />
}
