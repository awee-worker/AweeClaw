/**
 * 角色新建 / 编辑表单
 *
 * 分四步（高级设置默认折叠）：基本信息 / 角色人设 / 触发与输出 / 高级设置。
 * 校验与 roleLibraryStore.validateRole 一致；触发关键词命中泛化词时
 * 给出警告但不阻断保存。
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md 8.3 节
 */

import { useMemo, useState } from 'react'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import type {
  RoleDescriptor,
  RoleIntent,
  RoleModelPreference,
} from '@intelligence/capabilities/role/RoleDescriptor'
import { ALL_ROLE_INTENTS } from '@intelligence/capabilities/role/RoleDescriptor'
import { useRoleLibraryStore, type RoleValidationIssue } from '@renderer/modes/roleLibraryStore'
import { runLlmText, isLlmConfigured } from '@renderer/components/scene-tools/sceneToolsLlm'
import { RoleModelPicker } from './RoleModelPicker'
import {
  X,
  User,
  FileText,
  Target,
  Settings2,
  Sparkles,
  ChevronDown,
  Loader2,
} from 'lucide-react'

/** 泛化词黑名单：命中给出警告但不阻断保存 */
const GENERIC_KEYWORDS = new Set(['写', '做', '帮我', '看', '看看', '整理', '处理', '分析一下', '聊聊'])

const INTENT_LABELS: Record<RoleIntent, string> = {
  drafting: '起草', summarizing: '总结', analyzing: '分析', reviewing: '审查',
  planning: '规划', explaining: '讲解', practicing: '出题', reminding: '提醒',
  companioning: '陪伴', deciding: '决策',
  translating: '翻译', coding: '编码', researching: '调研', brainstorming: '创意',
  communicating: '沟通', extracting: '提取',
}

const SCENE_LABELS: Record<SceneMode, string> = {
  work: '日常办公', life: '生活陪伴', study: '学习探索', dev: '代码开发',
}

/**
 * 角色人设模版：AI 帮写时作为结构与语气范例，
 * 由模型按角色名称 / 描述 / 触发词填充，避免自由发挥导致风格漂移。
 */
const PERSONA_TEMPLATE = [
  '【角色定位】一句话说明这个角色是谁、擅长解决哪类问题。',
  '【专业背景】相关领域经验、知识范围与惯用的方法论。',
  '【工作方法】接到任务后按什么步骤推进，先做什么、后做什么。',
  '【输出规范】结果的呈现方式：结构、详略、语气。',
  '【沟通风格】称呼、语气特点，以及需要避免的表达。',
  '【边界约束】不做什么，遇到超出职责范围时的处理方式。',
].join('\n')

const PERSONA_WRITER_SYSTEM_PROMPT =
  '你是角色人设撰写助手，负责把角色的名称与一句话描述扩写成可直接使用的「角色人设」。\n' +
  '写作要求：\n' +
  '1. 严格仿照给定模版，六段标题原样保留，每段写成「标题：正文」，正文 1~3 句。\n' +
  '2. 只依据用户给出的角色名称、描述、触发词推断，不虚构具体的公司、项目、人名。\n' +
  '3. 人设会被追加在场景人设之后使用，因此不重复全局设定、不声明安全边界，只描述这个角色自身的方法与风格。\n' +
  '4. 用第二人称「你」描述角色，语言简洁、具体、可执行，避免「尽力」「尽量」这类空话。\n' +
  '5. 只输出人设正文，不要任何解释、前言或 Markdown 代码块。\n\n' +
  `模版：\n${PERSONA_TEMPLATE}`

/**
 * 标签输入框：回车添加、× 删除。
 *
 * 必须定义在组件外部。若定义在 RoleEditForm 内部，父组件每次重渲染都会生成
 * 新的函数引用，React 据此卸载并重建子树，输入框会在敲入首个字符后立即失焦
 * （表现为「无法输入 / 被禁用」）。
 */
function TagInput({
  list,
  input,
  setInput,
  onAdd,
  onRemove,
}: {
  list: string[]
  input: string
  setInput: (v: string) => void
  onAdd: () => void
  onRemove: (tag: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {list.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[11px] bg-accent/8 text-accent rounded-full"
        >
          {tag}
          <button
            type="button"
            onClick={() => onRemove(tag)}
            className="ml-0.5 text-accent/60 hover:text-accent"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onAdd()
          }
        }}
        placeholder="输入后回车添加"
        className="px-2 py-0.5 text-[11px] bg-transparent border-none outline-none placeholder:text-text-muted/50 min-w-[100px]"
      />
    </div>
  )
}

interface RoleEditFormProps {
  sceneMode: SceneMode
  /** 编辑对象；null 为新建 */
  existing: RoleDescriptor | null
  onClose: () => void
}

export function RoleEditForm({ sceneMode, existing, onClose }: RoleEditFormProps) {
  const isBuiltin = !!existing?.builtin
  const isEdit = !!existing

  const [id, setId] = useState(existing?.id ?? `${sceneMode}.`)
  const [name, setName] = useState(existing?.nameZh ?? '')
  const [nameEn, setNameEn] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [personaPrompt, setPersonaPrompt] = useState(existing?.personaPrompt ?? '')
  const [keywords, setKeywords] = useState<string[]>(existing?.triggers.keywords ?? [])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(existing?.triggers.excludeKeywords ?? [])
  const [intents, setIntents] = useState<RoleIntent[]>(existing?.triggers.intents ?? [])
  const [outputContract, setOutputContract] = useState(existing?.outputContract ?? '')
  const [priority, setPriority] = useState(existing?.priority ?? 60)
  const [keywordInput, setKeywordInput] = useState('')
  const [excludeInput, setExcludeInput] = useState('')
  const [issues, setIssues] = useState<RoleValidationIssue[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [modelPreference, setModelPreference] = useState<RoleModelPreference>(existing?.modelPreference ?? {})
  const [aiWriting, setAiWriting] = useState(false)
  const [aiWriteError, setAiWriteError] = useState('')

  const genericWarnings = useMemo(
    () => keywords.filter(k => GENERIC_KEYWORDS.has(k)),
    [keywords],
  )

  function buildRole(): RoleDescriptor {
    const now = Date.now()
    return {
      id: id.trim(),
      name: nameEn.trim() || id.trim(),
      nameZh: name.trim() || id.trim(),
      description: description.trim(),
      // 表单未提供图标选择：编辑时沿用原图标，新建时用通用图标
      icon: existing?.icon ?? 'User',
      sceneMode,
      // personaPrompt 为必填字段：留空存空串，由注入侧决定是否渲染该段
      personaPrompt: personaPrompt.trim(),
      skillRefs: existing?.skillRefs ?? [],
      // 表单未提供工具组选择：沿用原有范围，新建时给读写（不提权，越界项在执行期静默降级）
      toolScopes: existing?.toolScopes ?? ['read', 'write'],
      triggers: {
        keywords,
        excludeKeywords,
        intents,
      },
      outputContract: outputContract.trim() || undefined,
      priority,
      enabled: existing?.enabled ?? true,
      builtin: existing?.builtin ?? false,
      version: existing?.version ?? 1,
      modelPreference: modelPreference.provider || modelPreference.model ? modelPreference : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  }

  function handleSave() {
    setIssues([])
    const role = buildRole()
    const result = isEdit
      ? useRoleLibraryStore.getState().updateRole(role.id, role)
      : useRoleLibraryStore.getState().addRole(role)
    if (result && result.length > 0) {
      setIssues(result)
      return
    }
    onClose()
  }

  function addTag(
    list: string[],
    value: string,
    setter: (v: string[]) => void,
    inputSetter: (v: string) => void,
  ) {
    const tag = value.trim()
    if (!tag || list.includes(tag)) return
    setter([...list, tag])
    inputSetter('')
  }

  /** AI 帮写人设：按角色名称 / 描述 / 触发词，仿照模版生成正文 */
  async function handleAiWritePersona() {
    if (!isLlmConfigured()) {
      setAiWriteError('未配置模型，请先在「设置 → 模型」中填写 API Key 或开启云模式')
      return
    }
    if (!name.trim() && !description.trim()) {
      setAiWriteError('请先填写角色名称或一句话描述，AI 需要据此推断人设')
      return
    }
    setAiWriting(true)
    setAiWriteError('')
    try {
      const context = [
        `所属场景：${SCENE_LABELS[sceneMode]}`,
        `角色名称：${name.trim() || nameEn.trim() || '（未填写）'}`,
        `一句话描述：${description.trim() || '（未填写）'}`,
        keywords.length ? `触发关键词：${keywords.join('、')}` : '',
        intents.length ? `意图标签：${intents.map(i => INTENT_LABELS[i]).join('、')}` : '',
        personaPrompt.trim() ? `当前人设（可参考并优化）：\n${personaPrompt.trim()}` : '',
      ].filter(Boolean).join('\n')

      const text = await runLlmText({
        systemPrompt: PERSONA_WRITER_SYSTEM_PROMPT,
        userPrompt: `请为以下角色撰写人设：\n${context}`,
      })
      if (!text) {
        setAiWriteError('AI 未返回内容，请重试')
        return
      }
      setPersonaPrompt(text)
    } catch (e) {
      setAiWriteError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiWriting(false)
    }
  }

  function SectionHeader({
    icon: Icon,
    title,
    subtitle,
    action,
  }: {
    icon: React.ComponentType<{ className?: string }>
    title: string
    subtitle?: string
    action?: React.ReactNode
  }) {
    return (
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-accent" />
        </div>
        <div>
          <div className="text-xs font-semibold text-text-primary">{title}</div>
          {subtitle && <div className="text-[10px] text-text-muted">{subtitle}</div>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
    )
  }

  const inputBase =
    'w-full px-2.5 py-1.5 text-xs bg-input border border-input-border rounded-lg outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-text-muted/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl shadow-2xl w-[600px] max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-accent" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {isEdit ? `编辑「${existing.nameZh}」` : '创建专家'}
              </div>
              <div className="text-[10px] text-text-muted">
                {SCENE_LABELS[sceneMode]}场景{isBuiltin ? ' · 内置专家' : ' · 自定义专家'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1">
          {/* 第一部分：基本信息 */}
          <section>
            <SectionHeader
              icon={User}
              title="基本信息"
              subtitle="角色的标识与描述"
            />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    角色 ID
                  </label>
                  <input
                    value={id}
                    disabled={isBuiltin}
                    onChange={e => setId(e.target.value)}
                    placeholder="work.tech-lead"
                    className={inputBase}
                  />
                  <div className="text-[10px] text-text-muted/60 mt-0.5">
                    格式 &lt;场景&gt;.&lt;标识&gt;，保存后不可改
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    中文名称
                  </label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="技术负责人"
                    className={inputBase}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    英文名称
                  </label>
                  <input
                    value={nameEn}
                    onChange={e => setNameEn(e.target.value)}
                    placeholder="Tech Lead"
                    className={inputBase}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    一句话描述
                  </label>
                  <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="擅长技术架构设计与代码审查"
                    className={inputBase}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 第二部分：角色人设 */}
          <section>
            <SectionHeader
              icon={FileText}
              title="角色人设"
              subtitle="定义角色的行为方式与专业领域"
              action={
                <button
                  type="button"
                  onClick={handleAiWritePersona}
                  disabled={aiWriting}
                  title="根据角色名称与描述，仿照模版自动编写人设"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiWriting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Sparkles className="w-3.5 h-3.5" />}
                  {aiWriting ? '编写中…' : 'AI 帮写'}
                </button>
              }
            />
            <textarea
              value={personaPrompt}
              onChange={e => setPersonaPrompt(e.target.value)}
              rows={4}
              placeholder="描述角色的专业背景、工作方法、沟通风格等。追加在场景人设之后，不替换全局设定。"
              className={`${inputBase} resize-y`}
            />
            {aiWriteError && (
              <div className="text-[10px] text-status-error mt-1">{aiWriteError}</div>
            )}
          </section>

          {/* 第三部分：触发与输出 */}
          <section>
            <SectionHeader
              icon={Target}
              title="触发与输出"
              subtitle="控制角色何时激活以及如何输出结果"
            />
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  触发关键词
                </label>
                <div className="bg-input border border-input-border rounded-lg px-2 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 transition-colors">
                  <TagInput
                    list={keywords}
                    input={keywordInput}
                    setInput={setKeywordInput}
                    onAdd={() => addTag(keywords, keywordInput, setKeywords, setKeywordInput)}
                    onRemove={tag => setKeywords(keywords.filter(k => k !== tag))}
                  />
                </div>
                <div className="text-[10px] text-text-muted/60 mt-0.5">
                  禁用泛化词（写/做/帮我…），单个角色不超过 8 个
                </div>
                {genericWarnings.length > 0 && (
                  <div className="text-[10px] text-status-warning mt-1">
                    ⚠ 「{genericWarnings.join('、')}」过于宽泛，可能造成误匹配
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  意图标签
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_ROLE_INTENTS.map(intent => {
                    const active = intents.includes(intent)
                    return (
                      <button
                        type="button"
                        key={intent}
                        onClick={() =>
                          setIntents(
                            active ? intents.filter(i => i !== intent) : [...intents, intent],
                          )
                        }
                        className={`px-2.5 py-1 text-[11px] rounded-lg border transition-all ${
                          active
                            ? 'bg-accent/10 text-accent border-accent/30 shadow-sm'
                            : 'bg-surface-hover text-text-muted border-border hover:border-border-active/40 hover:text-text-secondary'
                        }`}
                      >
                        {INTENT_LABELS[intent]}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[10px] text-text-muted/60 mt-0.5">
                  与轻量意图识别结果比对，命中加分
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  排除关键词
                </label>
                <div className="bg-input border border-input-border rounded-lg px-2 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 transition-colors">
                  <TagInput
                    list={excludeKeywords}
                    input={excludeInput}
                    setInput={setExcludeInput}
                    onAdd={() =>
                      addTag(excludeKeywords, excludeInput, setExcludeKeywords, setExcludeInput)
                    }
                    onRemove={tag =>
                      setExcludeKeywords(excludeKeywords.filter(k => k !== tag))
                    }
                  />
                </div>
                <div className="text-[10px] text-text-muted/60 mt-0.5">
                  命中即一票否决（如「直接告诉我」排除苏格拉底导师）
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    输出契约
                  </label>
                  <input
                    value={outputContract}
                    onChange={e => setOutputContract(e.target.value)}
                    placeholder="对结果格式的硬性约定（可选）"
                    className={inputBase}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    优先级
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={priority}
                      onChange={e => setPriority(Number(e.target.value))}
                      className="flex-1 h-1 accent-accent"
                    />
                    <span className="text-xs font-mono text-text-secondary w-8 text-right">
                      {priority}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted/60 mt-0.5">
                    同分时数值大的优先
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 第四部分：高级设置（默认折叠） */}
          <section>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors w-full"
            >
              <div className="w-6 h-6 rounded-md bg-surface-hover flex items-center justify-center">
                <Settings2 className="w-3.5 h-3.5" />
              </div>
              <span className="font-medium">高级设置</span>
              <ChevronDown
                className={`ml-auto w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
            </button>
            {showAdvanced && (
              <div className="mt-3 border border-border rounded-xl p-3.5 space-y-3 bg-surface-hover/30">
                <div className="text-[10px] text-text-muted">
                  子任务质量可能与主对话不一致；选择「继承当前会话配置」即跟随主对话使用的模型
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    模型
                  </label>
                  <RoleModelPicker
                    value={modelPreference}
                    onChange={next =>
                      setModelPreference({
                        ...modelPreference,
                        provider: next.provider,
                        model: next.model,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </section>

          {/* 校验错误 */}
          {issues.length > 0 && (
            <div className="rounded-xl border border-status-error/30 bg-status-error/5 p-3">
              <div className="text-[11px] text-status-error space-y-0.5">
                {issues.map((issue, i) => (
                  <div key={i}>· {issue.message}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0 bg-surface/80 backdrop-blur-sm">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-xs font-medium bg-accent text-white hover:bg-accent/90 rounded-lg transition-colors shadow-sm"
          >
            {isEdit ? '保存修改' : '创建专家'}
          </button>
        </div>
      </div>
    </div>
  )
}