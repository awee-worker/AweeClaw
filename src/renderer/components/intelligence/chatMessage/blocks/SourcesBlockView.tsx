/**
 * 来源列表视图
 * 展示引用来源（URL 或文档），支持点击打开
 */
import React from 'react'
import { Link2 } from 'lucide-react'
import { openUrlInBrowser } from '@utils/browserLauncher'
import type { LLMStreamSource } from '@shared/protocols/modelGateway'

interface SourcesBlockViewProps {
  sources: LLMStreamSource[]
}

/** 获取来源链接 */
function getSourceHref(source: LLMStreamSource): string | null {
  return source.sourceType === 'url' && source.url ? source.url : null
}

/** 获取来源显示名称 */
function getSourceLabel(source: LLMStreamSource): string {
  return source.title || source.filename || source.url || source.id
}

function SourcesBlockViewBase({ sources }: SourcesBlockViewProps) {
  if (sources.length === 0) return null

  return (
    <div className="my-3 rounded-xl border border-border/60 bg-surface/30 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-muted">
        <Link2 className="h-3.5 w-3.5" />
        Sources
      </div>
      <div className="space-y-1.5">
        {sources.map((source) => {
          const href = getSourceHref(source)
          const label = getSourceLabel(source)
          const meta = source.sourceType === 'document'
            ? source.mediaType || source.filename
            : source.url

          return (
            <div
              key={source.id || `${source.sourceType}:${label}`}
              className="rounded-lg border border-border/50 bg-background/35 px-2.5 py-2"
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm font-medium text-accent transition-colors hover:text-accent-hover hover:underline"
                  onClick={(e) => {
                    e.preventDefault()
                    openUrlInBrowser(href)
                  }}
                >
                  {label}
                </a>
              ) : (
                <div className="text-sm font-medium text-text-primary">{label}</div>
              )}
              {meta && (
                <div className="mt-0.5 break-all text-[12px] text-text-muted">
                  {meta}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const SourcesBlockView = React.memo(SourcesBlockViewBase)
SourcesBlockView.displayName = 'SourcesBlockView'
