/**
 * 记忆系统设置入口（Tab 容器）
 *
 * v3.0 重构：从原列表式 UI 升级为多 Tab 容器，整合：
 *  - 记忆列表（列表/网格/时间轴/图谱/3D 五种视图）
 *  - 统计面板（健康度环形图 + 分类分布 + 概览统计）
 *  - 健康报告（完整健康度面板 + 优化建议）
 *  - 设置面板（遗忘引擎 + 分类规则 + 隐私选项 + 保留策略）
 *  - 隐私清除（多范围记忆清除 + 预览确认）
 *
 * 兼容性：保留 language 入参以兼容 PreferencesDialog 调用约定，
 * 实际多语言文案由子组件内部硬编码（后续可扩展为 i18n）。
 */
import { lazy, Suspense } from 'react'
import type { Language } from '@renderer/i18n'

// 懒加载记忆系统主页面（含 3D 场景等重组件，避免影响设置面板首屏）
const MemoryPage = lazy(() =>
  import('@components/memory/MemoryPage').then(m => ({ default: m.default })),
)

interface MemorySettingsProps {
  language: Language
}

export function MemorySettings({ language: _language }: MemorySettingsProps) {
  // language 参数保留用于未来 i18n 扩展，当前子组件使用硬编码中文
  void _language

  return (
    <div className="h-[calc(100vh-200px)] min-h-[600px] -mx-2 -my-2">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-text-muted">
            <div className="flex flex-col items-center gap-3">
              <div className="w-5 h-5 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">加载记忆系统...</span>
            </div>
          </div>
        }
      >
        <MemoryPage />
      </Suspense>
    </div>
  )
}
