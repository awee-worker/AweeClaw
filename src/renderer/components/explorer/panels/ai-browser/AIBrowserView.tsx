/**
 * AIBrowserView — AI 浏览器（宽屏面板）
 *
 * 通用助手场景左侧导航的「AI 浏览器」入口，把「搜索 → 浏览 → 交给 AI」串成一条链路：
 *   1. 检索：复用设置页配置的搜索引擎（主进程 httpTransport 统一调度，
 *      引擎启用顺序与主引擎由设置决定），支持网页 / 图片 / 视频三类检索；
 *   2. 浏览：点击结果在内置浏览器（webview）中打开，不跳出客户端；
 *   3. AI：把检索主题或某条结果交给 AI 助手继续调研 / 解读。
 *
 * 布局结构：
 * ┌────────────┬──────────────────────────────────────┐
 * │  检索类型   │  标题栏（当前类型 + 当前搜索引擎）      │
 * │   网页      │  ────────────────────────            │
 * │   图片      │  搜索框                               │
 * │   视频      │  ────────────────────────            │
 * │  ──────     │  结果区（滚动）                        │
 * │  搜索历史   │                                      │
 * └────────────┴──────────────────────────────────────┘
 *
 * 说明：
 * - 检索不在此处实现引擎逻辑，直接调用 api.http.webSearch / imageSearch / videoSearch，
 *   与 AI 工具的 web_search / image_search / video_search 走同一条通道，避免两套行为。
 * - 图片 / 视频检索目前由 SearXNG 系引擎提供；使用其它引擎时主进程会返回不支持提示，
 *   这里原样展示，不额外包装成"错误"。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  BookOpen,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  History,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  Newspaper,
  Play,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useStore } from '@store'
import { getBuiltinSearchEngine } from '@shared/configuration/searchProviders'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { toast } from '@components/foundation/NotificationProvider'
import { useAgentActions, useThreadMessenger } from '@hooks/useAgent'

/** 内部浏览器（AI 浏览器内嵌展示，浏览网页时不卸载检索结果） */
const InternalBrowser = lazy(() => import('@components/browser/InternalBrowser'))

type SearchType = 'web' | 'smart' | 'news' | 'academic' | 'encyclopedia' | 'images' | 'videos'

interface WebResultItem {
  title: string
  url: string
  snippet: string
  content?: string
  publishedDate?: string
  engine?: string
  sourceName?: string
  sourceType?: string
}

interface ImageResultItem {
  title: string
  url: string
  imgSrc: string
  thumbnailSrc?: string
  source?: string
  imgSize?: string
}

interface VideoResultItem {
  title: string
  url: string
  thumbnail?: string
  length?: string
  author?: string
  source?: string
  publishedDate?: string
}

/** 搜索历史本地缓存键（仅存查询词，不涉及检索结果） */
const HISTORY_KEY = 'aweeclaw:ai-browser:history'
const HISTORY_LIMIT = 20

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function saveHistory(list: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    /* 存储不可用时静默降级：历史仅作为便捷入口，不影响检索 */
  }
}

/* ------------------------------------------------------------------ */
/* 分页去重与结果判定                                                   */
/* ------------------------------------------------------------------ */

/**
 * 归一化 URL 作为去重键：忽略协议、www、末尾斜杠与查询串差异。
 *
 * 分页结果里同一个页面常以 http/https、带不带 www、带不带 utm 参数等
 * 多种形态出现，不归一化会在「加载更多」时反复插入同一条。
 */
function normalizeUrlKey(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./i, '').toLowerCase()
    const pathname = u.pathname.replace(/\/+$/, '')
    return `${host}${pathname}`.toLowerCase()
  } catch {
    return s.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '')
  }
}

/**
 * 标题相似度（字符集合 Jaccard），与主进程 resultRanker 的去重思路一致。
 * 纯 URL 去重挡不住「同一内容换了 URL」的结果，这里作为第二道兜底。
 */
function titleSimilarity(a: string, b: string): number {
  const s1 = (a || '').trim().toLowerCase()
  const s2 = (b || '').trim().toLowerCase()
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1
  const set1 = new Set(s1)
  const set2 = new Set(s2)
  let intersection = 0
  for (const c of set1) {
    if (set2.has(c)) intersection++
  }
  const union = set1.size + set2.size - intersection
  return union > 0 ? intersection / union : 0
}

/** 合并分页结果：先按 URL 归一化去重，再用标题相似度兜底，返回新增条数 */
function mergeUnique<T>(
  prev: T[],
  incoming: T[],
  keyOf: (item: T) => string,
  titleOf: (item: T) => string,
): { items: T[]; added: number } {
  const TITLE_THRESHOLD = 0.85
  const seenKeys = new Set(prev.map((i) => normalizeUrlKey(keyOf(i))).filter(Boolean))
  const seenTitles = prev.map((i) => titleOf(i)).filter(Boolean)

  const items = [...prev]
  let added = 0
  for (const item of incoming) {
    const key = normalizeUrlKey(keyOf(item))
    if (key && seenKeys.has(key)) continue

    const title = titleOf(item)
    if (title && seenTitles.some((t) => titleSimilarity(t, title) >= TITLE_THRESHOLD)) continue

    if (key) seenKeys.add(key)
    if (title) seenTitles.push(title)
    items.push(item)
    added++
  }
  return { items, added }
}

/**
 * 直链媒体判断：只有命中常见音视频扩展名才允许直接下载。
 * B 站 / YouTube 这类播放页地址下不了真实媒体，需要提示用户在页面内操作。
 */
function isDirectMediaUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return /\.(mp4|webm|ogv|ogg|mov|m4v|mp3|m4a|flac|flv|mkv|m3u8|ts)$/.test(pathname)
  } catch {
    return false
  }
}

/** 从学术结果的 content（形如「[PDF]: https://…」，见 smartSearchDispatcher）提取 PDF 直链 */
function extractPdfUrl(item: WebResultItem): string | null {
  const match = (item.content || '').match(/\[PDF\]:\s*(\S+)/i)
  return match ? match[1] : null
}

/**
 * 全屏图片预览（远程直链）
 *
 * 右上角是一整块操作栏（下载 / 打开来源 / AI 解读 / 关闭），单独抽出成带 z-index
 * 的容器并阻断冒泡：否则按钮会被图片容器盖住导致点击无效，点击也会穿透到遮罩把
 * 弹层关掉。遮罩只在点到自身时关闭，双击图片区域不误关。
 */
function ImageLightbox({
  item,
  isZh,
  downloading,
  aiBusy,
  onClose,
  onDownload,
  onOpenSource,
  onAskAI,
}: {
  item: ImageResultItem
  isZh: boolean
  downloading: boolean
  aiBusy: boolean
  onClose: () => void
  onDownload: () => void
  onOpenSource: () => void
  onAskAI: () => void
}) {
  // Esc 关闭：键盘操作与「点不到关闭按钮」时的兜底
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const actionBtn =
    'w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-all flex items-center justify-center'

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => {
          // 只有点到遮罩本身才关闭，点图片区域不关
          if (e.target === e.currentTarget) onClose()
        }}
        className="no-drag fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 p-8"
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
      >
        {/*
          图片容器整体不接收指针事件：竖图 / 宽图的高度可接近整个视口，
          容器盒会向上顶到右上角操作栏一带，把按钮下半部分的点击吃掉
          （表现为「鼠标要放到按钮中上部才点得中」）。
          这里只让真正需要右键另存、选中复制的图片与标题文字恢复 pointer-events。
        */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3 pointer-events-none"
        >
          <img
            src={item.imgSrc}
            alt={item.title}
            referrerPolicy="no-referrer"
            className="pointer-events-auto max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
          />
          {item.title && (
            <div className="pointer-events-auto text-[12px] text-white/70 max-w-[80vw] truncate">
              {item.title}
            </div>
          )}
        </motion.div>

        {/* 右上角操作栏：z-index 高于图片容器，点击不冒泡到遮罩 */}
        <div
          className="absolute top-6 right-6 flex items-center gap-2 z-[100000]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDownload()
            }}
            disabled={downloading}
            title={isZh ? '下载图片' : 'Download image'}
            aria-label={isZh ? '下载图片' : 'Download image'}
            className={actionBtn}
          >
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSource()
            }}
            title={isZh ? '打开来源页' : 'Open source page'}
            aria-label={isZh ? '打开来源页' : 'Open source page'}
            className={actionBtn}
          >
            <Link2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAskAI()
            }}
            disabled={aiBusy}
            title={isZh ? 'AI 解读' : 'AI explain'}
            aria-label={isZh ? 'AI 解读' : 'AI explain'}
            className={actionBtn}
          >
            {aiBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            title={isZh ? '关闭' : 'Close'}
            aria-label={isZh ? '关闭' : 'Close'}
            className={actionBtn}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

/**
 * 走智能搜索分发器的专业检索类型 → 强制领域
 *
 * 'general' 表示不限定领域，由分发器根据查询内容自动识别。
 * 切勿写成 'auto'：在分发器的领域字典里 'auto' 指「汽车」，会被当成强制领域
 * 并追加汽车门户的 site: 限定检索（搜任何内容都会夹带一批汽车资讯）。
 * 新闻 / 学术 / 百科是用户显式选择的检索类型，按类型强制对应领域。
 */
const SMART_DOMAINS: Partial<Record<SearchType, string>> = {
  smart: 'general',
  news: 'news',
  academic: 'academic',
  encyclopedia: 'encyclopedia',
}

const TYPE_META: Record<SearchType, { icon: LucideIcon; labelZh: string; label: string; hintZh: string; hint: string }> = {
  smart: {
    icon: Sparkles,
    labelZh: '智能',
    label: 'Smart',
    hintZh: '自动识别领域，聚合专业来源',
    hint: 'Auto domain detection with vertical sources',
  },
  web: {
    icon: Globe,
    labelZh: '网页',
    label: 'Web',
    hintZh: '检索网页内容与资讯',
    hint: 'Search pages and news',
  },
  news: {
    icon: Newspaper,
    labelZh: '新闻',
    label: 'News',
    hintZh: '检索最新新闻与热点事件',
    hint: 'Latest news and hot events',
  },
  academic: {
    icon: GraduationCap,
    labelZh: '学术',
    label: 'Academic',
    hintZh: '检索论文、专利与学术文献',
    hint: 'Papers, patents and academic literature',
  },
  encyclopedia: {
    icon: BookOpen,
    labelZh: '百科',
    label: 'Wiki',
    hintZh: '检索百科词条与背景资料',
    hint: 'Encyclopedia entries and background',
  },
  images: {
    icon: ImageIcon,
    labelZh: '图片',
    label: 'Images',
    hintZh: '检索图片素材与配图',
    hint: 'Search images',
  },
  videos: {
    icon: Video,
    labelZh: '视频',
    label: 'Videos',
    hintZh: '检索视频内容',
    hint: 'Search videos',
  },
}

export function AIBrowserView() {
  const language = useStore((s) => s.language)
  const webSearchConfig = useStore((s) => s.webSearchConfig)
  const openInternalBrowser = useStore((s) => s.openInternalBrowser)
  /** 内置浏览器 URL：非空时在右侧内嵌展示（由本面板承载，避免卸载检索结果） */
  const internalBrowserUrl = useStore((s) => s.internalBrowserUrl)
  const isZh = language === 'zh'

  const { createThread } = useAgentActions()
  const { sendToThread } = useThreadMessenger()

  const [type, setType] = useState<SearchType>('smart')
  const [query, setQuery] = useState('')
  /** 最近一次完成检索的关键词；空串表示尚未检索 */
  const [searchedQuery, setSearchedQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [webItems, setWebItems] = useState<WebResultItem[]>([])
  const [imageItems, setImageItems] = useState<ImageResultItem[]>([])
  const [videoItems, setVideoItems] = useState<VideoResultItem[]>([])
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set())
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const [aiBusy, setAiBusy] = useState(false)
  /** 已加载到第几页（从 1 开始），用于「加载更多」翻页 */
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 服务端已无更多结果：该页原始返回为空 */
  const [exhausted, setExhausted] = useState(false)
  /** 正在下载的资源键（imgSrc/视频 url），避免重复点击 */
  const [downloading, setDownloading] = useState<string | null>(null)
  /** 图片全屏预览：保存整条结果，预览层要复用下载 / 来源页 / AI 解读 */
  const [lightbox, setLightbox] = useState<ImageResultItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 当前生效的搜索引擎名称 */
  const engineName = useMemo(() => {
    const id = webSearchConfig?.activeSearchEngine || 'aweeclaw-searxng'
    const def = getBuiltinSearchEngine(id)
    if (def) return isZh ? def.displayNameZh : def.displayName
    return id
  }, [webSearchConfig?.activeSearchEngine, isZh])

  /** 网页 / 智能 / 新闻 / 学术 / 百科 共用 webItems（智能搜索结果结构一致） */
  const isWebLike = type === 'web' || !!SMART_DOMAINS[type]
  const resultCount = isWebLike ? webItems.length : type === 'images' ? imageItems.length : videoItems.length
  /**
   * 是否已执行过检索
   *
   * 不能只看结果条数：检索到 0 条时也应落在「未找到相关结果」，
   * 而不是退回「输入关键词开始检索」的初始引导态，否则用户会误以为检索没触发。
   */
  const hasSearched = searchedQuery.length > 0

  const clearResults = useCallback(() => {
    setWebItems([])
    setImageItems([])
    setVideoItems([])
    setBrokenImages(new Set())
    // 清空结果即回到「未检索」状态，避免残留关键词让界面停在「未找到相关结果」
    setSearchedQuery('')
  }, [])

  /**
   * 按类型 + 页码拉取一页结果（页码从 1 开始）。
   *
   * 主进程侧仅 SearXNG 系引擎支持翻页；其余引擎会忽略 page 返回首页内容，
   * 由合并阶段的去重兜底，不会出现重复条目。
   */
  const fetchPage = useCallback(
    async (
      q: string,
      searchType: SearchType,
      pageNum: number,
    ): Promise<{ web: WebResultItem[]; images: ImageResultItem[]; videos: VideoResultItem[] }> => {
      const smartDomain = SMART_DOMAINS[searchType]
      if (smartDomain) {
        // 专业检索：交给主进程智能搜索分发器，携带强制领域（'auto' 表示自动识别）与页码
        const res = await api.http.smartSearch(q, 12, smartDomain, pageNum)
        if (!res.success) throw new Error(res.error || (isZh ? '智能搜索失败' : 'Smart search failed'))
        return { web: (res.results || []) as WebResultItem[], images: [], videos: [] }
      }
      if (searchType === 'web') {
        const res = await api.http.webSearch(q, 12, undefined, pageNum)
        if (!res.success) throw new Error(res.error || (isZh ? '搜索失败' : 'Search failed'))
        return { web: (res.results || []) as WebResultItem[], images: [], videos: [] }
      }
      if (searchType === 'images') {
        const res = await api.http.imageSearch(q, 15, undefined, pageNum)
        if (!res.success) throw new Error(res.error || (isZh ? '图片搜索失败' : 'Image search failed'))
        return { web: [], images: (res.results || []) as ImageResultItem[], videos: [] }
      }
      const res = await api.http.videoSearch(q, 12, undefined, pageNum)
      if (!res.success) throw new Error(res.error || (isZh ? '视频搜索失败' : 'Video search failed'))
      return { web: [], images: [], videos: (res.results || []) as VideoResultItem[] }
    },
    [isZh],
  )

  /** 首页检索：重置分页状态后拉取第 1 页 */
  const runSearch = useCallback(
    async (rawQuery: string, searchType: SearchType) => {
      const q = rawQuery.trim()
      if (!q) return

      setQuery(q)
      setLoading(true)
      setError(null)
      setPage(1)
      setExhausted(false)
      setLightbox(null)
      clearResults()

      try {
        const { web, images, videos } = await fetchPage(q, searchType, 1)
        setWebItems(web)
        setImageItems(images)
        setVideoItems(videos)

        setHistory((prev) => {
          const next = [q, ...prev.filter((item) => item !== q)].slice(0, HISTORY_LIMIT)
          saveHistory(next)
          return next
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        logger.ui.error('[AIBrowser] Search failed:', e)
      } finally {
        setLoading(false)
        setSearchedQuery(q)
      }
    },
    [clearResults, fetchPage, isZh],
  )

  /**
   * 加载下一页：合并时按 URL 归一化 + 标题相似度去重。
   * 该页原始返回为空即判定「没有更多了」；若返回的条目全是重复项，则继续允许翻页。
   */
  const loadMore = useCallback(async () => {
    const q = query.trim()
    if (!q || loading || loadingMore || exhausted) return

    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const { web, images, videos } = await fetchPage(q, type, nextPage)
      const rawCount = web.length + images.length + videos.length

      if (isWebLike) {
        setWebItems((prev) => mergeUnique(prev, web, (i) => i.url, (i) => i.title).items)
      } else if (type === 'images') {
        setImageItems((prev) => mergeUnique(prev, images, (i) => i.imgSrc || i.url, (i) => i.title).items)
      } else {
        setVideoItems((prev) => mergeUnique(prev, videos, (i) => i.url, (i) => i.title).items)
      }

      setPage(nextPage)
      if (rawCount === 0) setExhausted(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg)
      logger.ui.error('[AIBrowser] Load more failed:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [query, type, page, loading, loadingMore, exhausted, isWebLike, fetchPage])

  /**
   * 切换检索类型：只切类型并清空上一类型的残留结果，不自动发起检索。
   *
   * 自动重检会与用户正在输入的关键词抢节奏（切一下就发一次请求），
   * 且关键词与新闻/学术/图片等新类型往往并不匹配，白白浪费一次检索。
   * 切换后停在空态提示，由用户确认关键词再点搜索或回车。
   */
  const handleTypeChange = useCallback(
    (next: SearchType) => {
      setType(next)
      setError(null)
      setPage(1)
      setExhausted(false)
      setLightbox(null)
      clearResults()
    },
    [clearResults],
  )


  const handleClearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [])

  /** 在内置浏览器中打开（不跳出客户端） */
  const openResult = useCallback(
    (url: string, title: string) => {
      if (!url) return
      openInternalBrowser(url, title)
    },
    [openInternalBrowser],
  )

  /** 用系统浏览器打开 */
  const openExternal = useCallback((url: string) => {
    if (!url) return
    try {
      void api.file.openExternalUrl(url)
    } catch {
      /* 忽略：外部打开失败不影响面板内浏览 */
    }
  }, [])

  /** 打开设置页的「搜索引擎」Tab */
  const openSearchSettings = useCallback(() => {
    const store = useStore.getState()
    store.setSettingsIntent({ tab: 'search' })
    store.setActiveSidePanel(null)
    store.setShowSettingsPage(true)
  }, [])

  /** 把一段任务交给 AI 助手：新建对话并直接发起 */
  const handOffToAI = useCallback(
    async (prompt: string) => {
      if (aiBusy) return
      setAiBusy(true)
      try {
        const threadId = createThread({ activate: true })
        const store = useStore.getState()
        store.closeInternalBrowser()
        store.setActiveSidePanel(null)
        store.closeAllFullPages()
        store.setChatVisible(true)
        await sendToThread(prompt, threadId)
      } catch (e) {
        logger.ui.error('[AIBrowser] Failed to hand off to AI:', e)
        toast.error(isZh ? '交给 AI 失败，请重试' : 'Failed to hand off to AI')
      } finally {
        setAiBusy(false)
      }
    },
    [aiBusy, createThread, sendToThread, isZh],
  )

  const askAIResearch = useCallback(() => {
    const q = query.trim()
    if (!q) return
    const prompt = isZh
      ? `请帮我调研「${q}」这个主题：先用 web_search 检索最新资料，再挑 2-3 个最有价值的来源用 read_url 阅读，最后给我一份结构化的中文总结（核心结论、关键事实、来源链接）。`
      : `Research the topic "${q}": use web_search to gather up-to-date sources, read the 2-3 most valuable ones with read_url, then give me a structured summary (key takeaways, facts and source links).`
    void handOffToAI(prompt)
  }, [query, isZh, handOffToAI])

  const askAIAboutResult = useCallback(
    (item: WebResultItem) => {
      const prompt = isZh
        ? `请阅读并解读这个网页：${item.url}\n标题：${item.title}\n用中文给出结构化要点总结，并指出其中值得关注的信息。`
        : `Read and explain this page: ${item.url}\nTitle: ${item.title}\nGive me a structured summary and highlight what matters.`
      void handOffToAI(prompt)
    },
    [isZh, handOffToAI],
  )

  const askAIAboutImage = useCallback(
    (item: ImageResultItem) => {
      const prompt = isZh
        ? `请解读这张图片：${item.imgSrc}\n来源页：${item.url}\n标题：${item.title}\n用中文说明画面内容、可能的用途，并指出值得注意的细节。`
        : `Explain this image: ${item.imgSrc}\nSource page: ${item.url}\nTitle: ${item.title}\nDescribe what it shows, its likely use, and anything noteworthy.`
      void handOffToAI(prompt)
    },
    [isZh, handOffToAI],
  )

  /**
   * 下载远程资源到本地（图片直链 / 视频直链 / 附件）
   *
   * referer 传来源页：不少图床按 Referer 校验防盗链，缺了会直接 403 导致「下不动」。
   */
  const handleDownload = useCallback(
    async (url: string, name: string, key: string, referer?: string) => {
      if (!url || downloading) return
      setDownloading(key)
      try {
        const res = await api.http.downloadFile(url, name, referer)
        if (res.success) {
          toast.success(isZh ? '已保存到本地' : 'Saved to disk')
        } else if (!res.canceled) {
          // 用户在保存对话框取消时不提示错误
          toast.error(res.error || (isZh ? '下载失败' : 'Download failed'))
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setDownloading(null)
      }
    },
    [downloading, isZh],
  )

  /** 视频下载：仅直链可下；播放页地址给出提示，引导在内置浏览器或原页面处理 */
  const handleVideoDownload = useCallback(
    (item: VideoResultItem, key: string) => {
      if (!isDirectMediaUrl(item.url)) {
        toast.info(
          isZh ? '该来源为播放页，无法直接下载' : 'This is a playback page',
          isZh
            ? '请在内置浏览器中播放，或从原页面下载'
            : 'Play it in the built-in browser, or download from the original page',
        )
        return
      }
      void handleDownload(item.url, item.title, key)
    },
    [handleDownload, isZh],
  )

  const currentMeta = TYPE_META[type]

  return (
    <div className="flex h-full w-full relative">
      {/* 左侧：检索类型 + 搜索历史 */}
      <div className="bg-surface/30 backdrop-blur-xl flex flex-col pt-10 pb-6 w-56 border-r border-border/40 shadow-xl shadow-black/10">
        <nav className="flex-1 min-h-0 flex flex-col gap-4 px-4 overflow-y-auto no-scrollbar">
          <div className="space-y-1">
            <div className="px-2 pb-1.5 text-[11px] font-bold text-text-muted uppercase tracking-wider">
              {isZh ? '检索类型' : 'Search type'}
            </div>
            {(Object.keys(TYPE_META) as SearchType[]).map((key) => {
              const meta = TYPE_META[key]
              const Icon = meta.icon
              const active = type === key
              return (
                <button
                  key={key}
                  onClick={() => handleTypeChange(key)}
                  title={isZh ? meta.hintZh : meta.hint}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                    active
                      ? 'bg-accent/10 text-text-primary border border-accent/20'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
                  }`}
                >
                  <span className={active ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span>{isZh ? meta.labelZh : meta.label}</span>
                </button>
              )
            })}
          </div>

          {history.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-2 pb-1.5">
                <History className="w-3 h-3 text-text-muted" />
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                  {isZh ? '搜索历史' : 'History'}
                </span>
                <button
                  onClick={handleClearHistory}
                  title={isZh ? '清空历史' : 'Clear history'}
                  className="ml-auto w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {history.map((item) => (
                <button
                  key={item}
                  onClick={() => void runSearch(item, type)}
                  title={item}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors text-left"
                >
                  <Clock className="w-3 h-3 shrink-0 text-text-muted" />
                  <span className="truncate">{item}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
      </div>

      {/* 右侧：检索结果 / 内置浏览器（浏览网页时保留检索状态） */}
      <div className="flex-1 min-h-0 flex flex-col">
        {internalBrowserUrl ? (
          <Suspense fallback={null}>
            <InternalBrowser />
          </Suspense>
        ) : (
        <div className="flex-1 w-full flex flex-col min-w-0 min-h-0 relative">
          {/* 顶部标题栏 */}
          <div className="shrink-0 px-8 pt-10 pb-4 border-b border-border/40 drag-region">
            <div className="no-drag flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                  {isZh ? 'AI 浏览器' : 'AI Browser'}
                </h3>
                <p className="text-sm text-text-muted mt-1.5 opacity-80">
                  {isZh ? currentMeta.hintZh : currentMeta.hint}
                </p>
              </div>
              <button
                onClick={openSearchSettings}
                title={isZh ? '配置搜索引擎' : 'Configure search engines'}
                className="shrink-0 mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-text-secondary border border-border/40 hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>{isZh ? `搜索引擎：${engineName}` : `Engine: ${engineName}`}</span>
              </button>
            </div>
          </div>

          {/* 搜索框 */}
          <div className="shrink-0 px-8 py-4 border-b border-border/30">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2 h-10 px-3 rounded-xl bg-text-primary/[0.04] border border-border/40 focus-within:border-accent/50 transition-colors">
                <Search className="w-4 h-4 text-text-muted shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch(query, type)
                  }}
                  spellCheck={false}
                  disabled={loading}
                  placeholder={
                    isZh ? `用 ${engineName} 搜索${currentMeta.labelZh}…` : `Search ${currentMeta.label} with ${engineName}…`
                  }
                  className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-text-primary placeholder:text-text-muted/60"
                />
                {query && !loading && (
                  <button
                    onClick={() => {
                      setQuery('')
                      clearResults()
                      setError(null)
                      inputRef.current?.focus()
                    }}
                    title={isZh ? '清空' : 'Clear'}
                    className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                onClick={() => void runSearch(query, type)}
                disabled={loading || !query.trim()}
                className="shrink-0 h-10 px-5 rounded-xl text-[13px] font-medium text-white bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {isZh ? '搜索' : 'Search'}
              </button>

              <button
                onClick={askAIResearch}
                disabled={!query.trim() || aiBusy}
                title={isZh ? '把该主题交给 AI 助手深入调研' : 'Hand this topic to the AI assistant'}
                className="shrink-0 h-10 px-4 rounded-xl text-[13px] font-medium text-accent border border-accent/30 bg-accent/10 hover:bg-accent/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isZh ? '交给 AI' : 'Ask AI'}
              </button>
            </div>

            {hasSearched && resultCount > 0 && !loading && !error && (
              <div className="mt-2.5 text-[11px] text-text-muted">
                {isZh
                  ? `基于「${query}」的${currentMeta.labelZh}结果：${resultCount} 条`
                  : `${currentMeta.label} results for "${query}": ${resultCount}`}
              </div>
            )}
          </div>

          {/* 结果区 */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-8 py-6">
            {loading && (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin mb-2 text-accent" />
                <p className="text-xs">{isZh ? '正在检索…' : 'Searching…'}</p>
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <AlertCircle className="w-6 h-6 text-status-error mb-2" />
                <p className="text-xs text-status-error max-w-md break-words">{error}</p>
                <p className="text-[11px] text-text-muted mt-2 max-w-md">
                  {isZh
                    ? '可在设置中启用其它搜索引擎，或确认该引擎是否支持此类检索。'
                    : 'Enable another search engine in settings, or check whether it supports this search type.'}
                </p>
              </div>
            )}

            {!loading && !error && !hasSearched && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
                  <Search className="w-5 h-5 text-accent" />
                </div>
                <p className="text-sm font-medium text-text-primary">
                  {isZh ? '输入关键词开始检索' : 'Enter a keyword to start'}
                </p>
                <p className="text-[11px] text-text-muted mt-1.5 max-w-sm leading-relaxed">
                  {isZh
                    ? '支持网页、智能、新闻、学术、百科、图片、视频检索；点击结果会在内置浏览器中打开，也可以直接交给 AI 助手继续调研。'
                    : 'Search web, smart, news, academic, wiki, images and videos. Results open in the built-in browser, or hand them to the AI assistant.'}
                </p>
              </div>
            )}

            {!loading && !error && hasSearched && resultCount === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <p className="text-xs">{isZh ? '没有找到相关结果，换个关键词试试' : 'No results. Try another keyword.'}</p>
              </div>
            )}

            {/* 网页结果 */}
            {!loading && !error && isWebLike && webItems.length > 0 && (
              <div className="space-y-2.5">
                {webItems.map((item, index) => {
                  const pdfUrl = extractPdfUrl(item)
                  return (
                    <div
                      key={`${item.url}-${index}`}
                      className="group rounded-xl border border-border/30 bg-surface/40 hover:border-accent/40 hover:bg-surface-hover transition-colors p-4"
                    >
                      <button
                        onClick={() => openResult(item.url, item.title)}
                        className="block w-full text-left"
                      >
                        <div className="text-sm font-medium text-accent group-hover:underline break-words">
                          {item.title || item.url}
                        </div>
                        <div className="text-[11px] text-text-muted mt-0.5 truncate">{item.url}</div>
                        {item.snippet && (
                          <p className="text-[12px] text-text-secondary mt-2 leading-relaxed break-words">{item.snippet}</p>
                        )}
                        {/* 学术结果的 content 是「[PDF]: url」标记，改用下方按钮暴露，不当作正文展示 */}
                        {item.content && !pdfUrl && (
                          <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed line-clamp-3 break-words">
                            {item.content}
                          </p>
                        )}
                      </button>
                      <div className="flex items-center gap-2 mt-2.5">
                        {(item.sourceName || item.engine) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-text-primary/[0.06] text-text-muted">
                            {item.sourceName || item.engine}
                          </span>
                        )}
                        {item.publishedDate && (
                          <span className="text-[10px] text-text-muted">{item.publishedDate}</span>
                        )}
                        {/* 学术结果：直接暴露 PDF 链接，在内置浏览器中打开 */}
                        {pdfUrl && (
                          <button
                            onClick={() => openResult(pdfUrl, item.title)}
                            title={isZh ? '在内置浏览器中打开 PDF' : 'Open PDF in built-in browser'}
                            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-accent border border-accent/25 bg-accent/10 hover:bg-accent/15 transition-colors"
                          >
                            <FileText className="w-3 h-3" />
                            PDF
                          </button>
                        )}
                        <div className="ml-auto flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => askAIAboutResult(item)}
                            disabled={aiBusy}
                            className="h-7 px-2.5 rounded-lg text-[11px] text-accent border border-accent/25 bg-accent/10 hover:bg-accent/15 disabled:opacity-40 transition-colors flex items-center gap-1"
                          >
                            <Sparkles className="w-3 h-3" />
                            {isZh ? 'AI 解读' : 'AI Explain'}
                          </button>
                          <button
                            onClick={() => openExternal(item.url)}
                            title={isZh ? '用系统浏览器打开' : 'Open in system browser'}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}


            {/* 图片结果：点击预览大图，悬浮提供「下载 / 打开来源页 / 放大 / AI 解读」 */}
            {!loading && !error && type === 'images' && imageItems.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {imageItems.map((item, index) => {
                  const key = `${item.imgSrc}-${index}`
                  const broken = brokenImages.has(key)
                  const preview = item.thumbnailSrc || item.imgSrc
                  const isDownloading = downloading === key
                  return (
                    <div
                      key={key}
                      className="group relative rounded-xl overflow-hidden border border-border/30 bg-surface/40 hover:border-accent/40 transition-colors"
                    >
                      {/* 图片区用 div 承载点击（内部还有悬浮操作按钮，避免 button 嵌套） */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!broken) setLightbox(item)
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !broken) {
                            e.preventDefault()
                            setLightbox(item)
                          }
                        }}
                        title={item.title}
                        className="relative w-full aspect-[4/3] bg-text-primary/[0.04] overflow-hidden flex items-center justify-center cursor-zoom-in"
                      >
                        {broken ? (
                          <ImageIcon className="w-6 h-6 text-text-muted" />
                        ) : (
                          <img
                            src={preview}
                            alt={item.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenImages((prev) => {
                                const next = new Set(prev)
                                next.add(key)
                                return next
                              })
                            }
                            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                          />
                        )}
                        {/* 悬浮操作条：图片可用时才出现，覆盖在图片底部 */}
                        {!broken && (
                          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 p-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownload(item.imgSrc, item.title, key, item.url)
                              }}
                              disabled={isDownloading}
                              title={isZh ? '下载图片' : 'Download image'}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/90 hover:bg-white/20 disabled:opacity-50 transition-colors"
                            >
                              {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                openResult(item.url || item.imgSrc, item.title)
                              }}
                              title={isZh ? '打开来源页' : 'Open source page'}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/90 hover:bg-white/20 transition-colors"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setLightbox(item)
                              }}
                              title={isZh ? '放大预览' : 'Zoom in'}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/90 hover:bg-white/20 transition-colors"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                askAIAboutImage(item)
                              }}
                              disabled={aiBusy}
                              title={isZh ? 'AI 解读' : 'AI explain'}
                              className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-white/90 hover:bg-white/20 disabled:opacity-50 transition-colors"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="p-2.5">
                        <div className="text-[11px] text-text-primary truncate">{item.title || item.source || item.url}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {item.source && (
                            <span className="text-[10px] text-text-muted truncate">{item.source}</span>
                          )}
                          {item.imgSize && (
                            <span className="ml-auto text-[10px] text-text-muted shrink-0">{item.imgSize}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 视频结果：点击缩略图在内置浏览器播放，悬浮/底部提供「下载 / 系统浏览器打开」 */}
            {!loading && !error && type === 'videos' && videoItems.length > 0 && (
              <div className="space-y-2.5">
                {videoItems.map((item, index) => {
                  const key = `${item.url}-${index}`
                  const isDownloading = downloading === key
                  const direct = isDirectMediaUrl(item.url)
                  return (
                    <div
                      key={key}
                      className="group rounded-xl border border-border/30 bg-surface/40 hover:border-accent/40 hover:bg-surface-hover transition-colors p-3"
                    >
                      <div className="flex items-stretch gap-3">
                        <button
                          onClick={() => openResult(item.url, item.title)}
                          title={isZh ? '在内置浏览器中播放' : 'Play in built-in browser'}
                          className="relative w-40 shrink-0 aspect-video rounded-lg overflow-hidden bg-text-primary/[0.06] flex items-center justify-center"
                        >
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Video className="w-5 h-5 text-text-muted" />
                          )}
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/30 transition-colors">
                            <Play className="w-6 h-6 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
                          </span>
                        </button>
                        <div className="min-w-0 flex-1 py-0.5 flex flex-col">
                          <button
                            onClick={() => openResult(item.url, item.title)}
                            className="text-left text-[13px] font-medium text-text-primary group-hover:text-accent transition-colors line-clamp-2 break-words"
                          >
                            {item.title || item.url}
                          </button>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {item.author && <span className="text-[11px] text-text-secondary truncate">{item.author}</span>}
                            {item.length && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-text-primary/[0.06] text-text-muted">
                                {item.length}
                              </span>
                            )}
                            {item.source && <span className="text-[10px] text-text-muted">{item.source}</span>}
                            {item.publishedDate && <span className="text-[10px] text-text-muted">{item.publishedDate}</span>}
                          </div>
                          <div className="mt-auto pt-2 flex items-center gap-1.5">
                            <button
                              onClick={() => handleVideoDownload(item, key)}
                              disabled={isDownloading}
                              title={
                                direct
                                  ? (isZh ? '下载视频' : 'Download video')
                                  : (isZh ? '该来源为播放页，无法直接下载' : 'Playback page — cannot download directly')
                              }
                              className="h-7 px-2.5 rounded-lg text-[11px] text-text-secondary border border-border/40 hover:text-text-primary hover:bg-text-primary/[0.06] disabled:opacity-50 transition-colors flex items-center gap-1"
                            >
                              {isDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              {isZh ? '下载' : 'Download'}
                            </button>
                            <button
                              onClick={() => openExternal(item.url)}
                              title={isZh ? '用系统浏览器打开' : 'Open in system browser'}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 加载更多：翻页拉取下一页，合并时按 URL 归一化 + 标题相似度去重 */}
            {!loading && !error && resultCount > 0 && (
              <div className="mt-5 flex flex-col items-center gap-2">
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore || exhausted}
                  className="h-9 px-5 rounded-xl text-[12px] font-medium text-text-secondary border border-border/40 hover:text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {isZh ? '加载中…' : 'Loading…'}
                    </>
                  ) : exhausted ? (
                    isZh ? '没有更多了' : 'No more results'
                  ) : (
                    isZh ? '加载更多' : 'Load more'
                  )}
                </button>
                <span className="text-[11px] text-text-muted">
                  {isZh ? `已加载 ${resultCount} 条` : `${resultCount} loaded`}
                </span>
              </div>
            )}

          </div>
        </div>
        )}
      </div>

      {/* 图片全屏预览：经 createPortal 渲染到 body，避免被结果区滚动容器裁剪 */}
      {lightbox && (
        <ImageLightbox
          item={lightbox}
          isZh={isZh}
          downloading={downloading === `lb:${lightbox.imgSrc}`}
          aiBusy={aiBusy}
          onClose={() => setLightbox(null)}
          onDownload={() =>
            handleDownload(lightbox.imgSrc, lightbox.title, `lb:${lightbox.imgSrc}`, lightbox.url)
          }
          onOpenSource={() => openResult(lightbox.url || lightbox.imgSrc, lightbox.title)}
          onAskAI={() => askAIAboutImage(lightbox)}
        />
      )}
    </div>
  )
}

export default AIBrowserView
