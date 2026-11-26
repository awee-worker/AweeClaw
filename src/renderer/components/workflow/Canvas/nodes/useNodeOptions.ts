/**
 * 工作流节点编辑器的可选数据源
 *
 * 节点里凡是「引用某个已存在实体」的字段都应给出下拉，而不是让用户手打：
 * 手打技能名、工具名、服务器 ID 时，用户既不知道有哪些可选，也无从发现拼错，
 * 只能等运行时才报错。这里集中收口这几类候选来源，避免每个编辑器各写一份。
 *
 * @module useNodeOptions
 */

import { useEffect, useState } from 'react'
import { useStore } from '@store'
import { skillService, type SkillItem } from '@intelligence/runtime/skillRepository'
import { toolManager } from '@intelligence/toolkit/providers/ToolCoordinator'
import { builtinWorkflows } from '@shared/configuration/workflows'
import { loadCustomWorkflows } from '@shared/configuration/workflows/customStorage'

export interface OptionItem {
  value: string
  label: string
  /** 描述/状态提示，用于下拉项说明或选中后展示 */
  hint?: string
}

type UiLanguage = 'zh' | 'en'

/**
 * 技能的展示名。
 *
 * value（写进节点数据的技能标识）必须是英文 name，否则运行时定位不到技能；
 * 但下拉里直接显示 name 时用户看不出这是什么技能。中文名来自插件 manifest 合入的
 * metadata.nameZh，与技能条、技能市场保持一致；缺失时逐级回退。
 */
export function skillDisplayName(skill: SkillItem, language: UiLanguage = 'zh'): string {
  const zh = skill.metadata?.nameZh
  const en = skill.metadata?.nameEn
  return language === 'en' ? en || skill.name : zh || en || skill.name
}

/** 已安装技能（仅 enabled）。options 为 null 表示仍在加载。 */
export function useInstalledSkills(language: UiLanguage = 'zh'): { options: OptionItem[] | null; error: string | null } {
  const [options, setOptions] = useState<OptionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    skillService
      .getSkills()
      .then((list: SkillItem[]) => {
        if (!alive) return
        setOptions(
          list
            .filter((s) => s.enabled)
            .map((s) => ({ value: s.name, label: skillDisplayName(s, language), hint: s.description })),
        )
      })
      .catch((err: unknown) => {
        if (!alive) return
        setOptions([])
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [language])

  return { options, error }
}

/** 本地工具（内置 + 插件注册的工具）。null 表示仍在读取。 */
export function useLocalTools(): OptionItem[] | null {
  const [options, setOptions] = useState<OptionItem[] | null>(null)

  useEffect(() => {
    try {
      const defs = toolManager.getAllToolDefinitions()
      setOptions(
        defs
          .map((d) => ({
            value: d.name,
            label: d.name,
            hint: (d as { description?: string }).description,
          }))
          .sort((a, b) => a.value.localeCompare(b.value)),
      )
    } catch {
      setOptions([])
    }
  }, [])

  return options
}

/** 已注册的 MCP 服务器（含未连接，用 hint 标出状态） */
export function useMcpServers(): OptionItem[] {
  const mcpServers = useStore((s) => s.mcpServers)
  return mcpServers.map((s) => ({
    value: s.id,
    label: (s.config as { name?: string }).name || s.id,
    hint: s.status === 'connected' ? undefined : s.status,
  }))
}

/** 指定 MCP 服务器下已发现的工具 */
export function useMcpTools(serverId: string | undefined): OptionItem[] {
  const mcpServers = useStore((s) => s.mcpServers)
  if (!serverId) return []
  const server = mcpServers.find((s) => s.id === serverId)
  if (!server) return []
  return server.tools.map((t) => ({ value: t.name, label: t.name, hint: t.description }))
}

/** 可作为子工作流调用的工作流（内置 + 自定义）。null 表示仍在读取。 */
export function useWorkflowOptions(): OptionItem[] | null {
  const [options, setOptions] = useState<OptionItem[] | null>(null)

  useEffect(() => {
    const out: OptionItem[] = []
    const push = (wf: { id: string; name?: string; nameZh?: string }) => {
      if (!wf.id || out.some((o) => o.value === wf.id)) return
      out.push({ value: wf.id, label: wf.nameZh || wf.name || wf.id })
    }
    for (const wf of builtinWorkflows) push(wf as { id: string; name?: string; nameZh?: string })
    try {
      for (const wf of loadCustomWorkflows()) push(wf as { id: string; name?: string; nameZh?: string })
    } catch {
      /* 自定义工作流读取失败不影响内置清单 */
    }
    setOptions(out)
  }, [])

  return options
}

/**
 * 下拉项 + 「当前值不在候选里」时补一项。
 *
 * 旧数据里的技能名/工具名可能已经卸载或改名，直接丢掉会让节点看起来像空的，
 * 补一项并标注「未找到」才能让用户知道该改哪一个。
 */
export function withCurrentOption(options: OptionItem[], current: string, label?: string): OptionItem[] {
  if (!current) return options
  if (options.some((o) => o.value === current)) return options
  return [{ value: current, label: label ?? current, hint: undefined }, ...options]
}
