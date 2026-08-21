# D 阶段详细实施文档：语音/Cron/主动行为/感知策略切换

> 本文档覆盖 D-step2 ~ D-step5 的完整实现细节，作为 03-implementation.md 的补充。

## 一、D-步骤2：语音音色切换

### 1.1 设计目标

三种场景模式使用不同的 TTS 音色配置：
- **工作模式**：干练男声，语速 1.1x（高效专业）
- **生活模式**：温暖女声，语速 0.95x（亲切陪伴）
- **学习模式**：耐心导师声，语速 1.0x（沉稳引导）

### 1.2 技术方案

#### 问题分析

SceneMode 的 `voiceProfile.voiceId` 是抽象标识（如 `professional-male`），而实际 TTS Provider 使用不同的音色 ID：
- OpenAI TTS: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`
- Aliyun CosyVoice: `longxiaochun`, `longcheng`, `longwan` 等
- SiliconFlow: `<model>:<voice>` 格式

需要一层映射将抽象 voiceId 转换为 Provider 特定的音色 ID。

#### 实现架构

```
SceneModeProfile.voiceProfile (抽象)
        │
        ▼
SceneVoiceResolver (映射层)
   ├── 读取 userVoiceConfig.ttsProvider (用户配置的 Provider)
   ├── 将抽象 voiceId 映射为 Provider 特定音色
   └── 合并 speed/volume 覆盖
        │
        ▼
voiceApi.textToSpeech(text, { voice, speed })
```

#### 新建文件：`sceneVoiceResolver.ts`

位置：`src/renderer/intelligence/capabilities/sceneMode/sceneVoiceResolver.ts`

```typescript
/**
 * 抽象音色 → Provider 音色映射表
 *
 * 当用户配置了 TTS Provider 时，将场景模式的抽象 voiceId
 * 映射为该 Provider 支持的具体音色 ID。
 */
const VOICE_ID_MAPPING: Record<string, Record<string, string>> = {
  'professional-male': {
    openai: 'echo',       // 男声，沉稳专业
    aliyun: 'longcheng',  // 男声
    siliconflow: 'alex',  // SiliconFlow 音色
    default: 'echo',
  },
  'warm-female': {
    openai: 'nova',       // 女声，温暖
    aliyun: 'longxiaochun', // 女声，温暖
    siliconflow: 'anna',
    default: 'nova',
  },
  'patient-mentor': {
    openai: 'fable',      // 中性，耐心
    aliyun: 'longwan',    // 中性
    siliconflow: 'bella',
    default: 'fable',
  },
}

export interface ResolvedVoiceConfig {
  voice: string
  speed: number
}

/**
 * 解析场景模式音色配置
 *
 * 优先级：场景模式 voiceProfile > 用户 TTS 配置 > 默认值
 *
 * @param sceneVoiceProfile  场景模式的 voiceProfile
 * @param ttsProvider        用户配置的 TTS Provider
 * @param userTtsVoice       用户配置的 TTS 音色（作为 fallback）
 * @param userTtsSpeed       用户配置的 TTS 语速（作为 fallback）
 */
export function resolveSceneVoice(
  sceneVoiceProfile: { voiceId: string; speed: number; volume: number } | null | undefined,
  ttsProvider: string | undefined,
  userTtsVoice: string | undefined,
  userTtsSpeed: number | undefined,
): ResolvedVoiceConfig {
  // 无场景音色配置时，回退到用户配置
  if (!sceneVoiceProfile) {
    return {
      voice: userTtsVoice || 'alloy',
      speed: userTtsSpeed ?? 1.0,
    }
  }

  // 尝试映射抽象 voiceId 为 Provider 特定音色
  const providerKey = (ttsProvider || 'openai').toLowerCase()
  const mapping = VOICE_ID_MAPPING[sceneVoiceProfile.voiceId]
  const mappedVoice = mapping
    ? (mapping[providerKey] || mapping.default)
    : (userTtsVoice || 'alloy')

  return {
    voice: mappedVoice,
    speed: sceneVoiceProfile.speed ?? userTtsSpeed ?? 1.0,
  }
}
```

#### 修改文件：`useSceneModeEffects.ts`

在 `useSceneModeEffects` 中新增语音音色切换监听器：

```typescript
// 注册语音音色切换监听器
const unsubscribeVoice = addSceneModeListener(async (_mode, profile) => {
  try {
    // 通过 IPC 通知主进程更新 VoiceContext 中的场景音色配置
    // 主窗口的 VoiceConversationOverlay 会读取 useSceneModeStore 获取最新音色
    // 头像窗口通过 VoiceContext 同步
    logger.agent.info(
      `[SceneModeEffects] Voice profile updated to ${profile.voiceProfile.voiceId} (${profile.displayNameZh})`,
    )
  } catch (err) {
    logger.agent.warn('[SceneModeEffects] Failed to update voice profile:', err)
  }
})
```

#### 修改文件：`useVoiceChat.ts`

在 `useVoiceChat` 中引入场景音色解析，覆盖 TTS 调用参数：

```typescript
import { resolveSceneVoice } from '@intelligence/capabilities/sceneMode/sceneVoiceResolver'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'

// 在每次 voiceApi.textToSpeech 调用前解析音色
function getResolvedVoiceConfig(
  userVoiceConfig: VoiceChatOptions['userVoiceConfig'],
): { voice: string; speed: number } {
  const { activeProfile } = useSceneModeStore.getState()
  return resolveSceneVoice(
    activeProfile.voiceProfile,
    userVoiceConfig?.ttsProvider,
    userVoiceConfig?.ttsVoice,
    userVoiceConfig?.ttsSpeed,
  )
}
```

修改 3 处 `voiceApi.textToSpeech` 调用，将硬编码的 `options?.userVoiceConfig?.ttsVoice` 替换为 `getResolvedVoiceConfig()` 的返回值。

### 1.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 工作模式 TTS 语速更快 | 在工作模式发起语音对话，确认语速 ~1.1x |
| 生活模式 TTS 音色为女声 | 在生活模式发起语音对话，确认音色为 nova/longxiaochun |
| 学习模式 TTS 语速正常 | 在学习模式发起语音对话，确认语速 ~1.0x |
| 切换模式后立即生效 | 语音对话中切换模式，下一次 TTS 使用新音色 |
| 未配置 TTS 时不报错 | 用户未配置 TTS 时，回退到默认音色 |

---

## 二、D-步骤3：Cron 任务激活

### 2.1 设计目标

每种场景模式有独立的 Cron 任务集：
- **工作模式**：周五 16:00 周报提醒、每 5 分钟专注检查、每 15 分钟久坐检查
- **生活模式**：每小时喝水提醒、每 45 分钟起身提醒、23:00 睡眠提醒、7:00 早晨问候、9:00 生日检查
- **学习模式**：每天 9:00 复习检查、周日 20:00 学习周报

切换模式时：暂停旧模式专属 Cron → 激活新模式专属 Cron。

### 2.2 技术方案

#### 集成点

现有 `CronScheduler`（主进程 `src/main/modules/automation/CronScheduler.ts`）提供：
- `register(config: CronTaskConfig): CronTask` — 注册任务
- `unregister(taskId: string): boolean` — 删除任务
- `pause(taskId: string)` / `resume(taskId: string)` — 暂停/恢复

场景模式 Cron 任务通过 IPC 从渲染进程注册到主进程。

#### 任务 ID 规范

```
scene:{mode}:{jobId}
```
例如：`scene:work:weekly-report`、`scene:life:water`

#### 实现步骤

**步骤 3.1：新建 `sceneCronManager.ts`**

位置：`src/renderer/intelligence/capabilities/sceneMode/sceneCronManager.ts`

职责：
- 模式切换时，暂停旧模式的 Cron 任务
- 激活新模式的 Cron 任务
- 通过 IPC 调用主进程 CronScheduler

```typescript
import type { SceneMode, SceneModeProfile, SceneCronJob } from './types'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

/** 场景模式 Cron 任务 ID 前缀 */
const SCENE_CRON_PREFIX = 'scene'

/** 构建 scene cron 任务 ID */
function buildSceneCronId(mode: SceneMode, jobId: string): string {
  return `${SCENE_CRON_PREFIX}:${mode}:${jobId}`
}

/**
 * 场景 Cron 管理器
 *
 * 通过 addSceneModeListener 注册，模式切换时自动：
 * 1. 暂停旧模式的所有 Cron 任务
 * 2. 激活新模式的所有 Cron 任务
 */
export class SceneCronManager {
  private currentMode: SceneMode | null = null

  /** 激活指定模式的所有 Cron 任务 */
  async activateModeCronJobs(profile: SceneModeProfile): Promise<void> {
    const { cronJobs, id: mode } = profile

    for (const job of cronJobs) {
      if (!job.enabled) continue

      const taskId = buildSceneCronId(mode, job.id)
      try {
        // 通过 IPC 注册（如果已存在则更新）
        await api.automation.registerCronTask({
          id: taskId,
          name: `[${profile.displayNameZh}] ${job.name}`,
          expression: job.schedule,
          command: this.buildCommand(job.action, profile),
          active: true,
        })
        logger.system.info(`[SceneCron] Registered ${taskId}: ${job.schedule}`)
      } catch (err) {
        logger.system.warn(`[SceneCron] Failed to register ${taskId}:`, err)
      }
    }
  }

  /** 暂停指定模式的所有 Cron 任务 */
  async pauseModeCronJobs(mode: SceneMode): Promise<void> {
    // 遍历暂停所有以 scene:{mode}: 开头的任务
    // 通过 IPC 调用主进程
    try {
      await api.automation.pauseCronTasksByPrefix(`${SCENE_CRON_PREFIX}:${mode}:`)
      logger.system.info(`[SceneCron] Paused all cron jobs for mode: ${mode}`)
    } catch (err) {
      logger.system.warn(`[SceneCron] Failed to pause jobs for ${mode}:`, err)
    }
  }

  /** 构建 Cron 触发的 Agent 指令 */
  private buildCommand(action: string, profile: SceneModeProfile): string {
    return `[场景模式:${profile.displayNameZh}] ${action}`
  }

  /** 模式切换处理器 */
  handleSceneModeChange = async (
    newMode: SceneMode,
    newProfile: SceneModeProfile,
  ): Promise<void> => {
    // 1. 暂停旧模式 Cron
    if (this.currentMode && this.currentMode !== newMode) {
      await this.pauseModeCronJobs(this.currentMode)
    }

    // 2. 激活新模式 Cron
    await this.activateModeCronJobs(newProfile)

    this.currentMode = newMode
  }
}

export const sceneCronManager = new SceneCronManager()
```

**步骤 3.2：在 `useSceneModeEffects` 中注册**

```typescript
import { sceneCronManager } from '@intelligence/capabilities/sceneMode/sceneCronManager'

// 在 useSceneModeEffects 内部：
const unsubscribeCron = addSceneModeListener(async (mode, profile) => {
  try {
    await sceneCronManager.handleSceneModeChange(mode, profile)
  } catch (err) {
    logger.agent.warn('[SceneModeEffects] Cron switch failed:', err)
  }
})

// 应用启动时激活当前模式的 Cron
const { currentSceneMode, activeProfile } = useSceneModeStore.getState()
sceneCronManager.handleSceneModeChange(currentSceneMode, activeProfile)
```

**步骤 3.3：扩展 IPC 接口**

在主进程 automation IPC 中新增：
- `automation:registerCronTask` — 注册/更新任务（支持指定 ID）
- `automation:pauseCronTasksByPrefix` — 按前缀批量暂停任务

### 2.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 工作模式激活周报 Cron | 切换到工作模式，查看 Cron 任务列表包含 `scene:work:weekly-report` |
| 切换到生活模式暂停工作 Cron | 切换后查看工作模式 Cron 状态为 paused |
| Cron 触发后执行 Agent 指令 | 等待 Cron 到时（或手动触发），确认 Agent 执行对应指令 |
| 重启后恢复正确模式 Cron | 重启应用后，当前模式的 Cron 任务为 active |

---

## 三、D-步骤4：主动行为策略切换

### 3.1 设计目标

不同模式有不同的主动行为规则：
- **工作模式**：会议准备提醒、任务跟进、专注守护、久坐提醒、周报提醒
- **生活模式**：喝水提醒、起身提醒、情绪关怀、睡眠提醒、生日检查
- **学习模式**：复习提醒、学习提醒、休息提醒、费曼引导、学习周报

### 3.2 技术方案

#### 集成点

现有 `ProactiveDecisionEngine`（主进程）10 秒节拍循环采集信号并生成提案。场景模式通过 `proactiveRules` 配置控制：
- 哪些规则启用
- 规则的触发条件
- 规则的执行动作

#### 实现方案

**方案：渲染进程规则注入 + IPC 同步**

由于 `ProactiveDecisionEngine` 在主进程运行，场景模式切换需要通过 IPC 将新规则同步到主进程。

**步骤 4.1：新建 `sceneProactiveManager.ts`**

位置：`src/renderer/intelligence/capabilities/sceneMode/sceneProactiveManager.ts`

```typescript
import type { SceneMode, SceneModeProfile, ProactiveRule } from './types'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

/**
 * 场景主动行为管理器
 *
 * 模式切换时，将新模式的 proactiveRules 通过 IPC 同步到主进程
 * ProactiveDecisionEngine，替换当前生效的规则集。
 */
export class SceneProactiveManager {
  /** 同步主动行为规则到主进程 */
  async syncProactiveRules(profile: SceneModeProfile): Promise<void> {
    const enabledRules = profile.proactiveRules.filter(r => r.enabled)

    try {
      await api.proactive.setSceneRules({
        mode: profile.id,
        rules: enabledRules.map(rule => ({
          id: `scene:${profile.id}:${rule.id}`,
          name: rule.name,
          condition: rule.condition,
          action: rule.action,
          payload: rule.payload,
        })),
      })
      logger.system.info(
        `[SceneProactive] Synced ${enabledRules.length} rules for ${profile.displayNameZh}`,
      )
    } catch (err) {
      logger.system.warn('[SceneProactive] Failed to sync rules:', err)
    }
  }
}

export const sceneProactiveManager = new SceneProactiveManager()
```

**步骤 4.2：扩展主进程 IPC**

在 `src/main/modules/proactive/ProactiveIpc.ts` 中新增：
- `proactive:set-scene-rules` — 接收场景模式规则集，替换当前规则

**步骤 4.3：修改 `ProactiveDecisionEngine`**

在 `ProactiveDecisionEngine` 中新增：
- `setSceneRules(rules: SceneProactiveRule[])` — 设置当前场景的规则集
- 规则引擎评估时，优先检查场景规则

**步骤 4.4：在 `useSceneModeEffects` 中注册**

```typescript
import { sceneProactiveManager } from '@intelligence/capabilities/sceneMode/sceneProactiveManager'

const unsubscribeProactive = addSceneModeListener(async (_mode, profile) => {
  try {
    await sceneProactiveManager.syncProactiveRules(profile)
  } catch (err) {
    logger.agent.warn('[SceneModeEffects] Proactive rules sync failed:', err)
  }
})

// 启动时同步当前模式规则
const { activeProfile } = useSceneModeStore.getState()
sceneProactiveManager.syncProactiveRules(activeProfile)
```

### 3.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 工作模式触发专注守护 | 工作模式下频繁切换窗口，确认 AI 提醒专注 |
| 生活模式触发喝水提醒 | 生活模式下等待 1 小时（或手动触发），确认喝水提醒 |
| 切换模式后规则更新 | 切换模式后，旧模式规则不再触发 |
| 学习模式触发复习提醒 | 学习模式下模拟遗忘曲线到期，确认复习提醒 |

---

## 四、D-步骤5：感知策略切换

### 4.1 设计目标

不同模式启用不同的感知信号：

| 感知信号 | 工作 | 生活 | 学习 |
|---|---|---|---|
| 桌面窗口切换 | ✅ | ❌ | ❌ |
| 活动应用追踪 | ✅ | ❌ | ✅ |
| 日历事件 | ✅ | ❌ | ❌ |
| 工作区文件改动 | ✅ | ❌ | ✅ |
| 屏幕久坐时长 | ✅ | ✅ | ✅ |
| 天气 | ❌ | ✅ | ❌ |
| IoT 健康设备 | ❌ | ✅ | ❌ |
| 情绪分析 | ❌ | ✅ | ❌ |
| IoT 环境传感器 | ❌ | ✅ | ❌ |
| 学习时长 | ❌ | ❌ | ✅ |
| 遗忘曲线 | ❌ | ❌ | ✅ |

### 4.2 技术方案

#### 集成点

现有感知基础设施：
- `PerceptionFusionService`（主进程）— 4 通道融合（scene/iot/causal/monitoring）
- `PerceptionStore`（主进程）— 屏幕场景存储
- `BehaviorPredictor`（主进程）— 行为预测
- `MonitoringService`（主进程）— 系统监控

`PerceptionFusionService.getEnvironmentContext()` 是 `ProactiveDecisionEngine` 和 `IntelligenceCore` 的感知数据来源。

#### 实现方案

**方案：渲染进程过滤配置 + IPC 同步到主进程**

**步骤 5.1：新建 `scenePerceptionManager.ts`**

位置：`src/renderer/intelligence/capabilities/sceneMode/scenePerceptionManager.ts`

```typescript
import type { SceneModeProfile, PerceptionFilter } from './SceneModeDescriptor'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

/**
 * 场景感知策略管理器
 *
 * 模式切换时，将新模式的 perceptionFilter 通过 IPC 同步到主进程
 * PerceptionFusionService，控制各感知通道的启停。
 */
export class ScenePerceptionManager {
  /** 同步感知过滤器到主进程 */
  async syncPerceptionFilter(profile: SceneModeProfile): Promise<void> {
    try {
      await api.perception.setSceneFilter({
        mode: profile.id,
        filter: profile.perceptionFilter,
      })
      logger.system.info(
        `[ScenePerception] Synced filter for ${profile.displayNameZh}`,
        profile.perceptionFilter,
      )
    } catch (err) {
      logger.system.warn('[ScenePerception] Failed to sync filter:', err)
    }
  }
}

export const scenePerceptionManager = new ScenePerceptionManager()
```

**步骤 5.2：扩展主进程 IPC**

在 `src/main/modules/perception/PerceptionIpc.ts` 中新增：
- `perception:set-scene-filter` — 接收场景感知过滤器

**步骤 5.3：修改 `PerceptionFusionService`**

在 `PerceptionFusionService` 中新增：
- `setSceneFilter(filter: PerceptionFilter)` — 设置当前场景的感知过滤器
- `getEnvironmentContext()` 中按过滤器跳过被禁用的通道

```typescript
class PerceptionFusionService {
  private sceneFilter: PerceptionFilter | null = null

  setSceneFilter(filter: PerceptionFilter | null): void {
    this.sceneFilter = filter
    logger.system.info('[PerceptionFusion] Scene filter updated:', filter)
  }

  /** 检查感知信号是否被当前场景模式启用 */
  isSignalEnabled(signal: keyof PerceptionFilter): boolean {
    if (!this.sceneFilter) return true // 无过滤时全部启用
    return this.sceneFilter[signal] !== false
  }

  async getEnvironmentContext(): Promise<EnvironmentContext> {
    // 按过滤器决定是否采集各通道数据
    const channels: ChannelSummary[] = []

    // 场景通道（桌面活动）
    if (this.isSignalEnabled('desktopWindowSwitching') ||
        this.isSignalEnabled('activeAppTracking')) {
      channels.push(await this.collectSceneChannel())
    }

    // IoT 通道
    if (this.isSignalEnabled('iotHealth') ||
        this.isSignalEnabled('iotEnvironment')) {
      channels.push(await this.collectIotChannel())
    }

    // 监控通道（始终采集，仅影响是否用于主动行为）
    channels.push(await this.collectMonitoringChannel())

    // ... 融合逻辑
  }
}
```

**步骤 5.4：在 `useSceneModeEffects` 中注册**

```typescript
import { scenePerceptionManager } from '@intelligence/capabilities/sceneMode/scenePerceptionManager'

const unsubscribePerception = addSceneModeListener(async (_mode, profile) => {
  try {
    await scenePerceptionManager.syncPerceptionFilter(profile)
  } catch (err) {
    logger.agent.warn('[SceneModeEffects] Perception filter sync failed:', err)
  }
})

// 启动时同步当前模式过滤器
const { activeProfile } = useSceneModeStore.getState()
scenePerceptionManager.syncPerceptionFilter(activeProfile)
```

### 4.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 工作模式监听桌面活动 | 工作模式下切换窗口，感知系统记录窗口切换 |
| 生活模式不监听桌面活动 | 生活模式下切换窗口，感知系统不记录 |
| 生活模式监听天气 | 生活模式下天气数据被采集 |
| 工作模式不监听天气 | 工作模式下天气通道返回 inactive |
| 切换模式后感知策略更新 | 切换模式后，感知通道启停状态变化 |

---

## 五、整合到 `useSceneModeEffects`

最终 `useSceneModeEffects.ts` 将统一注册所有场景模式副作用：

```typescript
export function useSceneModeEffects(): void {
  useEffect(() => {
    // 1. 悬浮头像主题色切换
    const unsubscribeAvatar = addSceneModeListener(async (_mode, profile) => {
      // ... 更新头像主题色
    })

    // 2. 语音音色切换（通过 useSceneModeStore.getState 在 TTS 调用时读取）
    //    无需额外监听器，useVoiceChat 直接读取 store

    // 3. Cron 任务切换
    const unsubscribeCron = addSceneModeListener(async (mode, profile) => {
      await sceneCronManager.handleSceneModeChange(mode, profile)
    })

    // 4. 主动行为规则切换
    const unsubscribeProactive = addSceneModeListener(async (_mode, profile) => {
      await sceneProactiveManager.syncProactiveRules(profile)
    })

    // 5. 感知策略切换
    const unsubscribePerception = addSceneModeListener(async (_mode, profile) => {
      await scenePerceptionManager.syncPerceptionFilter(profile)
    })

    // 启动时初始化当前模式的副作用
    const { currentSceneMode, activeProfile } = useSceneModeStore.getState()
    sceneCronManager.handleSceneModeChange(currentSceneMode, activeProfile)
    sceneProactiveManager.syncProactiveRules(activeProfile)
    scenePerceptionManager.syncPerceptionFilter(activeProfile)

    return () => {
      unsubscribeAvatar()
      unsubscribeCron()
      unsubscribeProactive()
      unsubscribePerception()
    }
  }, [])
}
```

---

## 六、文件清单

### 新建文件

| 文件路径 | 职责 |
|---|---|
| `src/renderer/intelligence/capabilities/sceneMode/sceneVoiceResolver.ts` | 抽象音色 → Provider 音色映射 |
| `src/renderer/intelligence/capabilities/sceneMode/sceneCronManager.ts` | 场景 Cron 任务管理 |
| `src/renderer/intelligence/capabilities/sceneMode/sceneProactiveManager.ts` | 场景主动行为规则管理 |
| `src/renderer/intelligence/capabilities/sceneMode/scenePerceptionManager.ts` | 场景感知策略管理 |

### 修改文件

| 文件路径 | 修改内容 |
|---|---|
| `src/renderer/composables/useSceneModeEffects.ts` | 注册 Cron/Proactive/Perception 监听器 |
| `src/renderer/composables/useVoiceChat.ts` | TTS 调用使用场景音色解析 |
| `src/main/modules/automation/CronScheduler.ts` | 支持 register with ID + pauseByPrefix |
| `src/main/modules/proactive/ProactiveIpc.ts` | 新增 set-scene-rules IPC |
| `src/main/modules/proactive/ProactiveDecisionEngine.ts` | 支持场景规则集 |
| `src/main/modules/perception/PerceptionIpc.ts` | 新增 set-scene-filter IPC |
| `src/main/modules/perception/PerceptionFusionService.ts` | 支持感知过滤器 |
| `src/main/preload/api/automation.ts` | 暴露新 IPC 接口 |
| `src/main/preload/api/perception.ts` | 暴露新 IPC 接口 |

---

## 七、实施顺序

1. **D-步骤2**：语音音色切换（纯渲染进程，无需 IPC 扩展）
2. **D-步骤3**：Cron 任务激活（需要扩展 automation IPC）
3. **D-步骤4**：主动行为策略切换（需要扩展 proactive IPC）
4. **D-步骤5**：感知策略切换（需要扩展 perception IPC）
5. **整合**：统一在 `useSceneModeEffects` 注册所有监听器
6. **联调验证**：按 03-implementation.md 三、端到端测试用例验证
