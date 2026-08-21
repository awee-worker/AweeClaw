# 场景模式扩展实施文档（方向 1-4）

> 在 D 阶段三模式核心能力完成后的扩展实施，覆盖体验、智能化、设置页、跨端协同四个方向。

## 一、方向1：体验层（Toast + 快捷键 + 动画）

### 1.1 设计目标

让模式切换有即时反馈和流畅过渡：
- **Toast 反馈**：切换后显示"已切换到工作模式"
- **快捷键**：Cmd/Ctrl+Shift+1/2/3 切换工作/生活/学习
- **头像动画**：主题色切换时渐变过渡（CSS transition）

### 1.2 技术方案

#### Toast 反馈

**集成点**：`sceneModeStore.ts` 的 `setSceneMode` 方法

在 `notifySceneModeChange` 后调用全局 `toast.success()`：
```typescript
// sceneModeStore.ts
import { toast } from '@components/foundation/InlineNotification'

setSceneMode: async (mode) => {
  // ... 现有切换逻辑
  await notifySceneModeChange(mode, profile)
  // Toast 反馈
  toast.success(`已切换到${profile.displayNameZh}模式`)
}
```

#### 快捷键

**集成点**：`useGlobalShortcuts.ts` 的 `HANDLERS` 数组

新增一个 KeyHandler，匹配 Cmd/Ctrl+Shift+1/2/3：
```typescript
// HANDLERS 数组新增
(e, _ctx) => {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return false
  const modeMap: Record<string, SceneMode> = {
    '1': 'work', '2': 'life', '3': 'study'
  }
  const mode = modeMap[e.key]
  if (!mode) return false
  e.preventDefault()
  useSceneModeStore.getState().setSceneMode(mode)
  return true
}
```

#### 头像动画

**集成点**：`useSceneModeEffects.ts` 的头像切换监听器

无需代码改动，`api.floatingAvatar.updateTheme` 已通过 IPC 触发头像窗口重新渲染。头像窗口的 CSS 已有 `transition` 属性，主题色会自动渐变。

如需更明显的过渡，可在 floating-avatar 的根元素加 `transition: background-color 0.4s ease`。

### 1.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 切换模式显示 Toast | 点击切换器，右上角显示"已切换到XX模式" |
| 快捷键切换 | 按 Cmd+Shift+2 切换到生活模式 |
| 头像颜色过渡 | 切换模式时头像颜色渐变，非突变 |

---

## 二、方向2：智能化（语音命令 + 时间自动切换 + 使用统计）

### 2.1 设计目标

- **语音命令**：用户说"切换到工作模式"自动切换
- **时间自动切换**：工作时间（9-18点工作日）自动切工作模式，晚间（19-22点）切生活模式
- **使用统计**：记录各模式使用时长，设置页可查看

### 2.2 技术方案

#### 语音命令

**集成点**：`useVoiceChat.ts` 的 STT 结果处理

在 STT 识别出文本后，先检查是否匹配场景切换命令：
```typescript
// 新建 sceneCommandRecognizer.ts
const SCENE_COMMANDS: Array<{ pattern: RegExp; mode: SceneMode }> = [
  { pattern: /切换到.*工作模式|进入工作模式|工作模式/, mode: 'work' },
  { pattern: /切换到.*生活模式|进入生活模式|生活模式/, mode: 'life' },
  { pattern: /切换到.*学习模式|进入学习模式|学习模式/, mode: 'study' },
]

export function recognizeSceneCommand(text: string): SceneMode | null {
  for (const cmd of SCENE_COMMANDS) {
    if (cmd.pattern.test(text)) return cmd.mode
  }
  return null
}
```

在 `useVoiceChat` 的 STT 文本处理分支中调用，匹配则切换模式并跳过 LLM 调用。

#### 时间自动切换

**新建**：`sceneModeAutoSwitcher.ts`

定时检查当前时间，符合规则则自动切换：
```typescript
class SceneModeAutoSwitcher {
  private intervalId: NodeJS.Timeout | null = null

  start(): void {
    // 每 5 分钟检查一次
    this.intervalId = setInterval(() => this.check(), 5 * 60 * 1000)
  }

  private async check(): Promise<void> {
    const now = new Date()
    const hour = now.getHours()
    const day = now.getDay() // 0=周日
    const isWeekday = day >= 1 && day <= 5

    let targetMode: SceneMode | null = null
    if (isWeekday && hour >= 9 && hour < 18) {
      targetMode = 'work'
    } else if (hour >= 19 && hour < 23) {
      targetMode = 'life'
    }

    if (targetMode) {
      const { currentSceneMode } = useSceneModeStore.getState()
      if (currentSceneMode !== targetMode) {
        await useSceneModeStore.getState().setSceneMode(targetMode)
      }
    }
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId)
  }
}
```

**开关**：在场景模式设置页提供开关，默认关闭（避免打扰用户）。

#### 使用统计

**集成点**：`sceneModeStore.ts`

新增 `modeUsageStats` 字段，记录各模式累计使用时长：
```typescript
interface ModeUsageStats {
  work: number    // 累计秒数
  life: number
  study: number
  lastSwitchAt: number  // 上次切换时间戳
}

// setSceneMode 中更新统计
setSceneMode: async (mode) => {
  const now = Date.now()
  const current = get().currentSceneMode
  const stats = get().modeUsageStats
  const lastSwitchAt = stats.lastSwitchAt

  // 累加上一模式的使用时长
  if (lastSwitchAt > 0) {
    const duration = Math.floor((now - lastSwitchAt) / 1000)
    stats[current] += duration
  }
  stats.lastSwitchAt = now

  // ... 切换逻辑
}
```

统计持久化到 electron-store，设置页展示。

### 2.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 语音命令切换 | 语音说"切换到学习模式"，模式切换 |
| 时间自动切换 | 工作日 9-18 点启动应用，自动进入工作模式 |
| 使用统计展示 | 设置页查看各模式累计时长 |

---

## 三、方向3：设置页（场景模式设置页 + 数据迁移）

### 3.1 设计目标

- **场景模式设置页**：查看各模式配置、开关自动切换、查看使用统计
- **数据迁移**：将知识库/记忆条目从一个模式域迁移到另一个（如 work→study）

### 3.2 技术方案

#### 场景模式设置页

**新建**：`src/renderer/components/settings/tabs/sceneMode/SceneModeSettingsPanel.tsx`

在 `PreferencesDialog.tsx` 的 `tabs` 数组新增：
```typescript
{ id: 'sceneMode', label: '场景模式', icon: <Layers className="w-4 h-4" /> }
```

设置页内容：
1. **当前模式**：显示当前激活模式和快速切换按钮
2. **三模式配置预览**：展开查看各模式的人设、技能、Cron、规则
3. **自动切换**：开关 + 时间规则配置
4. **使用统计**：三模式累计时长 + 占比进度条
5. **数据迁移**：选择源模式和目标模式，迁移知识库条目

#### 数据迁移

**集成点**：知识库服务

新增 `migrateDomain(sourceTag, targetTag)` 方法：
```typescript
// knowledgeService/index.ts
async migrateDomain(sourceTag: string, targetTag: string): Promise<number> {
  // 查询所有 sourceTag 的条目
  // 批量更新 tag 为 targetTag
  // 返回迁移数量
}
```

设置页调用：
```typescript
const count = await knowledgeService.migrateDomain('domain:work', 'domain:study')
toast.success(`已迁移 ${count} 条知识到学习模式`)
```

### 3.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| 设置页可见 | 设置页左侧出现"场景模式" tab |
| 查看模式配置 | 点击 tab 显示三模式配置 |
| 开关自动切换 | 开启自动切换，工作时间自动切换 |
| 查看使用统计 | 统计区域显示各模式时长 |
| 数据迁移 | 工作模式添加知识，迁移到学习模式后在学习模式可搜到 |

---

## 四、方向4：跨端协同（PC↔移动端模式同步）

### 4.1 设计目标

- **PC→移动端**：PC 切换模式，移动端同步显示
- **移动端→PC**：移动端切换模式，PC 同步

### 4.2 技术方案

#### 架构

```
PC 端切换模式
    ↓ sceneModeStore.setSceneMode()
    ↓ api.deviceLink.pushSceneMode(mode)  [新增 IPC]
    ↓ 后端中转
    ↓ 移动端 SSE/WebSocket 接收
    ↓ 移动端更新本地模式状态

移动端切换模式
    ↓ REST API 通知后端
    ↓ 后端 WebSocket 推送 PC 端
    ↓ PC 端 onSceneModeSync 监听  [新增 IPC]
    ↓ sceneModeStore.setSceneMode(mode, { silent: true })  [不触发反向同步]
```

#### PC 端实现

**新增 IPC**：`device-link:push-scene-mode`（PC→移动端推送）

在 `deviceLink.ts` preload 中新增：
```typescript
pushSceneMode: (mode: string) => Promise<{ success: boolean }>
onSceneModeSync: (callback: (mode: string) => void) => () => void
```

**集成点**：`sceneModeStore.ts` 的 `setSceneMode`

增加 `silent` 参数避免循环同步：
```typescript
setSceneMode: async (mode, options?: { silent?: boolean }) => {
  // ... 现有逻辑
  await notifySceneModeChange(mode, profile)
  // 推送到移动端（非 silent 调用才推送）
  if (!options?.silent) {
    try {
      await api.deviceLink.pushSceneMode(mode)
    } catch (err) {
      logger.agent.warn('[SceneModeStore] Failed to push to mobile:', err)
    }
  }
}
```

**监听移动端推送**：在 `useSceneModeEffects` 中新增：
```typescript
useEffect(() => {
  const unsubscribe = api.deviceLink.onSceneModeSync((mode) => {
    useSceneModeStore.getState().setSceneMode(mode as SceneMode, { silent: true })
  })
  return unsubscribe
}, [])
```

#### 移动端实现

**集成点**：`aweeclaw-app` 移动端

1. 在移动端新增模式状态管理（uni-app 的 store 或全局状态）
2. 监听后端 SSE 推送的 `sceneModeSync` 事件
3. 移动端 UI 提供模式切换器，切换时调用后端 REST API

**后端支持**：需要在 `aweeclaw-backend` 新增：
- `POST /api/v1/devices/scene-mode` — 移动端推送模式到 PC
- SSE 事件 `scene_mode_sync` — PC→移动端推送

### 4.3 验证标准

| 验收项 | 验证方法 |
|---|---|
| PC→移动端同步 | PC 切换模式，移动端 1 秒内同步 |
| 移动端→PC 同步 | 移动端切换模式，PC 同步 |
| 不触发循环 | 同步切换不会反向推送 |
| 离线降级 | 移动端离线时 PC 切换不报错 |

---

## 五、实施顺序

1. **方向1（体验层）**：Toast + 快捷键 + 动画（纯前端，最快）
2. **方向2（智能化）**：语音命令 + 时间自动切换 + 使用统计
3. **方向3（设置页）**：场景模式设置页 + 数据迁移
4. **方向4（跨端协同）**：PC↔移动端模式同步（涉及后端，最后）

## 六、文件清单

### 新建文件

| 文件路径 | 职责 |
|---|---|
| `src/renderer/intelligence/capabilities/sceneMode/sceneCommandRecognizer.ts` | 语音命令识别 |
| `src/renderer/intelligence/capabilities/sceneMode/sceneModeAutoSwitcher.ts` | 时间自动切换 |
| `src/renderer/components/settings/tabs/sceneMode/SceneModeSettingsPanel.tsx` | 设置页面板 |

### 修改文件

| 文件路径 | 修改内容 |
|---|---|
| `src/renderer/modes/sceneModeStore.ts` | Toast 反馈 + 使用统计 + silent 参数 |
| `src/renderer/composables/useGlobalShortcuts.ts` | 场景模式快捷键 |
| `src/renderer/composables/useVoiceChat.ts` | 语音命令识别 |
| `src/renderer/composables/useSceneModeEffects.ts` | 自动切换 + 移动端同步监听 |
| `src/renderer/components/settings/PreferencesDialog.tsx` | 新增场景模式 tab |
| `src/renderer/intelligence/runtime/knowledgeService/index.ts` | 域迁移方法 |
| `src/main/preload/api/deviceLink.ts` | 场景模式同步 IPC |
| `src/main/modules/device-link/DeviceLinkHandlers.ts` | 场景模式推送处理 |
