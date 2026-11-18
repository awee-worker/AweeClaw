import openaiIcon from '@renderer/assets/ai-provider/openai.svg'
import anthropicIcon from '@renderer/assets/ai-provider/Anthropic.svg'
import googleIcon from '@renderer/assets/ai-provider/google.svg'
import deepseekIcon from '@renderer/assets/ai-provider/deepseek.svg'
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
import aliyunBailianIcon from '@renderer/assets/ai-provider/aliyunbailian.svg'
import tencentHunyuanIcon from '@renderer/assets/ai-provider/tengxunhunyuan.svg'
import baiduQianfanIcon from '@renderer/assets/ai-provider/baiduqianfan.svg'
import iflytekSparkIcon from '@renderer/assets/ai-provider/xunfeixinghuo.svg'
import xaiIcon from '@renderer/assets/ai-provider/Grok.svg'
import mistralIcon from '@renderer/assets/ai-provider/Mistral.svg'
import groqIcon from '@renderer/assets/ai-provider/groq.svg'
import openrouterIcon from '@renderer/assets/ai-provider/openrouter.svg'
import togetherIcon from '@renderer/assets/ai-provider/ai-together.svg'
import perplexityIcon from '@renderer/assets/ai-provider/Perplexity.svg'
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
  qwen: aliyunBailianIcon,
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
  hunyuan: tencentHunyuanIcon,
  qianfan: baiduQianfanIcon,
  spark: iflytekSparkIcon,
  xai: xaiIcon,
  mistral: mistralIcon,
  groq: groqIcon,
  openrouter: openrouterIcon,
  together: togetherIcon,
  perplexity: perplexityIcon,
}

export function ProviderIcon({ providerId, size = 16, className }: ProviderIconProps) {
  const id = providerId || ''
  // 自定义服务商沿用「自定义」图标；其余未内置图标的服务商走首字母占位，
  // 否则新接入的服务商会和自定义服务商长得一样，列表里分不清
  const src = iconMap[id] || (id.startsWith('custom') ? customIcon : '')
  if (src) {
    return <img src={src} alt={id} width={size} height={size} className={className} style={{ objectFit: 'contain' }} />
  }

  const label = (id.charAt(0) || '?').toUpperCase()
  return (
    <span
      aria-label={id}
      className={`inline-flex items-center justify-center rounded-md bg-surface-active/60 text-text-secondary font-semibold leading-none ${className || ''}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.62)) }}
    >
      {label}
    </span>
  )
}
