/**
 * 斜杠命令控制器 Hook
 * 管理斜杠命令弹窗的状态和命令选择处理
 */
import { useState, useCallback } from 'react'
import { slashCommandService, type SlashCommand } from '@services/slashCommandAdapter'

interface UseSlashCommandControllerParams {
  setInput: (value: string | null | undefined) => void
  setChatMode: (mode: string) => void
  activeFilePath: string | null
  selectedCode: string | null
  workspacePath: string | null
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export function useSlashCommandController({
  setInput,
  setChatMode,
  activeFilePath,
  selectedCode,
  workspacePath,
  textareaRef,
}: UseSlashCommandControllerParams) {
  const [showSlashCommand, setShowSlashCommand] = useState(false)
  const [slashCommandQuery, setSlashCommandQuery] = useState('')

  /** 检测斜杠命令触发 */
  const detectSlashCommand = useCallback((value: string) => {
    if (value.startsWith('/') && !value.includes(' ') && value.length < 20) {
      setSlashCommandQuery(value)
      setShowSlashCommand(true)
      return true
    }
    setShowSlashCommand(false)
    setSlashCommandQuery('')
    return false
  }, [])

  /** 关闭斜杠命令弹窗 */
  const closeSlashCommand = useCallback(() => {
    setShowSlashCommand(false)
    setSlashCommandQuery('')
  }, [])

  /** 选择斜杠命令 */
  const handleSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      const result = slashCommandService.parse('/' + cmd.name, {
        activeFilePath: activeFilePath || undefined,
        selectedCode: selectedCode || undefined,
        workspacePath: workspacePath || undefined,
      })
      if (result) {
        setInput(result.prompt)
        if (result.mode) {
          setChatMode(result.mode as any)
        }
      }
      setShowSlashCommand(false)
      setSlashCommandQuery('')
      textareaRef.current?.focus()
    },
    [activeFilePath, selectedCode, workspacePath, setChatMode, setInput, textareaRef],
  )

  return {
    showSlashCommand,
    slashCommandQuery,
    detectSlashCommand,
    closeSlashCommand,
    handleSlashCommand,
  }
}
