/**
 * ExecutionFilePreview — 执行窗口右侧「AI 产物文件预览」面板
 *
 * 职责：
 * - 从执行会话的消息流中提取 AI 创建/修改的文件（write_file / edit_file /
 *   create_file_or_folder / apply_diff 工具调用）
 * - 合并 TaskExecutionResult.deliverables（AI 末尾结构化输出的产出清单）
 * - 左侧文件列表（去重、按修改时间排序）+ 右侧预览区
 * - 预览复用 FilePreviewPanel 的 MarkdownPreview / ImagePreview / HtmlPreview /
 *   UnsupportedFile，支持代码、Markdown、图片、HTML 等
 *
 * 布局：
 * ┌─────────┬──────────────────────────────┐
 * │ 文件列表  │  预览区（Markdown / 图片 / 代码）│
 * │ (200px)  │  flex-1                      │
 * └─────────┴──────────────────────────────┘
 *
 * 数据来源：
 * 1. AssistantMessage.toolCalls → 提取文件操作工具的 path/file_path 参数
 * 2. AssistantMessage.parts → ToolCallPart 同上
 * 3. TaskExecutionResult.deliverables → 结构化产出文件列表
 * 4. ToolResultMessage.rawParams → 工具调用的原始参数（兜底）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Image as ImageIcon, FileCode, FilePlus, FileEdit,
  Loader2, FileQuestion, RefreshCw, ExternalLink,
} from 'lucide-react'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import {
  isAssistantMessage, isToolResultMessage,
  type ChatMessage,
} from '@intelligence/types/conversationModel'
import type { ToolCall } from '@shared/protocols/modelProtocol'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { getFileName } from '@shared/toolkit/pathHelper'
import {
  getFileType,
  MarkdownPreview,
  ImagePreview,
  VideoPreview,
  HtmlPreview,
  UnsupportedFile,
} from '@renderer/components/workspace-editor/FilePreviewPanel'
import {
  parseExecutionResult,
  type TaskExecutionResult,
} from '@renderer/components/explorer/panels/projects/taskQuality'

// ============================================
// 常量
// ============================================

/** 文件操作工具名集合（这些工具会产生/修改文件） */
const FILE_OPERATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'create_file_or_folder',
  'apply_diff',
])

/** 从工具调用参数中提取文件路径的候选字段名 */
const PATH_FIELDS = ['path', 'file_path', 'filePath', 'targetPath', 'target_path']

// ============================================
// 类型定义
// ============================================

/** 产物文件项 */
interface ArtifactFile {
  /** 去重用的唯一路径 */
  path: string
  /** 文件名（显示用） */
  name: string
  /** 操作类型：创建 / 编辑 */
  operation: 'create' | 'edit'
  /** 最后操作时间戳 */
  timestamp: number
  /** 来源：工具调用名 */
  toolName: string
}

// ============================================
// 工具函数
// ============================================

/**
 * 从 ToolCall.arguments 中提取文件路径
 *
 * 按候选字段名顺序查找，返回第一个非空字符串值。
 * create_file_or_folder 的路径若以 / 结尾表示创建目录，跳过。
 */
function extractFilePath(args: Record<string, unknown>): string | null {
  for (const field of PATH_FIELDS) {
    const val = args[field]
    if (typeof val === 'string' && val.trim().length > 0) {
      // create_file_or_folder 创建目录时路径以 / 结尾，不是文件
      if (val.endsWith('/') || val.endsWith('\\')) return null
      return val.trim()
    }
  }
  return null
}

/**
 * 判断工具调用是否为文件操作
 */
function isFileOperation(toolName: string): boolean {
  return FILE_OPERATION_TOOLS.has(toolName)
}

/**
 * 判断操作类型：write_file / create_file_or_folder → 创建；edit_file / apply_diff → 编辑
 */
function getOperationType(toolName: string): 'create' | 'edit' {
  if (toolName === 'edit_file' || toolName === 'apply_diff') return 'edit'
  return 'create'
}

/**
 * 从消息列表中提取所有产物文件（去重 + 按时间排序）
 *
 * 提取逻辑：
 * 1. 遍历 assistant 消息的 toolCalls 和 parts(ToolCallPart)
 * 2. 遍历 tool result 消息的 rawParams（兜底，部分场景 toolCalls 可能缺失）
 * 3. 合并 TaskExecutionResult.deliverables（末尾结构化产出）
 * 4. 同一路径多次操作 → 保留最后一次（更新时间戳和操作类型）
 */
function extractArtifactFiles(messages: ChatMessage[]): ArtifactFile[] {
  const fileMap = new Map<string, ArtifactFile>()

  for (const msg of messages) {
    // 1. Assistant 消息的 toolCalls 数组
    if (isAssistantMessage(msg)) {
      // toolCalls 字段
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (!isFileOperation(tc.name)) continue
          const filePath = extractFilePath(tc.arguments)
          if (!filePath) continue
          const existing = fileMap.get(filePath)
          const op = getOperationType(tc.name)
          // 保留最新操作：若已存在且新时间戳更晚则更新
          if (!existing || msg.timestamp >= existing.timestamp) {
            fileMap.set(filePath, {
              path: filePath,
              name: getFileName(filePath),
              operation: op,
              timestamp: msg.timestamp,
              toolName: tc.name,
            })
          }
        }
      }

      // parts 中的 ToolCallPart（流式过程中 toolCalls 可能尚未聚合）
      if (msg.parts) {
        for (const part of msg.parts) {
          if (part.type !== 'tool_call') continue
          const tc: ToolCall = part.toolCall
          if (!isFileOperation(tc.name)) continue
          const filePath = extractFilePath(tc.arguments)
          if (!filePath) continue
          const existing = fileMap.get(filePath)
          const op = getOperationType(tc.name)
          if (!existing || msg.timestamp >= existing.timestamp) {
            fileMap.set(filePath, {
              path: filePath,
              name: getFileName(filePath),
              operation: op,
              timestamp: msg.timestamp,
              toolName: tc.name,
            })
          }
        }
      }

      // 2. 从最后一条 assistant 消息解析结构化产出（deliverables）
      //    只在非流式状态时解析（流式中文本可能不完整）
      if (!msg.isStreaming && typeof msg.content === 'string') {
        const result: TaskExecutionResult | null = parseExecutionResult(msg.content)
        if (result?.deliverables) {
          for (const d of result.deliverables) {
            if (!d.path) continue
            const existing = fileMap.get(d.path)
            if (!existing) {
              // deliverables 中的文件可能未在工具调用中出现（AI 汇总）
              fileMap.set(d.path, {
                path: d.path,
                name: getFileName(d.path),
                operation: 'create',
                timestamp: msg.timestamp,
                toolName: 'deliverable',
              })
            }
          }
        }
      }
    }

    // 3. Tool result 消息的 rawParams（兜底）
    if (isToolResultMessage(msg) && msg.rawParams) {
      const toolName = msg.name
      if (!isFileOperation(toolName)) continue
      const filePath = extractFilePath(msg.rawParams)
      if (!filePath) continue
      const existing = fileMap.get(filePath)
      const op = getOperationType(toolName)
      if (!existing || msg.timestamp >= existing.timestamp) {
        fileMap.set(filePath, {
          path: filePath,
          name: getFileName(filePath),
          operation: op,
          timestamp: msg.timestamp,
          toolName,
        })
      }
    }
  }

  // 按时间排序（最早创建的在前）
  return Array.from(fileMap.values()).sort((a, b) => a.timestamp - b.timestamp)
}

// ============================================
// 文件图标选择
// ============================================

function getFileIcon(filePath: string, operation: 'create' | 'edit') {
  const fileType = getFileType(filePath)
  const IconClass = operation === 'create' ? FilePlus : FileEdit

  // 图片类型用图片图标
  if (fileType === 'image') return ImageIcon
  // 代码/文本类型用代码图标
  if (fileType === 'text' || fileType === 'markdown' || fileType === 'html') return FileCode
  // 其他用通用文件图标
  return IconClass
}

// ============================================
// 主组件
// ============================================

interface ExecutionFilePreviewProps {
  /** 当前激活的线程 ID */
  threadId: string
  /** 当前工作区路径（用于解析相对路径） */
  workspacePath?: string
  /** 产物文件列表变化回调（用于父组件决定是否显示面板） */
  onFilesChange?: (count: number) => void
  /** 外部选中的文件（如用户从文件树点击的文件），传入后直接选中预览，不加入文件列表 */
  externalFile?: { path: string; name: string } | null
}

export function ExecutionFilePreview({ threadId, workspacePath, onFilesChange, externalFile }: ExecutionFilePreviewProps) {
  // workspacePath 预留给后续相对路径解析（当前文件预览使用工具调用返回的绝对路径）
  void workspacePath

  // ─── 订阅线程消息 ───────────────────────────────────────
  const messages = useAgentStore(
    useShallow(state => state.threads[threadId]?.messages ?? EMPTY_MESSAGES),
  )

  // ─── 提取产物文件列表 ──────────────────────────────────
  const artifactFiles = useMemo(() => extractArtifactFiles(messages), [messages])

  // 通知父组件产物文件数量变化（用于决定是否显示面板）
  const onFilesChangeRef = useRef(onFilesChange)
  onFilesChangeRef.current = onFilesChange
  useEffect(() => {
    onFilesChangeRef.current?.(artifactFiles.length)
  }, [artifactFiles.length])

  // ─── 选中的文件 ────────────────────────────────────────
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // 外部文件变化时（用户从文件树点击），直接选中预览，不加入文件列表
  useEffect(() => {
    if (externalFile) {
      setSelectedPath(externalFile.path)
    }
  }, [externalFile])

  // 自动选中第一个产物文件（当有产物但未选中且无外部文件时）
  useEffect(() => {
    if (externalFile) return // 外部文件优先，不自动选中产物
    if (!selectedPath && artifactFiles.length > 0) {
      setSelectedPath(artifactFiles[0].path)
    }
    // 选中的产物文件不在列表中时（如切换 Tab）→ 重置
    if (selectedPath && !artifactFiles.some(f => f.path === selectedPath)) {
      setSelectedPath(artifactFiles[0]?.path ?? null)
    }
  }, [artifactFiles, selectedPath, externalFile])

  // ─── 文件内容加载 ──────────────────────────────────────
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const loadTokenRef = useRef(0)

  const loadFileContent = useCallback(async (filePath: string) => {
    // 取消上一次加载（防止竞态）
    const token = ++loadTokenRef.current
    setFileLoading(true)
    setFileError(null)
    setFileContent(null)

    try {
      const fileType = getFileType(filePath)

      // 图片和二进制文件由 ImagePreview / UnsupportedFile 自行通过 api.file.readBinary 加载
      if (fileType === 'image' || fileType === 'binary') {
        if (token === loadTokenRef.current) {
          setFileLoading(false)
        }
        return
      }

      // 文本类文件：读取内容
      const content = await api.file.read(filePath)
      if (token !== loadTokenRef.current) return // 已被新请求取代

      if (content === null || content === undefined) {
        setFileError('文件内容为空或不存在')
      } else {
        setFileContent(content)
      }
    } catch (e) {
      if (token !== loadTokenRef.current) return
      logger.agent.warn('[ExecutionFilePreview] Failed to load file:', e)
      setFileError(e instanceof Error ? e.message : '加载文件失败')
    } finally {
      if (token === loadTokenRef.current) {
        setFileLoading(false)
      }
    }
  }, [])

  // 选中文件变化时重新加载
  useEffect(() => {
    if (selectedPath) {
      loadFileContent(selectedPath)
    } else {
      setFileContent(null)
      setFileError(null)
    }
  }, [selectedPath, loadFileContent])

  // ─── 在系统文件管理器中显示 ────────────────────────────
  const handleShowInFolder = useCallback(() => {
    if (selectedPath) {
      api.file.showInFolder(selectedPath)
    }
  }, [selectedPath])

  // ─── 渲染 ─────────────────────────────────────────────

  const selectedFileType = selectedPath ? getFileType(selectedPath) : 'unknown'

  // 空状态：无 AI 产物 + 未选择外部文件 → 显示提示
  if (artifactFiles.length === 0 && !externalFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted/50 gap-2">
        <FileCode className="w-10 h-10 opacity-30" />
        <p className="text-[12px]">暂无文件预览</p>
        <p className="text-[12px] text-text-muted/40">点击左侧项目文件，或等待 AI 生成产物</p>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-surface/10">
      {/* 左侧：AI 产物文件列表（外部点击的文件不加入列表） */}
      <div className="flex-shrink-0 w-[200px] flex flex-col border-r border-border/30 bg-surface/20">
        {/* 文件列表头部（紧凑型，仅显示数量和操作按钮） */}
        <div className="flex-shrink-0 flex items-center gap-1 px-2 h-8 border-b border-border/30">
          <span className="text-[12px] text-text-muted">{artifactFiles.length} 个文件</span>
          <div className="flex-1" />
          {selectedPath && (
            <>
              <button
                onClick={handleShowInFolder}
                className="p-0.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
                title="在文件管理器中显示"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
              <button
                onClick={() => loadFileContent(selectedPath)}
                className="p-0.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
                title="刷新"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {artifactFiles.map((file) => {
            const Icon = getFileIcon(file.path, file.operation)
            const isActive = file.path === selectedPath
            return (
              <div
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-l-2 ${
                  isActive
                    ? 'bg-accent/10 border-accent'
                    : 'border-transparent hover:bg-surface-hover/30'
                }`}
                title={file.path}
              >
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${
                  isActive ? 'text-accent' : 'text-text-muted'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[12px] truncate ${
                    isActive ? 'text-accent font-medium' : 'text-text-primary'
                  }`}>
                    {file.name}
                  </p>
                  <p className="text-[12px] text-text-muted/60 truncate">
                    {file.operation === 'create' ? '创建' : '编辑'}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 右侧：预览区 */}
      <div className="flex-1 min-w-0 flex flex-col bg-background">
        {/* 预览路径栏 */}
        {selectedPath && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 h-8 border-b border-border/30 bg-surface/30">
            <FileCode className="w-3 h-3 text-text-muted flex-shrink-0" />
            <span className="text-[12px] text-text-muted truncate flex-1" title={selectedPath}>
              {selectedPath}
            </span>
          </div>
        )}

          {/* 预览内容 */}
          <div className="flex-1 min-h-0 relative">
            {fileLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </div>
            ) : fileError ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
                <FileQuestion className="w-10 h-10 opacity-30" />
                <p className="text-[12px]">{fileError}</p>
              </div>
            ) : selectedPath ? (
              <FilePreviewContent
                filePath={selectedPath}
                fileType={selectedFileType}
                content={fileContent}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted">
                <p className="text-[12px]">选择左侧文件查看预览</p>
              </div>
            )}
          </div>
      </div>
    </div>
  )
}

// ============================================
// 子组件：文件预览内容（按类型分发）
// ============================================

interface FilePreviewContentProps {
  filePath: string
  fileType: ReturnType<typeof getFileType>
  content: string | null
}

function FilePreviewContent({ filePath, fileType, content }: FilePreviewContentProps) {
  switch (fileType) {
    case 'markdown':
      return <MarkdownPreview content={content ?? ''} fontSize={14} />

    case 'image':
      return <ImagePreview path={filePath} />

    case 'video':
      return <VideoPreview path={filePath} />

    case 'html':
      return <HtmlPreview content={content ?? ''} filePath={filePath} />

    case 'binary':
      return <UnsupportedFile path={filePath} fileType="binary" />

    case 'unknown':
      return <UnsupportedFile path={filePath} fileType="unknown" />

    case 'text':
    default:
      // 代码 / 纯文本：用等宽字体显示，带行号
      return <CodePreview content={content} />
  }
}

// ============================================
// 子组件：代码预览（纯文本 + 等宽字体）
// ============================================

interface CodePreviewProps {
  content: string | null
}

function CodePreview({ content }: CodePreviewProps) {
  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  const lines = content.split('\n')

  return (
    <div className="h-full overflow-auto custom-scrollbar bg-background-editor">
      <div className="flex min-h-full">
        {/* 行号 */}
        <div className="flex-shrink-0 select-none text-right py-3 px-3 text-text-muted/40 font-mono text-[12px] leading-[1.6] border-r border-border/20 bg-surface/20">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        {/* 代码内容 */}
        <pre className="flex-1 py-3 px-4 font-mono text-[12px] leading-[1.6] text-text-primary whitespace-pre overflow-visible">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  )
}

// ============================================
// 常量
// ============================================

const EMPTY_MESSAGES: ChatMessage[] = []
