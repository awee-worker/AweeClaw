/**
 * 执行中呼吸圆点
 *
 * 内层实心圆点做缩放 + 透明度的呼吸，外层描边圈以同一周期向外扩散淡出，
 * 合起来读作「心跳 + 涟漪」。比旋转加载图标安静：不拽视线，但在列表里
 * 仍能一眼认出哪条还在跑。
 *
 * 尺寸由调用方通过 className 给定，因此容器占位可以跟被替换掉的图标完全
 * 一致，替换后行内文字不会左右移动；圆点本体用 size 控制，外圈按同一
 * 尺寸向外扩散。
 */

import { memo } from 'react'

interface BreathingDotProps {
  /** 圆点直径，单位 px */
  size?: number
  /** 是否启用外圈扩散，密集列表里可关掉以降低视觉噪声 */
  ring?: boolean
  className?: string
}

export const BreathingDot = memo(({ size = 7, ring = true, className = '' }: BreathingDotProps) => (
  <span className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
    {ring && (
      // 外层单独包一层做居中，避免 scale 覆盖掉居中所需的 translate
      <span className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
        <span
          className="rounded-full border border-accent/50 animate-dot-ripple"
          style={{ width: size, height: size }}
        />
      </span>
    )}
    <span
      className="rounded-full bg-accent animate-dot-breath"
      style={{ width: size, height: size }}
    />
  </span>
))

BreathingDot.displayName = 'BreathingDot'
