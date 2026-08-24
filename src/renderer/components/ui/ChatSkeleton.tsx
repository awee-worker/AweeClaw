/**
 * 聊天界面骨架屏组件
 *
 * 严格对齐真实聊天消息的排版结构：
 *
 * 真实布局（参考 ChatMessage.tsx + UserMessageView + AssistantMessageView）：
 * - 消息列表容器：max-w-[800px] mx-auto w-full
 * - 每条消息外层：w-full px-4 flex flex-col gap-1
 * - 用户消息：右对齐，py-1，圆角气泡 rounded-[20px] rounded-tr-[4px]，bg-surface + border-border/50 + shadow-sm
 * - 助手消息：左对齐，py-2，无气泡无头像，pl-1，prose-custom 文本块
 * - 用户文本：text-[14px] leading-relaxed
 * - 助手文本：text-[15px] leading-relaxed
 *
 * 设计特点：
 * 1. 流光扫过效果：线性渐变 + background-position 动画，模拟内容加载
 * 2. 严格对齐真实布局：相同的容器宽度、内边距、圆角、对齐方式
 * 3. 多变骨架块：不同长度、不同透明度，模拟自然段落
 * 4. 渐入动画：骨架块逐个延迟出现，有节奏感
 * 5. 主题适配：使用 CSS 变量，自动适配深浅色主题
 *
 * @module ui/ChatSkeleton
 */

import { memo, type CSSProperties } from 'react'

/* ------------------------------------------------------------------ */
/* 基础流光骨架块                                                      */
/* ------------------------------------------------------------------ */

interface ShimmerBlockProps {
  /** Tailwind 高度类，默认 h-3 */
  heightClass?: string
  /** Tailwind 宽度类或自定义值 */
  widthClass?: string
  /** 内联样式（用于设置精确宽度或动画延迟） */
  style?: CSSProperties
  /** 透明度级别 0-3，数值越大越透明 */
  opacity?: 0 | 1 | 2 | 3
  /** 圆角类 */
  roundedClass?: string
}

const OPACITY_MAP: Record<NonNullable<ShimmerBlockProps['opacity']>, string> = {
  0: '',
  1: 'opacity-90',
  2: 'opacity-70',
  3: 'opacity-50',
}

/**
 * 基础流光骨架块
 *
 * 使用 CSS 线性渐变 + background-position 动画实现流光扫过效果。
 * 相比 animate-pulse 的简单透明度变化，流光效果更接近真实内容加载。
 */
const ShimmerBlock = memo(
  ({
    heightClass = 'h-3',
    widthClass = 'w-full',
    style,
    opacity = 0,
    roundedClass = 'rounded',
  }: ShimmerBlockProps) => (
    <div
      className={`skeleton-block ${heightClass} ${widthClass} ${OPACITY_MAP[opacity]} ${roundedClass}`}
      style={style}
    />
  ),
)
ShimmerBlock.displayName = 'ShimmerBlock'

/* ------------------------------------------------------------------ */
/* 用户消息骨架                                                        */
/* ------------------------------------------------------------------ */

interface UserMessageSkeletonProps {
  /** 渐入动画延迟（毫秒） */
  delay?: number
  /** 文本行数 */
  lines?: number
}

/**
 * 用户消息骨架
 *
 * 严格对齐 UserMessageView 的真实布局：
 * - 外层：w-full flex flex-col items-end gap-1.5
 * - 内层：flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 w-full
 * - 气泡：bg-surface px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-sm w-fit border border-border/50
 * - 文本：text-[14px] leading-relaxed
 */
const UserMessageSkeleton = memo(({ delay = 0, lines = 2 }: UserMessageSkeletonProps) => (
  <div
    className="w-full flex flex-col items-end gap-1.5 skeleton-fade-in"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 w-full">
      {/* 气泡：严格匹配真实样式 */}
      <div className="relative bg-surface px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-border/50">
        <div className="space-y-2">
          {Array.from({ length: lines }, (_, i) => {
            const widths = ['w-32', 'w-24', 'w-28', 'w-20']
            return (
              <ShimmerBlock
                key={i}
                heightClass="h-[14px]"
                widthClass={widths[i % widths.length]}
                opacity={i % 2 === 0 ? 1 : 2}
              />
            )
          })}
        </div>
      </div>
    </div>
  </div>
))
UserMessageSkeleton.displayName = 'UserMessageSkeleton'

/* ------------------------------------------------------------------ */
/* 工具调用卡片骨架                                                    */
/* ------------------------------------------------------------------ */

/**
 * 工具调用卡片骨架
 *
 * 模拟助手消息中的工具调用预览卡片，包含工具名、状态行和参数预览。
 */
const ToolCallSkeleton = memo(({ delay = 0 }: { delay?: number }) => (
  <div
    className="w-full max-w-[90%] rounded-lg border border-border/40 bg-surface/40 overflow-hidden skeleton-fade-in"
    style={{ animationDelay: `${delay}ms` }}
  >
    {/* 工具头部：图标 + 工具名 + 状态 */}
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
      <div className="w-4 h-4 rounded skeleton-block opacity-70" />
      <ShimmerBlock heightClass="h-3" widthClass="w-24" opacity={1} />
      <div className="ml-auto flex items-center gap-1">
        <div className="w-2 h-2 rounded-full skeleton-block opacity-60" />
        <ShimmerBlock heightClass="h-3" widthClass="w-10" opacity={2} />
      </div>
    </div>
    {/* 参数预览区 */}
    <div className="p-3 space-y-1.5">
      <ShimmerBlock heightClass="h-3" widthClass="w-[85%]" opacity={2} />
      <ShimmerBlock heightClass="h-3" widthClass="w-[60%]" opacity={3} />
      <ShimmerBlock heightClass="h-3" widthClass="w-[70%]" opacity={2} />
    </div>
  </div>
))
ToolCallSkeleton.displayName = 'ToolCallSkeleton'

/* ------------------------------------------------------------------ */
/* 助手消息骨架                                                        */
/* ------------------------------------------------------------------ */

interface AssistantMessageSkeletonProps {
  /** 渐入动画延迟（毫秒） */
  delay?: number
  /** 是否包含工具调用卡片 */
  withToolCall?: boolean
  /** 文本行数 */
  lines?: number
}

/**
 * 助手消息骨架
 *
 * 严格对齐 AssistantMessageView 的真实布局：
 * - 外层：w-full min-w-0 flex flex-col gap-2
 * - 内容：w-full text-[15px] leading-relaxed text-text-primary/90 pl-1
 * - 包裹：prose-custom w-full max-w-none
 * - 无头像、无气泡背景，直接是左对齐文本块
 */
const AssistantMessageSkeleton = memo(
  ({ delay = 0, withToolCall = false, lines = 3 }: AssistantMessageSkeletonProps) => (
    <div
      className="w-full min-w-0 flex flex-col gap-2 skeleton-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
        <div className="prose-custom w-full max-w-none space-y-2">
          {/* 文本行占位：首行最长，末行最短，模拟自然段落 */}
          {Array.from({ length: lines }, (_, i) => {
            const widths = ['w-[85%]', 'w-[70%]', 'w-[45%]', 'w-[60%]', 'w-[30%]']
            return (
              <ShimmerBlock
                key={i}
                heightClass="h-[15px]"
                widthClass={widths[i % widths.length]}
                opacity={i % 2 === 0 ? 1 : 2}
              />
            )
          })}

          {/* 可选工具调用卡片 */}
          {withToolCall && <ToolCallSkeleton delay={delay + 100} />}
        </div>
      </div>
    </div>
  ),
)
AssistantMessageSkeleton.displayName = 'AssistantMessageSkeleton'

/* ------------------------------------------------------------------ */
/* 顶部标题栏骨架                                                      */
/* ------------------------------------------------------------------ */

/**
 * 顶部标题栏骨架
 *
 * 模拟聊天面板顶部的标题和操作按钮组。
 */
const ChatHeaderSkeleton = memo(() => (
  <div className="h-11 flex items-center justify-between px-4 border-b border-border/30 shrink-0">
    <div className="flex items-center gap-2">
      <div className="w-5 h-5 rounded skeleton-block opacity-70" />
      <ShimmerBlock heightClass="h-4" widthClass="w-16" opacity={1} />
    </div>
    <div className="flex items-center gap-1.5">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="w-5 h-5 rounded skeleton-block opacity-60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  </div>
))
ChatHeaderSkeleton.displayName = 'ChatHeaderSkeleton'

/* ------------------------------------------------------------------ */
/* 底部输入框骨架                                                      */
/* ------------------------------------------------------------------ */

/**
 * 底部输入框骨架
 *
 * 模拟聊天底部的输入区域，包含附件按钮、输入框和发送按钮。
 */
const ChatInputSkeleton = memo(() => (
  <div
    className="shrink-0 px-4 pb-4 pt-2 max-w-[840px] mx-auto w-full skeleton-fade-in"
    style={{ animationDelay: '400ms' }}
  >
    <div className="flex items-end gap-2 rounded-2xl border border-border/50 bg-surface/40 px-3 py-3">
      {/* 附件按钮占位 */}
      <div className="w-8 h-8 rounded-lg skeleton-block opacity-70 flex-shrink-0" />
      {/* 输入框占位 */}
      <div className="flex-1 space-y-1.5 py-1">
        <ShimmerBlock heightClass="h-3" widthClass="w-[60%]" opacity={2} />
        <ShimmerBlock heightClass="h-3" widthClass="w-[35%]" opacity={3} />
      </div>
      {/* 发送按钮占位 */}
      <div className="w-8 h-8 rounded-xl skeleton-block opacity-80 flex-shrink-0" />
    </div>
  </div>
))
ChatInputSkeleton.displayName = 'ChatInputSkeleton'

/* ------------------------------------------------------------------ */
/* 完整聊天骨架屏                                                      */
/* ------------------------------------------------------------------ */

/**
 * 完整聊天骨架屏
 *
 * 组合所有子组件，呈现完整的聊天界面加载占位。
 * 包含：消息列表（用户/AI 交替）+ 底部输入框。
 */
export const ChatSkeleton = memo(() => (
  <div className="h-full flex flex-col bg-background-chat">
    {/* 消息列表区：严格匹配真实容器结构 */}
    <div className="flex-1 overflow-hidden">
      <div className="max-w-[800px] mx-auto w-full px-4 py-2 flex flex-col gap-1">
        {/* 第一组：用户提问 + AI 回复（含工具调用） */}
        <div className="py-1">
          <UserMessageSkeleton delay={0} lines={2} />
        </div>
        <div className="py-2">
          <AssistantMessageSkeleton delay={80} withToolCall lines={3} />
        </div>

        {/* 第二组：用户追问 + AI 回复 */}
        <div className="py-1">
          <UserMessageSkeleton delay={160} lines={1} />
        </div>
        <div className="py-2">
          <AssistantMessageSkeleton delay={240} lines={4} />
        </div>

        {/* 第三组：用户 + AI（短回复） */}
        <div className="py-1">
          <UserMessageSkeleton delay={320} lines={2} />
        </div>
        <div className="py-2">
          <AssistantMessageSkeleton delay={400} lines={2} />
        </div>
      </div>
    </div>

    <ChatInputSkeleton />
  </div>
))
ChatSkeleton.displayName = 'ChatSkeleton'

/* ------------------------------------------------------------------ */
/* 消息列表骨架屏（仅消息区，不含标题栏和输入框）                       */
/* ------------------------------------------------------------------ */

/**
 * 聊天消息列表骨架屏
 *
 * 仅包含消息列表区域的骨架占位，适用于线程切换/加载时的过渡。
 * 用于 ChatPanel 中的 isSwitchingThread / isHydratingActiveThread 场景。
 *
 * 严格匹配真实消息列表的容器结构：
 * - 外层：max-w-[800px] mx-auto w-full
 * - 每条消息：px-4 + py-1(用户)/py-2(助手) + flex flex-col gap-1
 */
export const ChatMessagesSkeleton = memo(() => (
  <div className="h-full w-full overflow-hidden bg-background-chat">
    <div className="max-w-[800px] mx-auto w-full px-4 py-2 flex flex-col gap-1">
      {/* 第一组：用户提问 + AI 回复（含工具调用） */}
      <div className="py-1">
        <UserMessageSkeleton delay={0} lines={2} />
      </div>
      <div className="py-2">
        <AssistantMessageSkeleton delay={80} withToolCall lines={3} />
      </div>

      {/* 第二组：用户追问 + AI 回复 */}
      <div className="py-1">
        <UserMessageSkeleton delay={160} lines={1} />
      </div>
      <div className="py-2">
        <AssistantMessageSkeleton delay={240} lines={4} />
      </div>

      {/* 第三组：用户 + AI（短回复） */}
      <div className="py-1">
        <UserMessageSkeleton delay={320} lines={2} />
      </div>
      <div className="py-2">
        <AssistantMessageSkeleton delay={400} lines={2} />
      </div>
    </div>
  </div>
))
ChatMessagesSkeleton.displayName = 'ChatMessagesSkeleton'

/* ------------------------------------------------------------------ */
/* 对话骨架屏（别名，向后兼容）                                        */
/* ------------------------------------------------------------------ */

/** @deprecated 请使用 ChatMessagesSkeleton */
export const ConversationSkeleton = ChatMessagesSkeleton
