import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Loader2, FileSpreadsheet } from 'lucide-react'
import { Button } from '../ui'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { api } from '@/renderer/services/electronAPI'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

interface PdfPreviewProps {
  path: string
}

export function PdfPreview({ path }: PdfPreviewProps) {
  const language = useStore(s => s.language)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true)
        setError(false)
        const base64 = await api.file.readBinary(path)
        if (!base64) {
          setError(true)
          return
        }
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const loadingTask = pdfjsLib.getDocument({ data: bytes })
        const doc = await loadingTask.promise
        setPdfDoc(doc)
        setTotalPages(doc.numPages)
        setCurrentPage(1)
      } catch (e) {
        console.error('Failed to load PDF:', e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    loadPdf()
  }, [path])

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return
    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
      const page = await pdfDoc.getPage(currentPage)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.height = viewport.height
      canvas.width = viewport.width
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
      })
      renderTaskRef.current = renderTask
      await renderTask.promise
      renderTaskRef.current = null
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') {
        console.error('Failed to render page:', e)
      }
    }
  }, [pdfDoc, currentPage, scale])

  useEffect(() => {
    renderPage()
  }, [renderPage])

  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
    }
  }, [])

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const zoomIn = () => setScale(s => Math.min(4, s + 0.25))
  const zoomOut = () => setScale(s => Math.max(0.5, s - 0.25))
  const fitWidth = () => setScale(1.5)

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 border-b border-border bg-surface/50">
        <Button variant="ghost" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="h-7 px-2">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs text-text-muted min-w-[80px] text-center">
          {currentPage} / {totalPages}
        </span>
        <Button variant="ghost" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="h-7 px-2">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="sm" onClick={zoomOut} className="h-7 px-2">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-xs text-text-muted w-12 text-center">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={zoomIn} className="h-7 px-2">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={fitWidth} className="h-7 px-2">
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto flex justify-center p-4 bg-surface/20">
        <canvas ref={canvasRef} className="shadow-lg" />
      </div>
    </div>
  )
}
