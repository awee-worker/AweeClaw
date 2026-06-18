/**
 * 多模态视觉分析结果预览组件
 * 在聊天中展示图片分析、截图解读、图表识别结果
 */
import { memo } from 'react'
import { Eye, Image, BarChart3, FileText, Loader2, Check, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'

export interface VisionAnalysisResult {
  analysisType: 'general' | 'screenshot' | 'chart'
  description?: string
  labels?: string[]
  objects?: { name: string; confidence: number }[]
  text?: string
  chartData?: { type: string; title: string; data: Record<string, unknown> }
  error?: string
}

interface VisionAnalyzePreviewProps {
  imageBase64?: string
  imageUrl?: string
  result?: VisionAnalysisResult
  loading?: boolean
  onClose?: () => void
}

export const VisionAnalyzePreview = memo(function VisionAnalyzePreview({
  imageBase64,
  imageUrl,
  result,
  loading,
  onClose,
}: VisionAnalyzePreviewProps) {
  const src = imageUrl || (imageBase64 ? `data:image/png;base64,${imageBase64}` : null)

  if (!src && !result && !loading) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-bg-elevated overflow-hidden"
    >
      {/* 图片预览区 */}
      {src && (
        <div className="relative bg-black/40 rounded-t-xl overflow-hidden" style={{ maxHeight: 240 }}>
          <img
            src={src}
            alt="Analysis preview"
            className="w-full object-contain"
            style={{ maxHeight: 240 }}
          />
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-2 right-2 p-1 rounded-lg bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* 分析结果区 */}
      <div className="p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
            <span>正在分析图片...</span>
          </div>
        ) : result?.error ? (
          <div className="flex items-start gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{result.error}</span>
          </div>
        ) : result ? (
          <div className="space-y-2">
            {/* 分析类型标签 */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                result.analysisType === 'chart'
                  ? 'bg-amber-400/10 text-amber-400'
                  : result.analysisType === 'screenshot'
                  ? 'bg-cyan-400/10 text-cyan-400'
                  : 'bg-violet-400/10 text-violet-400'
              }`}>
                {result.analysisType === 'chart' ? <BarChart3 className="w-3 h-3" /> :
                 result.analysisType === 'screenshot' ? <Image className="w-3 h-3" /> :
                 <Eye className="w-3 h-3" />}
                {result.analysisType === 'chart' ? '图表解读' :
                 result.analysisType === 'screenshot' ? '截图分析' : '图片分析'}
              </span>
              <Check className="w-3.5 h-3.5 text-green-400" />
            </div>

            {/* 描述 */}
            {result.description && (
              <p className="text-sm text-text-primary leading-relaxed">{result.description}</p>
            )}

            {/* 识别对象 */}
            {result.objects && result.objects.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.objects.map((obj, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-full text-[10px] bg-violet-400/10 text-violet-400"
                    title={`置信度: ${(obj.confidence * 100).toFixed(0)}%`}
                  >
                    {obj.name}
                  </span>
                ))}
              </div>
            )}

            {/* 提取文字 */}
            {result.text && (
              <div className="p-2 rounded-lg bg-bg-base text-xs text-text-secondary max-h-24 overflow-y-auto">
                <div className="flex items-center gap-1 mb-1 text-[10px] text-text-muted">
                  <FileText className="w-3 h-3" /> 提取文字
                </div>
                {result.text}
              </div>
            )}

            {/* 标签 */}
            {result.labels && result.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.labels.map((label, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-400/10 text-gray-400">
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </motion.div>
  )
})