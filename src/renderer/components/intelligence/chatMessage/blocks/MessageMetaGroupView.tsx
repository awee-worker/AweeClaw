/**
 * 消息元数据组视图
 * 折叠式展示 Skill 引用和文件搜索上下文
 *
 * 说明：关键词自动应用的技能（auto: true）不再在此展示，
 *       仅展示用户手动引用的技能，避免回复头部产生噪音。
 */
import React, { useState } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BRAND } from '@shared/brand'
import { api } from '../../../../adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'

interface MessageMetaGroupViewProps {
  manualSkills?: any[]
  searchContent?: string
  isSearchStreaming?: boolean
}

function MessageMetaGroupViewBase({ manualSkills, searchContent, isSearchStreaming }: MessageMetaGroupViewProps) {
  const { openFile, setActiveFile, workspacePath, expandContextByDefault, language } = useStore(useShallow(s => ({
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
    workspacePath: s.workspacePath,
    expandContextByDefault: s.agentConfig.expandContextByDefault ?? true,
    language: s.language,
  })))
  const [isExpanded, setIsExpanded] = useState(expandContextByDefault)

  const hasManualSkills = manualSkills && manualSkills.length > 0
  const hasSearch = searchContent !== undefined || isSearchStreaming
  const isStreaming = isSearchStreaming

  if (!hasManualSkills && !hasSearch) return null

  /** 打开 Skill 文件 */
  const handleOpenSkill = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation()
    if (!workspacePath) return
    const filePath = `${workspacePath}/${BRAND.dirName}/skills/${skillId}/SKILL.md`.replace(/\//g, '\\')
    const fileContent = await api.file.read(filePath)
    if (fileContent !== null) {
      openFile(filePath, fileContent)
      setActiveFile(filePath)
    }
  }

  const skillNames = (manualSkills || []).map((s: any) => s.skillId).join(', ')

  return (
    <div className="overflow-hidden w-full my-0.5 animate-fade-in relative z-10">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 py-1.5 cursor-pointer select-none group rounded-md hover:bg-text-primary/[0.03] transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/85 group-hover:text-text-muted transition-colors">
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.div>

        <div className="shrink-0 w-4 h-4 flex items-center justify-center">
          {isStreaming ? (
            <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            </div>
          ) : (
            <Wrench className="w-3 h-3 text-text-muted/85" />
          )}
        </div>

        <span className={`text-[12px] ${isStreaming ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
          {hasManualSkills ? t('ai.skillreferenced', language as Language) : t('ai.context', language as Language)}
        </span>

        {!isExpanded && skillNames && (
          <span className="text-[12px] truncate ml-0.5 text-text-muted/85">
            — {skillNames}
          </span>
        )}
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-1.5 pl-[38px] pr-3 space-y-0.5">
              {hasManualSkills && (
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className="shrink-0 text-text-muted/75">{t('ai.skillreferenced', language as Language)}</span>
                  {(manualSkills || []).map((item: any, i: number) => (
                    <React.Fragment key={item.skillId || i}>
                      {i > 0 && <span className="text-text-muted/85">,</span>}
                      <button
                        onClick={(e) => handleOpenSkill(e, item.skillId)}
                        className="font-mono text-text-muted/75 hover:text-accent transition-colors focus:outline-none"
                      >
                        {item.skillId}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {hasSearch && (
                <div className="text-[12px]">
                  {searchContent ? (
                    <div className="flex items-start gap-1.5">
                      <span className="text-text-muted/75 shrink-0">{t('ai.filereferenced', language as Language)}</span>
                      <div className="text-text-muted/85 leading-relaxed max-h-32 overflow-auto custom-scrollbar whitespace-pre-wrap">
                        {searchContent}
                      </div>
                    </div>
                  ) : (
                    <span className="text-text-muted/65 italic">{t('ai.searchingfiles', language as Language)}</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const MessageMetaGroupView = React.memo(MessageMetaGroupViewBase)
MessageMetaGroupView.displayName = 'MessageMetaGroupView'
