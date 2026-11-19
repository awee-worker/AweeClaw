/**
 * 会话产物（Artifact）提取
 *
 * 工具卡默认折叠，AI 跑完一轮后用户只能看到一行「已完成」，生成的图片 / 视频 /
 * 音频 / 文档实际埋在一次点击之下。这里把一次工具调用产出的文件从两处来源提取
 * 成结构化产物，交给 ArtifactCardStrip 在会话流里直接展示：
 *
 *   1. richContent —— 工具主动上报的富内容（截图、生成图、媒体片段）
 *   2. 结果文本与参数 —— MCP 插件、脚本类工具只回一句「已保存到 /path/x.mp4」
 *
 * 只认绝对路径：相对路径在渲染进程无法解析成真实位置，误判会把普通文本里的
 * `./a.png` 当成产物。视图类 / 代码编辑类工具不参与提取，避免读一个文件就冒出一张卡片。
 *
 * @module chatMessage/artifacts/artifactModel
 */

import type { ToolCall } from '@intelligence/providerTypes'
import {
  detectMediaKind,
  fileUrlToPath,
  getExtension,
  isAbsoluteFilePath,
  isRenderableMediaKind,
  toRenderableMediaUrl,
  type MediaKind,
} from '@utils/localMediaUrl'

/** 产物卡片类型（不含 other） */
export type ArtifactKind = Exclude<MediaKind, 'other'>

/** 一个可展示的会话产物 */
export interface ChatArtifact {
  /** 稳定标识，同一路径在同一轮里只出现一次 */
  id: string
  kind: ArtifactKind
  /** 卡片标题（文件名或富内容标题） */
  title: string
  /** 可渲染地址：local-preview:// / data: / https: */
  src: string | null
  /** 本地绝对路径（有则可「在文件夹中显示 / 用系统程序打开」） */
  filePath: string
  mimeType?: string
  /** 产出它的工具名，用于卡片上的来源说明 */
  sourceTool: string
  /** 附加说明（如富内容里的标题） */
  note?: string
}

/**
 * 不产出文件类产物的工具
 *
 * 这些工具要么只读文本、要么改动代码、要么本身就是审批 / 任务控制，
 * 它们结果里出现的路径是「输入」或「引用」，不是本轮生成物。
 */
const NON_PRODUCING_TOOLS = new Set([
  'read_file', 'read_multiple_files', 'list_directory', 'search_files',
  'codebase_search', 'read_url', 'web_search', 'image_search', 'video_search',
  'uiux_search', 'uiux_recommend', 'write_file', 'edit_file',
  'create_file_or_folder', 'delete_file_or_folder', 'apply_skill',
  'todo_write', 'remember', 'get_lint_errors', 'find_references',
  'go_to_definition', 'get_hover_info', 'get_document_symbols',
  'ask_user', 'offer_continuation', 'schedule', 'run_command',
  'send_terminal_input', 'stop_terminal', 'read_terminal_output',
  'knowledge_search', 'mail_read', 'mail_send',
])

/** 单次工具调用最多提取的产物数（防止批量脚本一次刷屏） */
const MAX_PER_TOOL = 6

/** 单个工具组最多展示的产物数 */
export const MAX_PER_GROUP = 12

/**
 * 结果文本里的文件路径
 *
 * 只匹配以 / 或盘符开头的绝对路径，扩展名限定为媒体与文档：
 * 代码文件（.ts/.js）不在这里，因为「改了一个文件」不属于会话产物。
 *
 * 前置的负向后行断言不可省略：`./output/a.png` 内部含 `/output/a.png`，
 * 若只要求「以 / 开头」，相对路径会被切出一段当成绝对路径，凭空生成产物卡。
 */
const ARTIFACT_PATH_RE =
  /(?<![.\w/\\-])(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>|*?()\[\]{}]+\.(?:png|jpe?g|gif|webp|bmp|svg|avif|mp4|webm|mov|mkv|m4v|ogv|avi|3gp|mp3|wav|flac|ogg|m4a|aac|opus|pdf|docx?|xlsx?|pptx?|csv|md|txt|html?)/gi

/** 富内容里的裸 base64 需要补成 data: 地址才能直接放进 src */
function toDataUrl(data: string | undefined, mimeType: string | undefined, fallbackMime: string): string | null {
  if (!data) return null
  if (data.startsWith('data:')) return data
  return `data:${mimeType || fallbackMime};base64,${data}`
}

/** 从路径取文件名（用于卡片标题） */
function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  return name || filePath
}

/** 还原文本里的转义反斜杠（JSON 结果里 Windows 路径是双反斜杠） */
function unescapePath(value: string): string {
  return value.replace(/\\\\/g, '\\')
}

/** 把扩展名映射为产物类型；非产物返回 null */
function resolveKind(raw: string): ArtifactKind | null {
  const localPath = fileUrlToPath(raw)
  const kind = detectMediaKind(localPath)
  return kind === 'other' ? null : kind
}

/** 从富内容里取产物 */
function collectFromRichContent(toolCall: ToolCall): ChatArtifact[] {
  const items = toolCall.richContent
  if (!items || items.length === 0) return []

  const result: ChatArtifact[] = []
  items.forEach((item, index) => {
    const tool = toolCall.name
    const push = (kind: ArtifactKind, src: string | null, filePath: string, fallbackTitle: string) => {
      result.push({
        id: `${toolCall.id}#rich${index}`,
        kind,
        title: item.title || (filePath ? baseName(filePath) : fallbackTitle),
        src,
        filePath,
        mimeType: item.mimeType,
        sourceTool: tool,
        note: item.title && filePath ? baseName(filePath) : undefined,
      })
    }

    if (item.type === 'image' || item.type === 'video' || item.type === 'audio') {
      // 三个来源依次尝试：uri 路径、data 里已带前缀的完整地址、data 里的裸 base64。
      // 生成类工具普遍以上报裸 base64 为主（不带 data: 前缀），少了最后一步，
      // 这类产物会因「取不到地址」被整条丢弃。
      const fallbackMime =
        item.type === 'video' ? 'video/mp4' : item.type === 'audio' ? 'audio/mpeg' : 'image/png'
      const src =
        toRenderableMediaUrl(item.uri) ??
        toRenderableMediaUrl(item.data) ??
        toDataUrl(item.data, item.mimeType, fallbackMime)
      const filePath = item.uri && isAbsoluteFilePath(fileUrlToPath(item.uri)) ? fileUrlToPath(item.uri) : ''
      if (!src && !filePath) return
      push(item.type, src, filePath, item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : '音频')
      return
    }

    // file 类型只收媒体与文档；代码文件不是会话产物
    if (item.type === 'file' && item.uri) {
      const kind = resolveKind(item.uri)
      if (!kind) return
      const filePath = isAbsoluteFilePath(fileUrlToPath(item.uri)) ? fileUrlToPath(item.uri) : ''
      push(kind, isRenderableMediaKind(kind) ? toRenderableMediaUrl(item.uri) : null, filePath, baseName(item.uri))
    }
  })
  return result
}

/** 从结果文本与参数里扫绝对路径 */
function collectFromText(toolCall: ToolCall): ChatArtifact[] {
  const sources: string[] = []
  if (toolCall.result) sources.push(toolCall.result)
  // 参数里也常带输出路径（如 output_path），但只取字符串值，避免嵌套对象乱序
  try {
    sources.push(JSON.stringify(toolCall.arguments))
  } catch {
    // arguments 不可序列化时忽略
  }
  if (sources.length === 0) return []

  const seen = new Set<string>()
  const result: ChatArtifact[] = []

  for (const text of sources) {
    const matches = text.match(ARTIFACT_PATH_RE)
    if (!matches) continue
    for (const raw of matches) {
      const filePath = unescapePath(raw)
      if (!isAbsoluteFilePath(filePath)) continue
      const kind = resolveKind(filePath)
      if (!kind) continue
      if (seen.has(filePath)) continue
      seen.add(filePath)
      result.push({
        id: `${toolCall.id}::${filePath}`,
        kind,
        title: baseName(filePath),
        src: isRenderableMediaKind(kind) ? toRenderableMediaUrl(filePath) : null,
        filePath,
        mimeType: undefined,
        sourceTool: toolCall.name,
      })
      if (result.length >= MAX_PER_TOOL) return result
    }
  }
  return result
}

/**
 * 从一组工具调用中提取产物
 *
 * 顺序即工具调用顺序，同一条产物（同路径 / 同地址）只保留首次出现。
 *
 * @param toolCalls 工具组内的调用（已执行完成才有产物）
 * @returns 去重后的产物列表，最多 MAX_PER_GROUP 个
 */
export function collectArtifacts(toolCalls: ToolCall[]): ChatArtifact[] {
  if (!toolCalls || toolCalls.length === 0) return []

  const seen = new Set<string>()
  const artifacts: ChatArtifact[] = []

  for (const toolCall of toolCalls) {
    if (NON_PRODUCING_TOOLS.has(toolCall.name)) continue
    if (toolCall.status !== 'success') continue

    const candidates = [...collectFromRichContent(toolCall), ...collectFromText(toolCall)]
    for (const artifact of candidates) {
      const key = artifact.filePath || artifact.src || artifact.id
      if (seen.has(key)) continue
      seen.add(key)
      artifacts.push(artifact)
      if (artifacts.length >= MAX_PER_GROUP) return artifacts
    }
  }

  return artifacts
}

/** 产物类型 → 中文/英文标签 */
export function artifactKindLabel(kind: ArtifactKind, isZh: boolean): string {
  const zh: Record<ArtifactKind, string> = {
    image: '图片', video: '视频', audio: '音频', document: '文档',
  }
  const en: Record<ArtifactKind, string> = {
    image: 'Image', video: 'Video', audio: 'Audio', document: 'Document',
  }
  return isZh ? zh[kind] : en[kind]
}

/** 取文件扩展名（大写，用于文档卡角标） */
export function artifactExtension(filePath: string): string {
  return getExtension(filePath).toUpperCase()
}
