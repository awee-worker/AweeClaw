/**
 * AvatarStatic - 悬浮头像静态形态（idle 状态）
 *
 * idle 状态下显示的简约静态头像，不启动 3D Canvas 渲染，大幅降低 CPU/GPU 占用。
 *
 * 设计：
 * - 圆形头像（品牌图标撑满整个圆球，object-fit: cover）
 * - 白色边框
 * - 预加载：图片加载完成前整个组件透明（opacity:0），加载完成后淡入显示，
 *   避免紫色背景闪烁（用户体验：一下子就出现头像）
 * - 唤醒引擎运行时：外圈脉冲动画（提示用户正在聆听唤醒词）
 * - 唤醒冷却期：灰度滤镜（提示冷却中）
 * - 悬停：轻微放大 + 阴影增强
 */

import { memo, useState, useEffect } from 'react'

// ============================================
// 类型定义
// ============================================

export interface AvatarStaticProps {
  /** 唤醒引擎是否正在运行（显示脉冲指示） */
  wakeWordActive: boolean
  /** 是否处于冷却期 */
  cooling: boolean
  /** 是否正在识别唤醒词 */
  transcribing: boolean
  /** 鼠标是否悬停 */
  isHovered: boolean
  /** 语言（影响提示文案，此处预留） */
  language: 'zh' | 'en'
}

// ============================================
// 组件
// ============================================

function AvatarStaticImpl({
  wakeWordActive,
  cooling,
  transcribing,
  isHovered,
}: AvatarStaticProps) {
  const [iconSrc, setIconSrc] = useState<string>('')
  const [iconLoaded, setIconLoaded] = useState(false)
  const [iconError, setIconError] = useState(false)

  // 加载品牌图标
  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/'
    setIconSrc(`${base}brand/icons/sizes/app/128.png`)
  }, [])

  const isBusy = cooling || transcribing
  // 整个组件在图片加载完成（或失败）后才显示，避免紫色背景闪烁
  const visible = iconLoaded || iconError

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.15s ease-in',
      }}
    >
      {/* 外圈脉冲（唤醒引擎运行时） */}
      {visible && wakeWordActive && !isBusy && (
        <div
          style={{
            position: 'absolute',
            inset: '-4px',
            borderRadius: '50%',
            border: '2px solid rgba(139, 92, 246, 0.4)',
            animation: 'avatar-static-pulse 2s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* 识别中脉冲（更快） */}
      {visible && transcribing && (
        <div
          style={{
            position: 'absolute',
            inset: '-4px',
            borderRadius: '50%',
            border: '2px solid rgba(96, 165, 250, 0.6)',
            animation: 'avatar-static-pulse 1s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* 主体圆形头像 */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          // 图片加载失败时显示渐变兜底；成功时透明（图片撑满）
          background: iconError
            ? (cooling
                ? 'radial-gradient(circle at 35% 30%, #6b7280 0%, #4b5563 55%, #374151 100%)'
                : 'radial-gradient(circle at 35% 30%, #a78bfa 0%, #7c3aed 50%, #4c1d95 100%)')
            : 'transparent',
          boxShadow: isHovered
            ? '0 0 12px rgba(124, 58, 237, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3)'
            : '0 0 8px rgba(124, 58, 237, 0.35), 0 1px 3px rgba(0, 0, 0, 0.2)',
          border: '2px solid rgba(255, 255, 255, 0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          filter: cooling ? 'grayscale(0.5)' : 'none',
          animation: wakeWordActive && !isBusy
            ? 'avatar-static-breathe 3s ease-in-out infinite'
            : 'none',
          overflow: 'hidden',
          transform: isHovered ? 'scale(1.06)' : 'scale(1)',
        }}
      >
        {/* 品牌图标 - 撑满整个圆球 */}
        {iconSrc && !iconError ? (
          <img
            src={iconSrc}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
              filter: cooling ? 'grayscale(0.5)' : 'none',
            }}
            onLoad={() => setIconLoaded(true)}
            onError={() => setIconError(true)}
          />
        ) : (
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.9)',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              userSelect: 'none',
            }}
          >
            A
          </span>
        )}
      </div>

      <style>{`
        @keyframes avatar-static-pulse {
          0% {
            transform: scale(0.95);
            opacity: 0.8;
          }
          70% {
            transform: scale(1.15);
            opacity: 0;
          }
          100% {
            transform: scale(1.15);
            opacity: 0;
          }
        }
        @keyframes avatar-static-breathe {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.04);
          }
        }
      `}</style>
    </div>
  )
}

export const AvatarStatic = memo(AvatarStaticImpl)
