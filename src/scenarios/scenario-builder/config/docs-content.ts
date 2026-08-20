/**
 * 场景开发文档内容（结构化）
 *
 * 将 SCENARIO_DEV_KNOWLEDGE 解析为结构化的文档树，供 DocsBrowserPanel 展示：
 * - 章节（chapters）：一级标题 ## 一、xxx
 * - 子章节（sections）：二级标题 ### xxx
 *
 * 设计要点：
 * - 复用现有知识库内容，避免重复维护
 * - 自动解析，新增章节只需在 prompts-knowledge.ts 追加内容
 * - 提供 searchDocs 全文检索 API
 */
import { SCENARIO_DEV_KNOWLEDGE } from './prompts-knowledge'

// ==========================================
// 类型定义
// ==========================================

/** 文档子章节 */
export interface DocSection {
  /** 子章节 ID（slug） */
  id: string
  /** 子章节标题 */
  title: string
  /** Markdown 内容 */
  content: string
  /** 所属章节 ID */
  chapterId: string
}

/** 文档章节 */
export interface DocChapter {
  /** 章节 ID（slug） */
  id: string
  /** 章节标题（含序号，如"一、场景类型"） */
  title: string
  /** 章节序号（1-14） */
  order: number
  /** 图标名（lucide-react） */
  icon: string
  /** 子章节列表 */
  sections: DocSection[]
  /** 章节简介（用于目录树展示） */
  summary: string
}

/** 文档树 */
export interface DocTree {
  chapters: DocChapter[]
}

/** 搜索结果 */
export interface DocSearchResult {
  /** 匹配的章节 ID */
  chapterId: string
  /** 匹配的子章节 ID（若命中子章节） */
  sectionId?: string
  /** 章节标题 */
  chapterTitle: string
  /** 子章节标题 */
  sectionTitle?: string
  /** 匹配片段（前后各 50 字符） */
  snippet: string
}

// ==========================================
// 章节元信息（手动维护，提供图标与简介）
// ==========================================

interface ChapterMeta {
  /** 章节序号中文（一、二、三...） */
  prefix: string
  /** 图标名 */
  icon: string
  /** 简介 */
  summary: string
}

const CHAPTER_META: ChapterMeta[] = [
  { prefix: '一', icon: 'Layers', summary: '声明式 vs 编程式，如何选择' },
  { prefix: '二', icon: 'FolderTree', summary: '项目目录结构与文件职责' },
  { prefix: '三', icon: 'FileJson', summary: 'scenario.json 字段完整说明' },
  { prefix: '四', icon: 'PenLine', summary: '系统提示词四要素与示例' },
  { prefix: '五', icon: 'Code2', summary: '编程式场景的核心接口' },
  { prefix: '六', icon: 'Plug', summary: '场景运行时上下文 API' },
  { prefix: '七', icon: 'Wrench', summary: 'ScenarioToolDefinition 结构' },
  { prefix: '八', icon: 'Database', summary: 'install/uninstall 脚本规范' },
  { prefix: '九', icon: 'LayoutDashboard', summary: 'panels / sidebarItems 配置' },
  { prefix: '十', icon: 'Activity', summary: 'onActivate/onDeactivate/HealthCheck' },
  { prefix: '十一', icon: 'Package', summary: '构建打包与发布流程' },
  { prefix: '十二', icon: 'Lightbulb', summary: '场景开发最佳实践' },
  { prefix: '十三', icon: 'Workflow', summary: '从需求到发布的完整流程' },
  { prefix: '十四', icon: 'HelpCircle', summary: '常见问题答疑' },
]

// ==========================================
// 解析逻辑
// ==========================================

/** 中文数字 → 阿拉伯数字映射 */
const CN_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14,
}

/** 将中文序号转为阿拉伯数字 */
function chineseToNumber(cn: string): number {
  return CN_NUM_MAP[cn] ?? 0
}

/** 生成 slug：将标题转为 kebab-case ID */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60)
}

/**
 * 解析 SCENARIO_DEV_KNOWLEDGE 为结构化文档树
 *
 * 规则：
 * - 一级标题 ## 一、xxx → 章节
 * - 二级标题 ### xxx → 子章节
 * - 子章节内容为该标题到下一个 ## 或 ### 之间的所有文本
 */
function parseDocTree(content: string): DocTree {
  const chapters: DocChapter[] = []
  const lines = content.split('\n')

  let currentChapter: DocChapter | null = null
  let currentSection: DocSection | null = null
  let contentBuffer: string[] = []

  /** 提交当前正在累积的内容到 currentSection 或 currentChapter */
  const flushBuffer = () => {
    const text = contentBuffer.join('\n').trim()
    if (currentSection) {
      currentSection.content = text
    } else if (currentChapter) {
      // 章节首页内容（无子章节的部分）
      if (!currentChapter.sections.length) {
        // 章节无子章节时，整个内容作为虚拟 section
        currentChapter.sections.push({
          id: currentChapter.id,
          title: currentChapter.title,
          content: text,
          chapterId: currentChapter.id,
        })
      }
    }
    contentBuffer = []
  }

  for (const line of lines) {
    // 一级标题：## 一、xxx 或 ## 二、xxx
    const chapterMatch = line.match(/^##\s+([一二三四五六七八九十]+)、\s*(.+)$/)
    if (chapterMatch) {
      // 提交上一个 section / chapter 的内容
      flushBuffer()
      if (currentSection) {
        currentChapter?.sections.push(currentSection)
        currentSection = null
      }
      if (currentChapter) {
        chapters.push(currentChapter)
      }

      const prefix = chapterMatch[1]
      const title = `${prefix}、${chapterMatch[2].trim()}`
      const order = chineseToNumber(prefix)
      const meta = CHAPTER_META.find((m) => m.prefix === prefix)
      currentChapter = {
        id: slugify(title),
        title,
        order,
        icon: meta?.icon || 'FileText',
        summary: meta?.summary || '',
        sections: [],
      }
      continue
    }

    // 二级标题：### xxx
    const sectionMatch = line.match(/^###\s+(.+)$/)
    if (sectionMatch) {
      // 提交上一个 section 的内容
      flushBuffer()
      if (currentSection && currentChapter) {
        currentChapter.sections.push(currentSection)
      }

      const sectionTitle = sectionMatch[1].trim()
      currentSection = {
        id: slugify(sectionTitle),
        title: sectionTitle,
        content: '',
        chapterId: currentChapter?.id ?? '',
      }
      continue
    }

    // 累积内容
    contentBuffer.push(line)
  }

  // 提交最后一个 section / chapter
  flushBuffer()
  if (currentSection && currentChapter) {
    currentChapter.sections.push(currentSection)
  }
  if (currentChapter) {
    chapters.push(currentChapter)
  }

  return { chapters }
}

// ==========================================
// 单例文档树
// ==========================================

/** 解析后的文档树（懒加载） */
let cachedDocTree: DocTree | null = null

/**
 * 获取文档树（懒加载，首次调用解析，后续返回缓存）
 */
export function getDocTree(): DocTree {
  if (!cachedDocTree) {
    cachedDocTree = parseDocTree(SCENARIO_DEV_KNOWLEDGE)
  }
  return cachedDocTree
}

/**
 * 根据 chapterId 获取章节
 */
export function getChapterById(chapterId: string): DocChapter | null {
  return getDocTree().chapters.find((c) => c.id === chapterId) ?? null
}

/**
 * 根据 chapterId + sectionId 获取子章节
 */
export function getSectionById(chapterId: string, sectionId: string): DocSection | null {
  const chapter = getChapterById(chapterId)
  if (!chapter) return null
  return chapter.sections.find((s) => s.id === sectionId) ?? null
}

/**
 * 全文搜索文档
 *
 * 搜索范围：章节标题 + 子章节标题 + 子章节内容
 * 返回前 20 条匹配结果，每条包含匹配片段（前后各 50 字符）
 */
export function searchDocs(query: string, maxResults = 20): DocSearchResult[] {
  const kw = query.toLowerCase().trim()
  if (!kw) return []

  const results: DocSearchResult[] = []
  const snippetRadius = 50

  for (const chapter of getDocTree().chapters) {
    // 章节标题命中
    if (chapter.title.toLowerCase().includes(kw)) {
      results.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        snippet: chapter.summary || chapter.title,
      })
    }

    for (const section of chapter.sections) {
      // 子章节标题命中
      if (section.title.toLowerCase().includes(kw)) {
        results.push({
          chapterId: chapter.id,
          sectionId: section.id,
          chapterTitle: chapter.title,
          sectionTitle: section.title,
          snippet: section.content.split('\n').slice(0, 2).join('\n'),
        })
        continue
      }

      // 内容命中
      const lowerContent = section.content.toLowerCase()
      const idx = lowerContent.indexOf(kw)
      if (idx >= 0) {
        const start = Math.max(0, idx - snippetRadius)
        const end = Math.min(section.content.length, idx + kw.length + snippetRadius)
        const snippet = (start > 0 ? '...' : '') +
          section.content.slice(start, end) +
          (end < section.content.length ? '...' : '')
        results.push({
          chapterId: chapter.id,
          sectionId: section.id,
          chapterTitle: chapter.title,
          sectionTitle: section.title,
          snippet,
        })
      }

      if (results.length >= maxResults) break
    }
    if (results.length >= maxResults) break
  }

  return results
}
