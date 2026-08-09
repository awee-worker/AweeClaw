/**
 * projectExecutionContext — 项目执行上下文提示词构建器
 *
 * 职责：
 * - 构建包含完整项目背景的提示词（项目名、目标、描述、全部任务列表）
 * - 支持单任务执行：注入项目上下文 + 当前任务详情
 * - 支持批量执行：注入项目上下文 + 全部待执行任务，AI 按顺序依次执行
 * - 支持附件引用：只传文件路径（不传内容），AI 按需 read_file 读取（节省 token）
 *
 * 设计原则：
 * - AI 必须了解整个项目的需求，不能只看到单个任务
 * - 项目目标（goal）是核心上下文，帮助 AI 理解任务间的关联
 * - 全部任务列表让 AI 知道整体范围，避免重复劳动或遗漏依赖
 * - 附件只传路径和摘要，不传全文内容（大幅节省 token）
 */
import type { TaskItem, TaskPriority, ProjectStatus } from '../tasks/types'
import { extractQualityMeta, extractExecutionResult, type TaskQualityMeta, type TaskExecutionResult } from './taskQuality'

/** 项目附件信息（轻量，只含路径和元信息，不含文件内容） */
export interface ProjectAttachmentRef {
  /** 附件文件名 */
  fileName: string
  /** 附件本地路径（AI 可通过 read_file 工具读取） */
  localPath: string
  /** 文件大小（字节） */
  fileSize: number
  /** MIME 类型 */
  mimeType: string
  /** 是否有可读文本内容 */
  hasText: boolean
}

/** 项目上下文信息（从 ProjectItem 中提取执行所需字段） */
export interface ProjectContext {
  id: string
  name: string
  description?: string | null
  goal?: string | null
  tags?: string[]
  /**
   * 项目工作目录路径（产物输出位置）
   * AI 执行任务时产出的文件、代码等应保存到此目录下。
   * 从 ProjectItem.workspacePaths 提取，由调用方传入。
   */
  workspacePath?: string | null
  /** 项目附件列表（只传路径，不传内容，节省 token） */
  attachments?: ProjectAttachmentRef[]
  /**
   * 项目当前状态（用于执行时自动流转：PLANNING → ACTIVE）
   * 可选，未传入时不触发自动流转
   */
  status?: ProjectStatus
}

/** 优先级标签映射 */
const PRIORITY_LABELS: Record<TaskPriority, [string, string]> = {
  LOW: ['Low', '低'],
  MEDIUM: ['Medium', '中'],
  HIGH: ['High', '高'],
  URGENT: ['Urgent', '紧急'],
}

/** 任务状态标签映射 */
const STATUS_LABELS: Record<string, [string, string]> = {
  TODO: ['To Do', '待办'],
  IN_PROGRESS: ['In Progress', '进行中'],
  BLOCKED: ['Blocked', '阻塞'],
  DONE: ['Done', '已完成'],
  CANCELED: ['Canceled', '已取消'],
}

/**
 * 构建项目背景信息块（所有提示词的公共前缀）
 *
 * 包含：
 * - 项目名称、描述、目标
 * - 全部任务概览（让 AI 理解整体范围和任务间依赖）
 */
function buildProjectBackground(
  project: ProjectContext,
  allTasks: TaskItem[],
  isZh: boolean,
): string {
  const parts: string[] = []

  // ─── 项目基本信息 ──────────────────────────────
  parts.push(isZh ? `# 项目背景` : `# Project Background`)
  parts.push('')
  parts.push(`**${isZh ? '项目名称' : 'Project'}**: ${project.name}`)

  if (project.description) {
    parts.push('')
    parts.push(`**${isZh ? '项目描述' : 'Description'}:**`)
    parts.push(project.description)
  }

  if (project.goal) {
    parts.push('')
    parts.push(`**${isZh ? '项目目标' : 'Project Goal'}:**`)
    parts.push(project.goal)
  }

  // ─── 项目工作目录（关键：AI 产物的输出位置）──────────────
  // 明确告知 AI：所有任务产出的文件、代码、文档等必须保存到此目录下
  if (project.workspacePath) {
    parts.push('')
    parts.push(`**${isZh ? '项目工作目录' : 'Project Workspace'}**: \`${project.workspacePath}\``)
    parts.push('')
    parts.push(
      isZh
        ? `> ⚠️ **重要**：所有任务产出的文件（代码、文档、配置等）必须保存到上述项目工作目录下。`
        : `> ⚠️ **Important**: All task output files (code, docs, configs) MUST be saved under the project workspace directory above.`,
    )
  }

  if (project.tags && project.tags.length > 0) {
    parts.push('')
    parts.push(`**${isZh ? '标签' : 'Tags'}**: ${project.tags.join(', ')}`)
  }

  // ─── 全部任务概览 ──────────────────────────────
  if (allTasks.length > 0) {
    parts.push('')
    parts.push(isZh ? `## 全部任务概览` : `## All Tasks Overview`)
    parts.push('')

    allTasks.forEach((task, index) => {
      const statusLabel = STATUS_LABELS[task.status]
      const priorityLabel = PRIORITY_LABELS[task.priority]
      const statusText = isZh ? (statusLabel?.[1] ?? task.status) : (statusLabel?.[0] ?? task.status)
      const priorityText = isZh ? (priorityLabel?.[1] ?? task.priority) : (priorityLabel?.[0] ?? task.priority)

      const taskLine = isZh
        ? `${index + 1}. [${statusText}] [${priorityText}] ${task.title}`
        : `${index + 1}. [${statusText}] [${priorityText}] ${task.title}`
      parts.push(taskLine)

      // 简要描述（截断避免过长）
      if (task.description) {
        const desc = task.description.length > 100
          ? task.description.slice(0, 100) + '...'
          : task.description
        parts.push(`   ${desc}`)
      }
    })
  }

  // ─── 项目附件引用（只传路径，不传内容，节省 token） ───
  // AI 可通过 read_file 工具按需读取附件内容
  if (project.attachments && project.attachments.length > 0) {
    parts.push('')
    parts.push(isZh ? `## 项目附件` : `## Project Attachments`)
    parts.push('')
    parts.push(
      isZh
        ? `以下附件可供参考，需要时请使用 \`read_file\` 工具按路径读取（不要一次性全部读取，按需读取以节省资源）：`
        : `The following attachments are available. Use the \`read_file\` tool to read them on demand (do not read all at once to save resources):`,
    )
    parts.push('')

    project.attachments.forEach((att, index) => {
      const sizeStr = formatFileSize(att.fileSize)
      const textFlag = att.hasText ? '' : (isZh ? '（非文本文件）' : ' (non-text)')
      parts.push(`${index + 1}. \`${att.localPath}\` — ${att.fileName} (${sizeStr})${textFlag}`)
    })
  }

  return parts.join('\n')
}

/** 格式化文件大小为人类可读字符串 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ─── 质量增强块（角色设定 / 质量元数据 / 输出规范） ──────────

/**
 * 构建角色设定块
 *
 * 明确 AI 的身份与职责，引导其以专业、严谨的态度执行任务。
 * 这是提升回答质量的第一步：让 AI 「进入角色」。
 */
function buildRoleBlock(isZh: boolean): string {
  return isZh
    ? `# 角色设定\n\n你是一名资深全栈工程师与技术顾问，具备严谨的工程思维。\n你需要：\n- 以交付高质量成果为首要目标，而非敷衍完成任务\n- 主动识别需求中的模糊点或潜在风险，并在执行前说明\n- 严格遵守用户指定的约束条件（技术栈、编码规范等）\n- 完成后进行自检，确保交付物符合验收标准`
    : `# Role\n\nYou are a senior full-stack engineer and technical consultant with rigorous engineering thinking.\nYou must:\n- Prioritize delivering high-quality results over merely completing the task\n- Proactively identify ambiguities or risks in requirements and state them before execution\n- Strictly follow user-specified constraints (tech stack, coding standards, etc.)\n- Self-check after completion to ensure deliverables meet acceptance criteria`
}

/**
 * 构建任务质量元数据块
 *
 * 将用户填写的预期产出 / 验收标准 / 约束 / 参考资源注入 prompt，
 * 让 AI 明确「交付什么」「怎样算完成」「有什么限制」。
 *
 * 这是高质量提问的核心：结构化约束让 AI 从「猜测要做什么」变为「明确要做什么」。
 */
function buildQualityMetaBlock(meta: TaskQualityMeta, isZh: boolean): string {
  const parts: string[] = []
  const hasContent =
    !!meta.expectedOutput ||
    (meta.acceptanceCriteria && meta.acceptanceCriteria.length > 0) ||
    !!meta.constraints ||
    (meta.references && meta.references.length > 0)
  if (!hasContent) return ''

  parts.push(isZh ? `# 质量要求` : `# Quality Requirements`)
  parts.push('')

  if (meta.expectedOutput) {
    parts.push(isZh ? `## 预期产出` : `## Expected Output`)
    parts.push(meta.expectedOutput)
    parts.push('')
  }

  if (meta.acceptanceCriteria && meta.acceptanceCriteria.length > 0) {
    parts.push(isZh ? `## 验收标准` : `## Acceptance Criteria`)
    parts.push(isZh
      ? `完成后需逐条对照以下标准，未满足的需补充完善：`
      : `After completion, check against each criterion below. Any unmet items must be addressed:`)
    parts.push('')
    meta.acceptanceCriteria.forEach((c, i) => {
      parts.push(`${i + 1}. ${c}`)
    })
    parts.push('')
  }

  if (meta.constraints) {
    parts.push(isZh ? `## 约束条件` : `## Constraints`)
    parts.push(meta.constraints)
    parts.push('')
  }

  if (meta.references && meta.references.length > 0) {
    parts.push(isZh ? `## 参考资源` : `## References`)
    parts.push(isZh
      ? `以下资源可供参考，需要时使用 \`read_file\` 工具读取：`
      : `The following resources are available. Use the \`read_file\` tool to read on demand:`)
    parts.push('')
    meta.references.forEach((r, i) => {
      parts.push(`${i + 1}. \`${r}\``)
    })
    parts.push('')
  }

  return parts.join('\n')
}

/**
 * 构建输出规范块
 *
 * 要求 AI 在回复末尾以特定格式输出结构化结果块，
 * 供前端解析为结果卡片（摘要 / 产出文件 / 验收对照 / 后续建议）。
 *
 * 这是高质量结果的核心：让 AI 的产出从「散落在对话中」变为「结构化可验收」。
 */
function buildOutputSpecBlock(meta: TaskQualityMeta, isZh: boolean): string {
  const hasCriteria = meta.acceptanceCriteria && meta.acceptanceCriteria.length > 0

  const deliverableExample = isZh
    ? `- \`/src/auth/login.ts\` — 登录逻辑实现`
    : `- \`/src/auth/login.ts\` — Login logic implementation`

  const acceptanceExample = hasCriteria
    ? meta.acceptanceCriteria!.slice(0, 2).map(c => `- [x] ${c}`).join('\n')
    : (isZh
        ? `- [x] 实现核心功能\n- [ ] 边界场景处理`
        : `- [x] Core functionality implemented\n- [ ] Edge case handling`)

  return isZh
    ? `# 输出规范\n\n完成任务后，请在回复**末尾**按以下 Markdown 结构输出执行结果（纯标题，不要任何特殊分隔符），便于系统解析为结果卡片：\n\n\`\`\`markdown\n## 执行结果\n\n### 执行摘要\n（一段话总结做了什么，2-4 句）\n\n### 产出文件\n${deliverableExample}\n（每行一个，格式：\`文件路径\` — 描述；若无文件产出写「无」）\n\n### 验收对照\n${acceptanceExample}\n（逐条对照验收标准，[x] 通过 / [ ] 未通过，未通过需在末尾备注原因）\n\n### 后续建议\n（改进方向或待办事项，1-3 条；无则写「无」）\n\`\`\`\n\n**注意**：\`## 执行结果\` 之前的正文正常输出执行过程即可；\`## 执行结果\` 标题及其下的子节只放精炼的结果摘要，且必须放在回复最末尾。`
    : `# Output Specification\n\nAfter completing the task, output the execution result at the **end** of your reply using the following Markdown structure (plain headings, no special delimiters) for the system to parse into a result card:\n\n\`\`\`markdown\n## Execution Result\n\n### Summary\n(2-4 sentences summarizing what was done)\n\n### Deliverables\n${deliverableExample}\n(one per line, format: \`file path\` — description; or "None" if no files)\n\n### Acceptance Check\n${acceptanceExample}\n(check each criterion, [x] passed / [ ] not passed; note reason if not passed)\n\n### Follow-up\n(improvement suggestions or todos, 1-3 items; or "None")\n\`\`\`\n\n**Note**: Output the execution process as normal text before the \`## Execution Result\` heading. The heading and its sub-sections should only contain a concise result summary, and must appear at the very end of your reply.`
}

/**
 * 构建结果重生成提示词
 *
 * 当 AI 执行完成但回复中未包含可解析的结构化结果块时，
 * 发送此跟进消息，要求 AI 基于已完成的工作补充输出结构化结果块。
 *
 * 设计要点：
 * - 复用 buildOutputSpecBlock 的格式规范，保证格式一致（单一真相源，避免双份维护）
 * - 明确告知「仅输出结果块」，避免 AI 重复执行已完成的任务
 * - 注入任务的验收标准，让结果块的验收对照有据可依
 *
 * @param task 刚执行完的任务（用于读取 title 和 quality 元数据）
 * @param isZh 是否中文
 */
export function buildResultRegenerationPrompt(task: TaskItem, isZh: boolean): string {
  const qualityMeta = extractQualityMeta(task.metadata)
  const spec = buildOutputSpecBlock(qualityMeta, isZh)
  return isZh
    ? `你刚才完成了任务「${task.title}」，但回复中未包含可解析的结构化结果块。请基于已完成的工作，**仅补充输出**结构化结果块（不要重复执行过程）：\n\n${spec}\n\n请直接输出结果块。`
    : `You just completed task "${task.title}", but your reply did not include a parseable structured result block. Based on the work already done, please **only output** the structured result block (do not repeat the execution process):\n\n${spec}\n\nPlease output the result block directly.`
}

/**
 * 构建单任务执行提示词（含完整项目上下文）
 *
 * 结构：
 * 1. 项目背景（名称、描述、目标、全部任务列表）
 * 2. 当前任务详情（标题、描述、优先级、截止时间等）
 * 3. 执行指令
 */
export function buildTaskWithContextPrompt(
  task: TaskItem,
  project: ProjectContext,
  allTasks: TaskItem[],
  isZh: boolean,
): string {
  const parts: string[] = []

  // 1. 项目背景
  parts.push(buildProjectBackground(project, allTasks, isZh))

  // 2. 角色设定（质量增强）
  parts.push('')
  parts.push(buildRoleBlock(isZh))

  // 3. 当前任务详情
  parts.push('')
  parts.push(`---`)
  parts.push('')
  parts.push(isZh ? `# 当前需要执行的任务` : `# Task to Execute Now`)
  parts.push('')
  parts.push(`## ${task.title}`)

  if (task.description) {
    parts.push('')
    parts.push(task.description)
  }

  // 任务元信息
  const meta: string[] = []
  const priorityLabel = PRIORITY_LABELS[task.priority]
  meta.push(isZh ? `优先级：${priorityLabel?.[1] ?? task.priority}` : `Priority: ${priorityLabel?.[0] ?? task.priority}`)

  if (task.dueAt) {
    const dueStr = new Date(task.dueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')
    meta.push(isZh ? `截止时间：${dueStr}` : `Due: ${dueStr}`)
  }
  if (task.estimatedMin != null && task.estimatedMin > 0) {
    meta.push(isZh ? `预估耗时：${task.estimatedMin}分钟` : `Estimated: ${task.estimatedMin}min`)
  }
  if (task.tags.length > 0) {
    meta.push(isZh ? `标签：${task.tags.join('、')}` : `Tags: ${task.tags.join(', ')}`)
  }

  parts.push('')
  parts.push(meta.join(' · '))

  // 4. 质量元数据（预期产出 / 验收标准 / 约束 / 参考）
  const qualityMeta = extractQualityMeta(task.metadata)
  const qualityBlock = buildQualityMetaBlock(qualityMeta, isZh)
  if (qualityBlock) {
    parts.push('')
    parts.push(qualityBlock)
  }

  // 5. 执行指令（含自检要求）
  parts.push('')
  parts.push(
    isZh
      ? '## 执行要求\n\n请基于上述项目背景执行当前任务。执行时请注意：\n1. 理解项目整体目标，确保任务产出与项目方向一致\n2. 参考全部任务列表，避免与其他任务产生冲突或重复\n3. 严格遵守约束条件，按预期产出格式交付\n4. 完成后进行自检：逐条对照验收标准，未满足的需补充完善'
      : '## Execution Requirements\n\nPlease execute the current task based on the project background above. Note:\n1. Understand the overall project goal to ensure deliverables align with the project direction\n2. Reference the full task list to avoid conflicts or duplication with other tasks\n3. Strictly follow constraints and deliver in the expected output format\n4. Self-check after completion: verify each acceptance criterion, address any unmet items',
  )

  // 6. 输出规范（要求 AI 输出结构化结果块）
  parts.push('')
  parts.push(buildOutputSpecBlock(qualityMeta, isZh))

  return parts.join('\n')
}

/**
 * 构建批量执行提示词（一键执行全部任务）
 *
 * 结构：
 * 1. 项目背景（名称、描述、目标）
 * 2. 待执行任务列表（含详情）
 * 3. 执行指令：按顺序依次执行，每完成一个任务后总结并继续下一个
 */
export function buildBatchExecutionPrompt(
  project: ProjectContext,
  tasksToExecute: TaskItem[],
  allTasks: TaskItem[],
  isZh: boolean,
): string {
  const parts: string[] = []

  // 1. 项目背景
  parts.push(buildProjectBackground(project, allTasks, isZh))

  // 2. 待执行任务列表
  parts.push('')
  parts.push(isZh ? `---` : `---`)
  parts.push('')
  parts.push(
    isZh
      ? `# 批量执行任务\n\n以下 ${tasksToExecute.length} 个任务需要按顺序依次执行：`
      : `# Batch Execution\n\nThe following ${tasksToExecute.length} tasks need to be executed sequentially:`,
  )

  tasksToExecute.forEach((task, index) => {
    parts.push('')
    parts.push(isZh ? `## 任务 ${index + 1}：${task.title}` : `## Task ${index + 1}: ${task.title}`)

    if (task.description) {
      parts.push('')
      parts.push(task.description)
    }

    // 任务元信息
    const meta: string[] = []
    const priorityLabel = PRIORITY_LABELS[task.priority]
    meta.push(isZh ? `优先级：${priorityLabel?.[1] ?? task.priority}` : `Priority: ${priorityLabel?.[0] ?? task.priority}`)

    if (task.dueAt) {
      const dueStr = new Date(task.dueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')
      meta.push(isZh ? `截止时间：${dueStr}` : `Due: ${dueStr}`)
    }
    if (task.estimatedMin != null && task.estimatedMin > 0) {
      meta.push(isZh ? `预估耗时：${task.estimatedMin}分钟` : `Estimated: ${task.estimatedMin}min`)
    }
    if (task.tags.length > 0) {
      meta.push(isZh ? `标签：${task.tags.join('、')}` : `Tags: ${task.tags.join(', ')}`)
    }

    parts.push('')
    parts.push(meta.join(' · '))
  })

  // 3. 执行指令
  parts.push('')
  parts.push(isZh ? `---` : `---`)
  parts.push('')
  parts.push(
    isZh
      ? `## 执行要求\n\n请按上述顺序依次执行所有任务。执行时请注意：\n\n1. **理解项目全局**：每个任务都是项目的一部分，执行时需考虑项目整体目标\n2. **按顺序执行**：从任务 1 开始，完成后再执行任务 2，以此类推\n3. **每个任务完成后**：\n   - 简要总结做了什么、产出了哪些文件\n   - 如果遇到问题或阻塞，说明情况后可以跳过继续下一个任务\n4. **避免重复劳动**：参考全部任务概览，确保各任务产出不冲突\n5. **全部完成后**：提供整体执行总结，包括各任务完成情况、产出文件清单、后续建议\n\n请现在开始执行第一个任务。`
      : `## Execution Requirements\n\nPlease execute all tasks sequentially in the order listed above. Note:\n\n1. **Understand the big picture**: Each task is part of the project. Consider the overall project goal when executing.\n2. **Execute in order**: Start with Task 1, complete it, then move to Task 2, and so on.\n3. **After each task**:\n   - Briefly summarize what was done and which files were produced\n   - If blocked, explain the issue and skip to the next task\n4. **Avoid duplication**: Reference the full task overview to ensure no conflicts between task outputs\n5. **After all tasks**: Provide an overall execution summary, including task completion status, output file list, and follow-up suggestions\n\nPlease start with the first task now.`,
  )

  return parts.join('\n')
}

/**
 * 构建恢复对话时的上下文消息（含项目名）
 */
export function buildResumeWithContextMessage(
  task: TaskItem,
  project: ProjectContext,
  isZh: boolean,
): string {
  return isZh
    ? `继续执行项目「${project.name}」的任务「${task.title}」，请基于之前的上下文继续。`
    : `Continue working on task "${task.title}" of project "${project.name}". Please proceed based on the previous context.`
}

// ─── 顺序批量执行提示词（逐个发送，严格按序） ───────────────

/**
 * 构建批量执行的首个任务提示词（含完整项目背景）
 *
 * 结构：
 * 1. 项目背景（名称、描述、目标、全部任务列表、附件）
 * 2. 批量执行说明（共 N 个任务，按顺序执行）
 * 3. 第 1 个任务详情
 * 4. 执行指令
 *
 * 与 buildBatchExecutionPrompt 的区别：
 * - 只包含第 1 个任务的详情（而非全部任务详情）
 * - 后续任务通过 buildBatchNextTaskPrompt 逐个发送
 * - 严格保证 AI 按顺序执行（一次只处理一个任务）
 */
export function buildBatchStartPrompt(
  project: ProjectContext,
  firstTask: TaskItem,
  totalTasks: number,
  allTasks: TaskItem[],
  isZh: boolean,
): string {
  const parts: string[] = []

  // 1. 项目背景（含全部任务概览 + 附件）
  parts.push(buildProjectBackground(project, allTasks, isZh))

  // 2. 角色设定（质量增强）
  parts.push('')
  parts.push(buildRoleBlock(isZh))

  // 3. 批量执行说明
  parts.push('')
  parts.push(`---`)
  parts.push('')
  parts.push(
    isZh
      ? `# 批量执行\n\n本次需要按顺序执行 ${totalTasks} 个任务。现在开始执行第 1 个任务。`
      : `# Batch Execution\n\n${totalTasks} tasks will be executed sequentially. Starting with task 1 now.`,
  )

  // 4. 第 1 个任务详情
  parts.push('')
  parts.push(isZh ? `## 任务 1/${totalTasks}：${firstTask.title}` : `## Task 1/${totalTasks}: ${firstTask.title}`)

  if (firstTask.description) {
    parts.push('')
    parts.push(firstTask.description)
  }

  // 任务元信息
  const meta: string[] = []
  const priorityLabel = PRIORITY_LABELS[firstTask.priority]
  meta.push(isZh ? `优先级：${priorityLabel?.[1] ?? firstTask.priority}` : `Priority: ${priorityLabel?.[0] ?? firstTask.priority}`)
  if (firstTask.dueAt) {
    const dueStr = new Date(firstTask.dueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')
    meta.push(isZh ? `截止时间：${dueStr}` : `Due: ${dueStr}`)
  }
  if (firstTask.estimatedMin != null && firstTask.estimatedMin > 0) {
    meta.push(isZh ? `预估耗时：${firstTask.estimatedMin}分钟` : `Estimated: ${firstTask.estimatedMin}min`)
  }
  if (firstTask.tags.length > 0) {
    meta.push(isZh ? `标签：${firstTask.tags.join('、')}` : `Tags: ${firstTask.tags.join(', ')}`)
  }
  parts.push('')
  parts.push(meta.join(' · '))

  // 5. 质量元数据（预期产出 / 验收标准 / 约束 / 参考）
  const qualityMeta = extractQualityMeta(firstTask.metadata)
  const qualityBlock = buildQualityMetaBlock(qualityMeta, isZh)
  if (qualityBlock) {
    parts.push('')
    parts.push(qualityBlock)
  }

  // 6. 执行指令（含自检 + 输出规范）
  parts.push('')
  parts.push(
    isZh
      ? `## 执行要求\n\n请执行上述任务。完成后：\n1. 自检：逐条对照验收标准，未满足的需补充\n2. 按输出规范输出结构化结果块`
      : `## Execution Requirements\n\nPlease execute the task above. After completion:\n1. Self-check: verify each acceptance criterion, address any unmet items\n2. Output the structured result block per the output specification`,
  )

  parts.push('')
  parts.push(buildOutputSpecBlock(qualityMeta, isZh))

  return parts.join('\n')
}

/**
 * 构建前序任务产出块
 *
 * 批量执行时，将已完成任务的结构化结果注入后续任务 prompt，
 * 让 AI 知道前面做了什么、产出了什么文件，避免重复劳动或冲突。
 *
 * 只注入摘要和产出文件（不注入验收对照和后续建议），保持简洁。
 */
function buildPreviousResultsBlock(
  previousTasks: TaskItem[],
  isZh: boolean,
): string {
  const results: Array<{ task: TaskItem; result: TaskExecutionResult }> = []
  for (const t of previousTasks) {
    const r = extractExecutionResult(t.metadata)
    if (r) results.push({ task: t, result: r })
  }
  if (results.length === 0) return ''

  const parts: string[] = []
  parts.push(isZh ? `# 前序任务产出` : `# Previous Task Outputs`)
  parts.push(isZh
    ? `以下任务已执行完成，请基于已有产出继续，避免重复劳动：`
    : `The following tasks have been completed. Build upon their outputs and avoid duplication:`)
  parts.push('')

  results.forEach(({ task, result }, i) => {
    parts.push(`${i + 1}. **${task.title}**`)
    if (result.summary) {
      parts.push(`   ${isZh ? '摘要' : 'Summary'}: ${result.summary}`)
    }
    if (result.deliverables.length > 0) {
      parts.push(`   ${isZh ? '产出文件' : 'Deliverables'}:`)
      result.deliverables.forEach(d => {
        parts.push(`   - \`${d.path}\` — ${d.description}`)
      })
    }
  })
  parts.push('')
  return parts.join('\n')
}

/**
 * 构建批量执行的后续任务提示词（不含项目背景，项目上下文已建立）
 *
 * 结构：
 * 1. 前序任务产出（结构化注入，让 AI 知道前面做了什么）
 * 2. 上一任务完成 + 当前任务开始
 * 3. 当前任务详情（第 X/N 个）
 * 4. 执行指令
 *
 * 设计原则：
 * - 项目背景只在首个任务发送一次（节省 token）
 * - 后续任务只发送任务详情（AI 已有项目上下文）
 * - 前序任务产出结构化注入，避免 AI 重复创建已有文件
 * - 明确标注任务序号（X/N），让 AI 知道进度
 *
 * @param previousTasks 前序已完成任务列表（用于注入产出上下文）
 */
export function buildBatchNextTaskPrompt(
  task: TaskItem,
  taskIndex: number,
  totalTasks: number,
  isZh: boolean,
  previousTasks: TaskItem[] = [],
): string {
  const parts: string[] = []

  // 0. 前序任务产出（结构化注入）
  const prevBlock = buildPreviousResultsBlock(previousTasks, isZh)
  if (prevBlock) {
    parts.push(prevBlock)
    parts.push(`---`)
    parts.push('')
  }

  // 1. 上一任务完成 + 当前任务开始
  parts.push(
    isZh
      ? `上一个任务已完成。现在开始执行第 ${taskIndex + 1}/${totalTasks} 个任务。`
      : `Previous task complete. Now starting task ${taskIndex + 1}/${totalTasks}.`,
  )

  // 2. 当前任务详情
  parts.push('')
  parts.push(
    isZh
      ? `## 任务 ${taskIndex + 1}/${totalTasks}：${task.title}`
      : `## Task ${taskIndex + 1}/${totalTasks}: ${task.title}`,
  )

  if (task.description) {
    parts.push('')
    parts.push(task.description)
  }

  // 任务元信息
  const meta: string[] = []
  const priorityLabel = PRIORITY_LABELS[task.priority]
  meta.push(isZh ? `优先级：${priorityLabel?.[1] ?? task.priority}` : `Priority: ${priorityLabel?.[0] ?? task.priority}`)
  if (task.dueAt) {
    const dueStr = new Date(task.dueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')
    meta.push(isZh ? `截止时间：${dueStr}` : `Due: ${dueStr}`)
  }
  if (task.estimatedMin != null && task.estimatedMin > 0) {
    meta.push(isZh ? `预估耗时：${task.estimatedMin}分钟` : `Estimated: ${task.estimatedMin}min`)
  }
  if (task.tags.length > 0) {
    meta.push(isZh ? `标签：${task.tags.join('、')}` : `Tags: ${task.tags.join(', ')}`)
  }
  parts.push('')
  parts.push(meta.join(' · '))

  // 3. 质量元数据（预期产出 / 验收标准 / 约束 / 参考）
  const qualityMeta = extractQualityMeta(task.metadata)
  const qualityBlock = buildQualityMetaBlock(qualityMeta, isZh)
  if (qualityBlock) {
    parts.push('')
    parts.push(qualityBlock)
  }

  // 4. 执行指令（含自检 + 输出规范）
  parts.push('')
  parts.push(
    isZh
      ? `请执行上述任务。完成后：\n1. 自检：逐条对照验收标准，未满足的需补充\n2. 按输出规范输出结构化结果块`
      : `Please execute the task above. After completion:\n1. Self-check: verify each acceptance criterion, address any unmet items\n2. Output the structured result block per the output specification`,
  )

  parts.push('')
  parts.push(buildOutputSpecBlock(qualityMeta, isZh))

  return parts.join('\n')
}
