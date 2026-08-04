/**
 * 会议纪要功能共享类型契约
 *
 * 主进程与渲染进程共用，定义说话人、发言段、声纹档案、结构化纪要等数据结构。
 * 所有 IPC payload 也在此声明，确保两端类型对齐。
 */

// ============================================
// 说话人
// ============================================

/** 说话人预设角色 */
export type SpeakerRole =
  | 'me'
  | 'userA'
  | 'userB'
  | 'userC'
  | 'userD'
  | 'userE'
  | 'userF'
  | 'userG'
  | 'userH'
  | 'userI'

/** 说话人 */
export interface Speaker {
  /** 唯一 ID */
  id: string
  /** 预设角色 */
  role: SpeakerRole
  /** 显示名（可重命名） */
  name: string
  /** UI 标识颜色（hex） */
  color: string
  /** 关联的声纹档案 ID（若有） */
  voiceprintId?: string
  /** L3 自动聚类 ID（未注册段） */
  clusterId?: string
  /** 是否为自动聚类产生的说话人 */
  isAutoCluster?: boolean
  /** 发言段数（UI 展示用） */
  segmentCount?: number
}

// ============================================
// 发言段
// ============================================

/** 段处理状态（独立并行，不阻塞录音） */
export type SegmentState =
  | 'pending'
  | 'transcribing'
  | 'embedding'
  | 'translating'
  | 'done'
  | 'failed'

/** 会议发言段 */
export interface Segment {
  /** 唯一 ID */
  id: string
  /** 段开始时间戳（ms） */
  startTime: number
  /** 段结束时间戳（ms） */
  endTime: number
  /** 段时长（ms） */
  durationMs: number
  /** 关联 Speaker.id */
  speakerId: string

  /** 段平均 RMS（响度） */
  rms: number
  /** L2 人声概率 0-1（频谱特征计算） */
  voiceLikelihood: number
  /** L2 判定为环境音（true 则不进 STT） */
  isEnvironment: boolean

  /** STT 原文 */
  originalText: string
  /** 检测到的源语言 */
  detectedLang: string
  /** 中文译文（异步填充） */
  translatedText: string

  /** 段处理状态 */
  state: SegmentState
  /** STT 错误信息 */
  sttError?: string
  /** 翻译错误信息 */
  translateError?: string

  /** 声纹 embedding（主进程返回） */
  embedding?: number[]
  /** 说话人识别置信度 */
  speakerConfidence?: number

  /** 用户是否手动修改过说话人/文本 */
  manuallyEdited?: boolean
}

// ============================================
// 声纹档案
// ============================================

/** 声纹注册档案 */
export interface VoiceprintProfile {
  /** 唯一 ID */
  id: string
  /** 说话人名 */
  name: string
  /** 预设角色 */
  role: SpeakerRole
  /** 声纹向量 */
  embedding: number[]
  /** 创建时间戳 */
  createdAt: number
  /** 注册样本时长（ms） */
  sampleDurationMs: number
}

// ============================================
// 结构化会议纪要
// ============================================

/** 会议议题 */
export interface MeetingTopic {
  /** 议题标题 */
  title: string
  /** 讨论内容 */
  discussion: string
}

/** 待办事项 */
export interface ActionItem {
  /** 任务内容 */
  task: string
  /** 负责人 */
  assignee?: string
  /** 截止日期 */
  deadline?: string
}

/** 整理后的标准会议纪要 */
export interface MeetingMinutes {
  /** 会议标题 */
  title: string
  /** 会议日期 YYYY-MM-DD */
  date: string
  /** 开始时间 HH:mm */
  startTime: string
  /** 结束时间 HH:mm */
  endTime: string
  /** 参会人列表 */
  attendees: string[]
  /** 会议摘要 */
  summary: string
  /** 议题列表 */
  topics: MeetingTopic[]
  /** 决议列表 */
  decisions: string[]
  /** 待办事项 */
  actionItems: ActionItem[]
  /** 原始录音文件路径（引用） */
  rawTranscriptRef?: string
}

// ============================================
// 录音状态机
// ============================================

/** 会议整体状态 */
export type MeetingState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'finishing'
  | 'organizing'
  | 'done'
  | 'error'

// ============================================
// IPC Payload
// ============================================

/** 保存 txt 的段（精简，去掉 blob/embedding） */
export interface SegmentSnapshot {
  id: string
  startTime: number
  endTime: number
  speakerName: string
  speakerRole: SpeakerRole
  originalText: string
  translatedText: string
  isEnvironment: boolean
}

/** 保存录音原文的 IPC payload */
export interface SaveTranscriptPayload {
  /** 会议日期 YYYY-MM-DD */
  date: string
  /** 会议开始时间戳 */
  startTime: number
  /** 会议结束时间戳 */
  endTime: number
  /** 精简段列表 */
  segments: SegmentSnapshot[]
  /** 说话人列表 */
  speakers: Speaker[]
}

/** 保存录音原文的 IPC 返回 */
export interface SaveTranscriptResult {
  success: boolean
  /** txt 绝对路径 */
  filePath?: string
  /** 当天文件夹路径（docx 也存此目录） */
  dirPath?: string
  error?: string
}

/** 生成 docx 的 IPC payload */
export interface GenerateDocxPayload {
  /** 结构化纪要 */
  minutes: MeetingMinutes
  /** 会议日期 YYYY-MM-DD */
  date: string
  /** 会议开始时间戳 */
  startTime: number
}

/** 生成 docx 的 IPC 返回 */
export interface GenerateDocxResult {
  success: boolean
  filePath?: string
  error?: string
}

/** 翻译 IPC payload */
export interface TranslatePayload {
  /** 待翻译文本 */
  text: string
  /** LLM 配置（云端/本地） */
  llmConfig: unknown
}

/** 翻译 IPC 返回 */
export interface TranslateResult {
  success: boolean
  translated?: string
  /** 检测到的源语言 */
  detectedLang?: string
  /** 是否已是中文无需翻译 */
  skipped?: boolean
  error?: string
}

/** 整理纪要 IPC payload */
export interface OrganizePayload {
  /** 拼接后的完整转写文本 */
  transcript: string
  /** 说话人列表 */
  speakers: Speaker[]
  /** LLM 配置 */
  llmConfig: unknown
}

/** 整理进度推送（main→render） */
export interface OrganizeProgress {
  stage: 'analyzing' | 'extracting' | 'structuring' | 'done' | 'error'
  percent: number
  message?: string
}

/** 声纹 embedding IPC payload */
export interface VoiceprintEmbedPayload {
  /** 音频 PCM 数据（Float32Array 序列化） */
  audioBuffer: number[]
  /** 采样率 */
  sampleRate: number
}

/** 声纹 embedding IPC 返回 */
export interface VoiceprintEmbedResult {
  success: boolean
  embedding?: number[]
  error?: string
}

/** 声纹注册 IPC payload */
export interface VoiceprintRegisterPayload {
  name: string
  role: SpeakerRole
  audioBuffer: number[]
  sampleRate: number
}

/** 声纹可用性查询返回 */
export interface VoiceprintAvailability {
  /** 模型是否可用 */
  available: boolean
  /** 是否正在加载 */
  loading: boolean
  /** 不可用原因 */
  reason?: string
}
