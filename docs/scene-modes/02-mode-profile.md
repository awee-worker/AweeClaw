# B 阶段：ModeProfile 数据结构与切换机制

> SceneMode 类型定义、Profile 配置、Store、切换流程、集成点

## 一、类型定义

### 1.1 SceneMode 类型

新建文件 `src/shared/protocols/sceneModeProtocol.ts`：

```typescript
/**
 * 场景模式类型定义（共享）
 *
 * 与 WorkMode（chat/agent/plan，AI 推理深度）正交，
 * SceneMode 控制使用场景：工作 / 生活 / 学习
 */

/** 场景模式 */
export type SceneMode = 'work' | 'life' | 'study'

/** 记忆域 tag 前缀 */
export const MEMORY_DOMAIN_TAG_PREFIX = 'domain:'

/** 各场景的记忆域 tag */
export const SCENE_MODE_DOMAIN_TAG: Record<SceneMode, string> = {
  work: 'domain:work',
  life: 'domain:life',
  study: 'domain:study',
}

/** 跨域共享 tag */
export const SHARED_DOMAIN_TAG = 'domain:shared'

/** 规范化场景模式名称 */
export function normalizeSceneMode(mode: SceneMode): SceneMode {
  return mode
}

/** 判断是否为有效场景模式 */
export function isValidSceneMode(mode: string): mode is SceneMode {
  return mode === 'work' || mode === 'life' || mode === 'study'
}
```

### 1.2 SceneModeProfile 接口

新建文件 `src/renderer/intelligence/capabilities/sceneMode/SceneModeDescriptor.ts`：

```typescript
import type { SceneMode } from '@shared/protocols/sceneModeProtocol'
import type { WorkMode } from '@shared/protocols/workModeProtocol'

/** 悬浮头像风格 */
export interface AvatarStyle {
  theme: 'professional' | 'warm' | 'focused'
  primaryColor: string
  secondaryColor: string
  animation: 'subtle' | 'lively' | 'calm'
  expression: 'focused' | 'happy' | 'thoughtful'
  size: 'small' | 'medium' | 'large'
}

/** 语音音色配置 */
export interface VoiceProfile {
  voiceId: string
  speed: number
  pitch: number
  volume: number
}

/** 感知策略：控制哪些感知信号启用 */
export interface PerceptionFilter {
  /** 桌面窗口切换检测 */
  desktopWindowSwitching: boolean
  /** 活动应用检测 */
  activeAppTracking: boolean
  /** 日历事件 */
  calendarEvents: boolean
  /** 工作区文件改动 */
  workspaceFileChanges: boolean
  /** 屏幕久坐时长 */
  screenIdleTime: boolean
  /** 天气 */
  weather: boolean
  /** IoT 健康设备 */
  iotHealth: boolean
  /** 情绪分析 */
  emotionAnalysis: boolean
  /** IoT 环境传感器 */
  iotEnvironment: boolean
  /** 学习时长 */
  studyDuration: boolean
  /** 遗忘曲线计算 */
  forgettingCurve: boolean
}

/** 主动行为规则 */
export interface ProactiveRule {
  id: string
  name: string
  /** 触发条件描述（供规则引擎评估） */
  condition: string
  /** 行为类型 */
  action: 'notify' | 'remind' | 'suggest' | 'trigger-skill' | 'iot-control'
  /** 行为内容 */
  payload: string
  /** 是否启用 */
  enabled: boolean
}

/** Cron 任务定义 */
export interface SceneCronJob {
  id: string
  name: string
  /** Cron 表达式 */
  schedule: string
  /** 触发的技能或行为 */
  action: string
  enabled: boolean
}

/** 场景模式描述符 */
export interface SceneModeProfile {
  /** 模式 ID */
  id: SceneMode
  /** 显示名称 */
  displayName: string
  /** 中文名称 */
  displayNameZh: string
  /** 描述 */
  description: string
  /** 图标（lucide name） */
  icon: string

  /** 智能体人设提示词 */
  personaPrompt: string

  /** 挂载的技能白名单（技能 name 列表） */
  modeSkills: string[]

  /** 记忆域 tag */
  memoryDomainTag: string

  /** 感知策略 */
  perceptionFilter: PerceptionFilter

  /** 主动行为规则 */
  proactiveRules: ProactiveRule[]

  /** 悬浮头像风格 */
  avatarStyle: AvatarStyle

  /** 语音音色 */
  voiceProfile: VoiceProfile

  /** Cron 任务 */
  cronJobs: SceneCronJob[]

  /** 推荐的默认 WorkMode（推理深度） */
  defaultWorkMode: WorkMode

  /** 工作时间配置（仅工作模式有效） */
  workHours?: {
    start: string  // "09:00"
    end: string    // "18:00"
    days: number[] // [1,2,3,4,5] 周一到周五
  }
}
```

## 二、三种模式的默认 Profile

新建文件 `src/renderer/intelligence/capabilities/sceneMode/SceneModeProfiles.ts`：

```typescript
import type { SceneModeProfile } from './SceneModeDescriptor'

/** 工作模式 Profile */
export const WORK_MODE_PROFILE: SceneModeProfile = {
  id: 'work',
  displayName: 'Work',
  displayNameZh: '工作',
  description: '严谨的执行型助理 — 提效、聚焦、减负',
  icon: 'Briefcase',
  personaPrompt: `你是 AweeClaw 工作助理，一位严谨、高效、专业的执行型办公伙伴。
你的风格是：简洁、准确、行动导向，不说废话。
回答直接了当，先给结论再展开细节。主动识别任务、风险、跟进项。
不主动聊生活话题，不在线工作记忆域写入生活/学习内容。`,
  modeSkills: [
    'work-email-draft', 'work-meeting-prep', 'work-meeting-notes',
    'work-task-extract', 'work-doc-summary', 'work-focus-guard',
    'work-schedule', 'work-report', 'remote-command',
  ],
  memoryDomainTag: 'domain:work',
  perceptionFilter: {
    desktopWindowSwitching: true,
    activeAppTracking: true,
    calendarEvents: true,
    workspaceFileChanges: true,
    screenIdleTime: true,
    weather: false,
    iotHealth: false,
    emotionAnalysis: false,
    iotEnvironment: false,
    studyDuration: false,
    forgettingCurve: false,
  },
  proactiveRules: [
    { id: 'meeting-prep', name: '会议准备提醒', condition: 'calendar_event_in_15min', action: 'notify', payload: 'meeting-prep-card', enabled: true },
    { id: 'task-followup', name: '任务跟进', condition: 'task_due_in_1day', action: 'remind', payload: 'task-followup', enabled: true },
    { id: 'focus-guard', name: '专注守护', condition: 'window_switching_high', action: 'suggest', payload: 'focus-guard', enabled: true },
    { id: 'standup-reminder', name: '久坐提醒', condition: 'idle_90min', action: 'suggest', payload: 'standup', enabled: true },
    { id: 'weekly-report', name: '周报提醒', condition: 'friday_16pm', action: 'remind', payload: 'work-report', enabled: true },
  ],
  avatarStyle: {
    theme: 'professional',
    primaryColor: '#3B82F6',
    secondaryColor: '#64748B',
    animation: 'subtle',
    expression: 'focused',
    size: 'medium',
  },
  voiceProfile: {
    voiceId: 'professional-male',
    speed: 1.1,
    pitch: 0,
    volume: 0.8,
  },
  cronJobs: [
    { id: 'weekly-report', name: '周报提醒', schedule: '0 16 * * 5', action: 'work-report', enabled: true },
    { id: 'focus-check', name: '专注检查', schedule: '*/5 * * * *', action: 'work-focus-guard', enabled: true },
    { id: 'standup-check', name: '久坐检查', schedule: '*/15 * * * *', action: 'standup-check', enabled: true },
  ],
  defaultWorkMode: 'agent',
  workHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
}

/** 生活模式 Profile */
export const LIFE_MODE_PROFILE: SceneModeProfile = {
  id: 'life',
  displayName: 'Life',
  displayNameZh: '生活',
  description: '温暖的陪伴型助手 — 放松、陪伴、健康',
  icon: 'Heart',
  personaPrompt: `你是 AweeClaw 生活伙伴，一位温暖、贴心、懂你的数字朋友。
你的风格是：亲切、温暖、有同理心，像朋友一样聊天。
用温柔的语气交流，多用鼓励和关怀的话语。主动关心健康：喝水、起身、护眼。
不主动谈工作，不在线生活记忆域写入工作/学习内容。`,
  modeSkills: [
    'life-health-reminder', 'life-weather', 'life-mood-companion',
    'life-accounting', 'life-shopping-list', 'life-recipe',
    'life-sleep', 'life-relationship', 'life-iot-control',
  ],
  memoryDomainTag: 'domain:life',
  perceptionFilter: {
    desktopWindowSwitching: false,
    activeAppTracking: false,
    calendarEvents: false,
    workspaceFileChanges: false,
    screenIdleTime: true,
    weather: true,
    iotHealth: true,
    emotionAnalysis: true,
    iotEnvironment: true,
    studyDuration: false,
    forgettingCurve: false,
  },
  proactiveRules: [
    { id: 'water-reminder', name: '喝水提醒', condition: 'every_hour', action: 'remind', payload: 'drink-water', enabled: true },
    { id: 'standup-reminder', name: '起身提醒', condition: 'idle_45min', action: 'suggest', payload: 'standup', enabled: true },
    { id: 'mood-care', name: '情绪关怀', condition: 'emotion_low', action: 'trigger-skill', payload: 'life-mood-companion', enabled: true },
    { id: 'sleep-reminder', name: '睡眠提醒', condition: 'time_23pm', action: 'remind', payload: 'sleep', enabled: true },
    { id: 'birthday-check', name: '生日检查', condition: 'daily_9am', action: 'remind', payload: 'birthday-check', enabled: true },
  ],
  avatarStyle: {
    theme: 'warm',
    primaryColor: '#F97316',
    secondaryColor: '#EC4899',
    animation: 'lively',
    expression: 'happy',
    size: 'medium',
  },
  voiceProfile: {
    voiceId: 'warm-female',
    speed: 0.95,
    pitch: 1,
    volume: 0.9,
  },
  cronJobs: [
    { id: 'water', name: '喝水提醒', schedule: '0 * * * *', action: 'drink-water', enabled: true },
    { id: 'standup', name: '起身提醒', schedule: '*/45 * * * *', action: 'standup', enabled: true },
    { id: 'sleep', name: '睡眠提醒', schedule: '0 23 * * *', action: 'sleep-reminder', enabled: true },
    { id: 'morning', name: '早晨问候', schedule: '0 7 * * *', action: 'morning-greeting', enabled: true },
    { id: 'birthday', name: '生日检查', schedule: '0 9 * * *', action: 'birthday-check', enabled: true },
  ],
  defaultWorkMode: 'chat',
}

/** 学习模式 Profile */
export const STUDY_MODE_PROFILE: SceneModeProfile = {
  id: 'study',
  displayName: 'Study',
  displayNameZh: '学习',
  description: '耐心的苏格拉底式导师 — 吸收、巩固、成长',
  icon: 'GraduationCap',
  personaPrompt: `你是 AweeClaw 学习导师，一位耐心、循循善诱的苏格拉底式导师。
你的风格是：引导式、启发式、不直接给答案，用反问引导思考。
苏格拉底式问答：不直接给答案，用反问引导用户思考。
费曼学习法：学完一节，引导用户"用自己的话讲给我听"。
主动召回：复习时出题，而非被动重读。不主动谈工作/生活。`,
  modeSkills: [
    'study-note-extract', 'study-flashcard', 'study-feynman',
    'study-socratic', 'study-quiz', 'study-review-scheduler',
    'study-knowledge-graph', 'study-progress', 'study-plan',
  ],
  memoryDomainTag: 'domain:study',
  perceptionFilter: {
    desktopWindowSwitching: false,
    activeAppTracking: true,
    calendarEvents: false,
    workspaceFileChanges: true,
    screenIdleTime: true,
    weather: false,
    iotHealth: false,
    emotionAnalysis: false,
    iotEnvironment: false,
    studyDuration: true,
    forgettingCurve: true,
  },
  proactiveRules: [
    { id: 'review-reminder', name: '复习提醒', condition: 'forgetting_curve_due', action: 'trigger-skill', payload: 'study-quiz', enabled: true },
    { id: 'study-reminder', name: '学习提醒', condition: 'study_time', action: 'remind', payload: 'study-start', enabled: true },
    { id: 'rest-reminder', name: '休息提醒', condition: 'study_2hours', action: 'suggest', payload: 'rest', enabled: true },
    { id: 'feynman-guide', name: '费曼引导', condition: 'knowledge_completed', action: 'trigger-skill', payload: 'study-feynman', enabled: true },
    { id: 'weekly-report', name: '学习周报', condition: 'sunday_8pm', action: 'trigger-skill', payload: 'study-progress', enabled: true },
  ],
  avatarStyle: {
    theme: 'focused',
    primaryColor: '#10B981',
    secondaryColor: '#14B8A6',
    animation: 'calm',
    expression: 'thoughtful',
    size: 'medium',
  },
  voiceProfile: {
    voiceId: 'patient-mentor',
    speed: 1.0,
    pitch: 0,
    volume: 0.85,
  },
  cronJobs: [
    { id: 'review-check', name: '复习检查', schedule: '0 9 * * *', action: 'review-check', enabled: true },
    { id: 'weekly-report', name: '学习周报', schedule: '0 20 * * 0', action: 'study-progress', enabled: true },
  ],
  defaultWorkMode: 'agent',
}

/** 全部 Profile 映射 */
export const SCENE_MODE_PROFILES: Record<string, SceneModeProfile> = {
  work: WORK_MODE_PROFILE,
  life: LIFE_MODE_PROFILE,
  study: STUDY_MODE_PROFILE,
}
```

## 三、SceneModeRegistry（注册表）

新建文件 `src/renderer/intelligence/capabilities/sceneMode/SceneModeRegistry.ts`：

```typescript
import { logger } from '@toolkit/LogEngine'
import type { SceneMode } from '@shared/protocols/sceneModeProtocol'
import { isValidSceneMode } from '@shared/protocols/sceneModeProtocol'
import type { SceneModeProfile } from './SceneModeDescriptor'
import { SCENE_MODE_PROFILES, WORK_MODE_PROFILE } from './SceneModeProfiles'

export class SceneModeRegistry {
  private profiles: Map<SceneMode, SceneModeProfile> = new Map()

  constructor() {
    // 注册默认 Profile
    Object.values(SCENE_MODE_PROFILES).forEach(profile => {
      this.profiles.set(profile.id, profile)
    })
    logger.agent.info('[SceneModeRegistry] Initialized with 3 scene modes')
  }

  /** 注册自定义 Profile */
  register(profile: SceneModeProfile): void {
    this.profiles.set(profile.id, profile)
    logger.agent.debug(`[SceneModeRegistry] Registered scene mode: ${profile.id}`)
  }

  /** 获取 Profile */
  get(mode: SceneMode | string): SceneModeProfile | undefined {
    return this.profiles.get(mode as SceneMode)
  }

  /** 获取 Profile，带回退到工作模式 */
  getOrDefault(mode: SceneMode | string): SceneModeProfile {
    const profile = this.get(mode)
    if (!profile) {
      logger.agent.warn(`[SceneModeRegistry] Unknown scene mode: ${mode}, falling back to work`)
      return WORK_MODE_PROFILE
    }
    return profile
  }

  /** 是否已注册 */
  has(mode: SceneMode | string): boolean {
    return this.profiles.has(mode as SceneMode)
  }

  /** 获取所有模式 */
  getAllModes(): SceneMode[] {
    return Array.from(this.profiles.keys())
  }

  /** 获取所有 Profile */
  getAllProfiles(): SceneModeProfile[] {
    return Array.from(this.profiles.values())
  }

  /** 规范化模式名 */
  normalize(mode: string): SceneMode | null {
    return isValidSceneMode(mode) ? mode : null
  }
}

/** 单例 */
export const sceneModeRegistry = new SceneModeRegistry()
```

## 四、SceneModeStore（状态管理）

新建文件 `src/renderer/modes/sceneModeStore.ts`：

```typescript
/**
 * 场景模式状态管理
 *
 * 通过 electron-store 持久化，与 workModeStore 同存储后端。
 * 切换模式时触发各子系统的配置切换。
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SceneMode } from '@shared/protocols/sceneModeProtocol'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
import type { SceneModeProfile } from '@intelligence/capabilities/sceneMode/SceneModeDescriptor'
import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

const STORE_KEY = 'sceneModeStore'

interface SceneModeState {
  /** 当前场景模式 */
  currentSceneMode: SceneMode
  /** 上一个模式（用于切换回去） */
  previousSceneMode: SceneMode | null
  /** 当前激活的 Profile（缓存，避免每次查 registry） */
  activeProfile: SceneModeProfile
}

interface SceneModeActions {
  /** 设置当前场景模式 */
  setSceneMode: (mode: SceneMode) => Promise<void>
  /** 切换回上一个模式 */
  restorePreviousSceneMode: () => Promise<void>
  /** 检查是否为指定模式 */
  isSceneMode: (mode: SceneMode) => boolean
  /** 获取当前 Profile */
  getActiveProfile: () => SceneModeProfile
}

type SceneModeStore = SceneModeState & SceneModeActions

/** 自定义 Storage：通过 IPC 存到 electron-store */
const electronStoreStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await api.settings.get(`${STORE_KEY}.${name}`)
      return value ? JSON.stringify(value) : null
    } catch {
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value)
      await api.settings.set(`${STORE_KEY}.${name}`, parsed)
    } catch { /* ignore */ }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await api.settings.set(`${STORE_KEY}.${name}`, undefined)
    } catch { /* ignore */ }
  },
}

/** 模式切换监听器（供各子系统注册，切换时回调） */
type SceneModeChangeListener = (newMode: SceneMode, profile: SceneModeProfile) => void | Promise<void>
const sceneModeListeners: Set<SceneModeChangeListener> = new Set()

export function addSceneModeListener(fn: SceneModeChangeListener): () => void {
  sceneModeListeners.add(fn)
  return () => sceneModeListeners.delete(fn)
}

async function notifySceneModeChange(mode: SceneMode, profile: SceneModeProfile) {
  for (const listener of sceneModeListeners) {
    try {
      await listener(mode, profile)
    } catch (err) {
      logger.agent.warn('[SceneModeStore] Listener error:', err)
    }
  }
}

export const useSceneModeStore = create<SceneModeStore>()(
  persist(
    (set, get) => ({
      currentSceneMode: 'work',
      previousSceneMode: null,
      activeProfile: sceneModeRegistry.getOrDefault('work'),

      setSceneMode: async (mode) => {
        const current = get().currentSceneMode
        if (current === mode) return

        const profile = sceneModeRegistry.getOrDefault(mode)
        logger.agent.info(`[SceneModeStore] Switching scene mode: ${current} -> ${mode}`)

        set({
          currentSceneMode: mode,
          previousSceneMode: current,
          activeProfile: profile,
        })

        // 通知各子系统切换配置
        await notifySceneModeChange(mode, profile)
      },

      restorePreviousSceneMode: async () => {
        const previous = get().previousSceneMode
        if (!previous) return

        const profile = sceneModeRegistry.getOrDefault(previous)
        logger.agent.info(`[SceneModeStore] Restoring previous scene mode: ${previous}`)

        set({
          currentSceneMode: previous,
          previousSceneMode: null,
          activeProfile: profile,
        })

        await notifySceneModeChange(previous, profile)
      },

      isSceneMode: (mode) => get().currentSceneMode === mode,

      getActiveProfile: () => get().activeProfile,
    }),
    {
      name: 'aweeclaw-scene-mode-store',
      storage: createJSONStorage(() => electronStoreStorage),
      partialize: (state) => ({
        currentSceneMode: state.currentSceneMode,
      }),
    },
  ),
)
```

## 五、切换流程

```
用户切换模式 (UI/语音/命令面板)
         │
         ▼
useSceneModeStore.setSceneMode('life')
         │
         ├─ 1. 更新 state: currentSceneMode, activeProfile
         ├─ 2. 持久化到 electron-store
         ├─ 3. notifySceneModeChange() 通知监听器
         │
         ▼
┌──────────────────────────────────────────────────┐
│  各子系统监听器（通过 addSceneModeListener 注册）  │
├──────────────────────────────────────────────────┤
│                                                  │
│  ▸ PromptComposer 监听器                         │
│    - 注入新 personaPrompt                         │
│    - 注入场景指令到 additionalSections            │
│                                                  │
│  ▸ SkillService 监听器                           │
│    - 按 modeSkills 白名单过滤可用技能              │
│                                                  │
│  ▸ KnowledgeService 监听器                       │
│    - search 时按 memoryDomainTag 过滤             │
│    - addEntry 时自动注入 domain tag              │
│                                                  │
│  ▸ LongTermMemoryService 监听器                  │
│    - recall 时按 memoryDomainTag 过滤             │
│    - addEntry 时自动注入 domain tag              │
│                                                  │
│  ▸ ProactiveService 监听器                       │
│    - 切换 proactiveRules                         │
│    - 更新主动行为策略                              │
│                                                  │
│  ▸ FloatingAvatar 监听器                        │
│    - 切换 avatarStyle（颜色/动画/表情）           │
│                                                  │
│  ▸ VoiceChat 监听器                             │
│    - 切换 voiceProfile（音色/语速/音调）          │
│                                                  │
│  ▸ CronScheduler 监听器                         │
│    - 暂停旧模式专属 Cron 任务                     │
│    - 激活新模式专属 Cron 任务                    │
│                                                  │
│  ▸ PerceptionService 监听器                     │
│    - 按 perceptionFilter 启用/禁用感知信号        │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 六、与现有系统的集成点

### 6.1 PromptComposer 集成

修改 [PromptComposer.ts](../../src/renderer/intelligence/prompt-engine/PromptComposer.ts)：

```typescript
// 在 PromptContext 中新增字段
export interface PromptContext {
  // ... 现有字段 ...
  /** 场景模式人设提示词（新增） */
  scenePersonaPrompt?: string
  /** 场景模式指令段落（新增） */
  sceneModeDirectives?: string | null
}

// buildSystemPrompt 中注入场景人设（在 personality 之后）
export function buildSystemPrompt(ctx: PromptContext): string {
  const identity = getActiveScenarioIdentity()
  const sections: (string | null)[] = [
    ctx.personality,
    ctx.scenePersonaPrompt ?? null,        // 新增：场景人设
    identity.systemPrompt,
    // ... 其他现有段落 ...
    ctx.sceneModeDirectives ?? null,       // 新增：场景指令
  ]
  return sections.filter(Boolean).join('\n\n')
}

// buildAgentSystemPrompt 中读取当前场景 Profile
export async function buildAgentSystemPrompt(...): Promise<...> {
  const { useSceneModeStore } = await import('@/renderer/modes/sceneModeStore')
  const sceneProfile = useSceneModeStore.getState().getActiveProfile()

  const ctx: PromptContext = {
    // ... 现有字段 ...
    scenePersonaPrompt: sceneProfile.personaPrompt,
    sceneModeDirectives: buildSceneModeDirectives(sceneProfile),
  }
  // ...
}

/** 构建场景模式指令段落 */
function buildSceneModeDirectives(profile: SceneModeProfile): string {
  const parts: string[] = [
    `## ${profile.displayNameZh}模式指令`,
    `当前处于「${profile.displayNameZh}」场景模式。`,
    `记忆域：${profile.memoryDomainTag}（仅读写此域 + domain:shared 共享域）。`,
  ]
  if (profile.modeSkills.length > 0) {
    parts.push(`可用技能：${profile.modeSkills.join(', ')}`)
  }
  return parts.join('\n')
}
```

### 6.2 SkillService 集成

修改 [skillRepository.ts](../../src/renderer/intelligence/runtime/skillRepository.ts)：

```typescript
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'

// 在 getSkills() 中按场景模式过滤
async getSkills(): Promise<SkillItem[]> {
  const allSkills = await this.loadSkills()
  const { activeProfile, currentSceneMode } = useSceneModeStore.getState()

  // 如果技能有 metadata.sceneMode 标记，按场景过滤
  // 否则所有技能都可见（向后兼容）
  const filtered = allSkills.filter(skill => {
    // 无场景标记的技能，所有模式可见
    if (!skill.metadata?.sceneMode) return true
    // 有标记的，只在该模式可见
    const modes = skill.metadata.sceneMode.split(',')
    return modes.includes(currentSceneMode)
  })

  return filtered
}
```

### 6.3 KnowledgeService 集成

修改 [knowledgeService/index.ts](../../src/renderer/intelligence/runtime/knowledgeService/index.ts)：

```typescript
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'

// search 时按记忆域 tag 过滤
async search(params: KnowledgeSearchParams): Promise<KnowledgeSearchResult[]> {
  const { activeProfile } = useSceneModeStore.getState()
  const domainTag = activeProfile.memoryDomainTag

  // 注入 tag 过滤：domain:xxx OR domain:shared
  const tags = params.tags || []
  const domainTags = [domainTag, 'domain:shared']

  // 改造搜索逻辑：条目 tags 包含 domainTag 或 shared 才返回
  const results = await this.rawSearch({
    ...params,
    tags: [...tags, ...domainTags],
    tagMatchMode: 'any', // 任一匹配即可
  })
  return results
}

// addEntry 时自动注入 domain tag
async addEntry(input: KnowledgeEntryInput): Promise<KnowledgeEntry> {
  const { activeProfile } = useSceneModeStore.getState()
  const domainTag = activeProfile.memoryDomainTag

  const tags = input.tags || []
  // 避免重复注入
  if (!tags.includes(domainTag) && !tags.some(t => t.startsWith('domain:'))) {
    tags.push(domainTag)
  }

  return this.rawAddEntry({ ...input, tags })
}
```

### 6.4 LongTermMemoryService 集成

修改 [longTermMemoryService/index.ts](../../src/renderer/intelligence/runtime/longTermMemoryService/index.ts)：

```typescript
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'

// recall 时按记忆域过滤
async recall(query: string, limit?: number): Promise<MemoryEntry[]> {
  const { activeProfile } = useSceneModeStore.getState()
  const domainTag = activeProfile.memoryDomainTag

  const all = await this.rawRecall(query, limit * 3) // 多取一些再过滤
  // 过滤：tags 包含 domainTag 或 shared
  const filtered = all.filter(entry =>
    entry.tags.includes(domainTag) ||
    entry.tags.includes('domain:shared') ||
    entry.tags.length === 0 // 无 tag 的旧数据视为共享（向后兼容）
  )
  return filtered.slice(0, limit)
}

// addEntry 时自动注入 domain tag
async addEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
  const { activeProfile } = useSceneModeStore.getState()
  const domainTag = activeProfile.memoryDomainTag

  const tags = input.tags || []
  if (!tags.includes(domainTag) && !tags.some(t => t.startsWith('domain:'))) {
    tags.push(domainTag)
  }

  return this.rawAddEntry({ ...input, tags })
}
```

### 6.5 FloatingAvatar 集成

通过监听器切换头像风格：

```typescript
import { addSceneModeListener } from '@/renderer/modes/sceneModeStore'

// 在 floating-avatar 模块初始化时注册监听
addSceneModeListener(async (mode, profile) => {
  await api.floatingAvatar.setStyle({
    theme: profile.avatarStyle.theme,
    primaryColor: profile.avatarStyle.primaryColor,
    secondaryColor: profile.avatarStyle.secondaryColor,
    animation: profile.avatarStyle.animation,
    expression: profile.avatarStyle.expression,
  })
})
```

### 6.6 VoiceChat 集成

通过监听器切换语音音色：

```typescript
import { addSceneModeListener } from '@/renderer/modes/sceneModeStore'

// 在 voice chat composable 初始化时注册监听
addSceneModeListener(async (mode, profile) => {
  await api.voice.setVoiceProfile({
    voiceId: profile.voiceProfile.voiceId,
    speed: profile.voiceProfile.speed,
    pitch: profile.voiceProfile.pitch,
    volume: profile.voiceProfile.volume,
  })
})
```

### 6.7 CronScheduler 集成

通过监听器切换 Cron 任务：

```typescript
import { addSceneModeListener } from '@/renderer/modes/sceneModeStore'

// 在 CronScheduler 初始化时注册监听
addSceneModeListener(async (mode, profile) => {
  // 暂停旧模式专属任务（通过 sceneMode 前缀标记）
  await api.automation.pauseJobsByPrefix(`scene:${previousMode}:`)
  // 激活新模式专属任务
  await api.automation.resumeJobsByPrefix(`scene:${mode}:`)

  // 注册新模式专属 Cron 任务
  for (const job of profile.cronJobs) {
    if (job.enabled) {
      await api.automation.registerJob({
        id: `scene:${mode}:${job.id}`,
        schedule: job.schedule,
        action: job.action,
      })
    }
  }
})
```

## 七、模块导出

新建文件 `src/renderer/intelligence/capabilities/sceneMode/index.ts`：

```typescript
/**
 * 场景模式基础设施入口
 */
export * from './SceneModeDescriptor'
export * from './SceneModeProfiles'
export * from './SceneModeRegistry'
```

在 [domains.ts](../../src/renderer/intelligence/domains.ts) 中新增导出：

```typescript
// 场景模式领域（新增）
export * from './capabilities/sceneMode'
```

## 八、文件清单（B 阶段新增/修改）

### 新增文件
| 文件 | 说明 |
|---|---|
| `src/shared/protocols/sceneModeProtocol.ts` | SceneMode 类型定义 |
| `src/renderer/intelligence/capabilities/sceneMode/SceneModeDescriptor.ts` | Profile 接口 |
| `src/renderer/intelligence/capabilities/sceneMode/SceneModeProfiles.ts` | 三模式默认 Profile |
| `src/renderer/intelligence/capabilities/sceneMode/SceneModeRegistry.ts` | 注册表 |
| `src/renderer/intelligence/capabilities/sceneMode/index.ts` | 模块入口 |
| `src/renderer/modes/sceneModeStore.ts` | Store + 监听器机制 |

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/renderer/intelligence/domains.ts` | 新增 sceneMode 导出 |
| `src/renderer/intelligence/prompt-engine/PromptComposer.ts` | 注入 personaPrompt + 场景指令 |
| `src/renderer/intelligence/runtime/skillRepository.ts` | 按场景过滤技能 |
| `src/renderer/intelligence/runtime/knowledgeService/index.ts` | 按域 tag 过滤 + 自动注入 |
| `src/renderer/intelligence/runtime/longTermMemoryService/index.ts` | 按域 tag 过滤 + 自动注入 |

### 延伸集成（C/D 阶段实现）
| 文件 | 改动 |
|---|---|
| FloatingAvatar 模块 | 监听切换 avatarStyle |
| VoiceChat composable | 监听切换 voiceProfile |
| CronScheduler | 监听切换 Cron 任务 |
| ProactiveService | 监听切换 proactiveRules |
| PerceptionService | 监听切换 perceptionFilter |
