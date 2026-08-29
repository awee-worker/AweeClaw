/**
 * Mention 控制器 Hook
 * 管理文件/代码提及弹窗的状态、候选项获取和选择处理
 */
import { useState, useRef, useCallback } from 'react'
import { logger } from '@toolkit/LogEngine'
import { MentionParser, type MentionCandidate } from '@intelligence/utils/mentionDecoder'
import type { ContextItem, FileContext } from '@intelligence/providerTypes'

interface UseMentionControllerParams {
  workspacePath: string | null
  input: string
  setInput: (value: string | null | undefined) => void
  contextItems: ContextItem[]
  addContextItem: (item: ContextItem) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  inputContainerRef: React.RefObject<HTMLDivElement | null>
}

export function useMentionController({
  workspacePath,
  input,
  setInput,
  contextItems,
  addContextItem,
  textareaRef,
  inputContainerRef,
}: UseMentionControllerParams) {
  const [showFileMention, setShowFileMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 })
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const suggestionRequestId = useRef(0)

  /** 输入变化时检测 mention 触发 */
  const detectMention = useCallback(
    async (value: string, cursorPos: number) => {
      const updatePopupPosition = () => {
        if (inputContainerRef.current) {
          const rect = inputContainerRef.current.getBoundingClientRect()
          setMentionPosition({ x: rect.left + 16, y: rect.top })
        }
      }

      const parseResult = MentionParser.parse(value, cursorPos)

      if (parseResult) {
        setMentionQuery(parseResult.query)
        setMentionRange(parseResult.range)
        updatePopupPosition()
        setShowFileMention(true)

        const requestId = ++suggestionRequestId.current
        setMentionLoading(true)
        try {
          const suggestions = await MentionParser.getSuggestions(parseResult.query, workspacePath)
          if (requestId === suggestionRequestId.current) {
            setMentionCandidates(suggestions)
          }
        } catch (err) {
          logger.agent.error('Error fetching suggestions:', err)
        } finally {
          if (requestId === suggestionRequestId.current) {
            setMentionLoading(false)
          }
        }
        return true
      }
      return false
    },
    [workspacePath, inputContainerRef],
  )

  /** 关闭 mention 弹窗 */
  const closeMention = useCallback(() => {
    setShowFileMention(false)
    setMentionQuery('')
  }, [])

  /** 选择 mention 候选项 */
  const handleSelectMention = useCallback(
    (candidate: MentionCandidate) => {
      if (!mentionRange) return
      const currentInput = input ?? ''

      const textBeforeMention = currentInput.slice(0, mentionRange.start)
      const textAfterMention = currentInput.slice(mentionRange.end)

      let replacement = ''
      let contextItem: ContextItem | null = null

      switch (candidate.type) {
        case 'skill':
          replacement = `@${candidate.data.skillId} `
          contextItem = {
            type: 'Skill',
            skillId: candidate.data.skillId,
            name: candidate.data.name,
          }
          break
        case 'plugin':
          replacement = `@${candidate.data.name} `
          contextItem = {
            type: 'Skill',
            skillId: candidate.data.pluginKey,
            name: candidate.data.name,
          }
          break
        case 'file':
        case 'folder':
          replacement = `@${candidate.description || candidate.label} `
          contextItem = {
            type: candidate.type === 'folder' ? 'Folder' : 'File',
            uri: candidate.data.path,
          }
          break
      }

      const newInput = textBeforeMention + replacement + textAfterMention
      setInput(newInput)

      if (contextItem) {
        const exists = contextItems.some(item => {
          if (item.type !== contextItem!.type) return false
          if (item.type === 'File' && contextItem!.type === 'File') {
            return (item as FileContext).uri === (contextItem as FileContext).uri
          }
          return true
        })

        if (!exists) {
          addContextItem(contextItem)
        }
      }

      setShowFileMention(false)
      setMentionQuery('')
      textareaRef.current?.focus()
    },
    [input, mentionRange, contextItems, addContextItem, setInput, textareaRef],
  )

  return {
    showFileMention,
    mentionQuery,
    mentionPosition,
    mentionCandidates,
    mentionLoading,
    detectMention,
    closeMention,
    handleSelectMention,
  }
}
