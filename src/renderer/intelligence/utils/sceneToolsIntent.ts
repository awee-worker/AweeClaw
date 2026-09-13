/**
 * 场景工具意图识别
 *
 * 用于决定 scene_tools_* 工具是否对 LLM 可见。
 *
 * 背景（致命问题 #4）：此前 getToolsForContext() 会把 scene_tools_* 无条件
 * 拼入工具列表，导致 AI 在执行开发/多步任务时也会“顺手”调用场景工具
 * （如自动在场景工具面板创建 work-todo 任务清单）。
 *
 * 修复策略：
 * - 默认不暴露 scene_tools_*（AI 自身任务跟踪使用系统内置 todo_write /
 *   create_task_plan / schedule 等工具）；
 * - 仅当用户最新一条消息带有明确的“场景数据记录 / 查询 / 管理”意图时，
 *   才暴露 scene_tools_*，让 AI 能把记录落进用户本地个人数据。
 */

/** 触发动作词（记录 / 查询 / 管理类动作） */
const SCENE_ACTION_WORDS: string[] = [
  '记录', '记一笔', '记一下', '帮我记', '帮我存', '帮我写', '存一下', '保存',
  '添加', '新增', '建一个', '建个', '创建', '补记', '安排一下', '写入',
  '查一下', '查查', '查看', '查询', '看看', '回顾', '汇总', '统计', '整理',
  '打卡', '记账', '勾选', '标记', '记录一下', '设置', '提醒我',
  // 英文动作
  'add to', 'log', 'record', 'track', 'save', 'create a', 'check my',
]

/** 场景领域词（work / life / study） */
const SCENE_DOMAIN_WORDS: string[] = [
  // work
  '待办', '会议', '纪要', '周报', '工时', '加班', '上下班', '话术', '工作计划',
  '周计划', '月计划', '日计划', '下周', '本周任务',
  // life
  '账', '收入', '支出', '花费', '花了', '喝了', '喝水', '购物', '要买', '纪念日',
  '生日', '菜谱', '做饭', '心情', '药', '买东西',
  // study
  '闪卡', '单词', '背书', '错题', '复习', '学习计划', '读书', '书单', '阅读', '笔记',
  // 通用场景数据词
  '清单', '番茄', '专注',
]

/** 直接触发短语：动作 + 领域词连写，无需两段同时出现 */
const SCENE_DIRECT_PHRASES: string[] = [
  '记个账', '记一笔账', '记待办', '记个待办', '添加待办', '新增待办', '建个待办',
  '记录待办', '写周报', '写会议纪要', '做会议纪要', '开个会', '记录会议',
  '上下班打卡', '打个卡', '记工时', '记加班',
  '记喝水', '喝了几杯', '买了什么', '记购物', '购物清单',
  '记单词', '背单词', '背闪卡', '记错题', '复习计划', '学习计划',
  '记纪念日', '纪念日提醒', '生日提醒',
]

/** 明确的排除词：开发/执行类请求不应触发场景工具 */
const SCENE_EXCLUDE_PHRASES: string[] = [
  '执行任务', '继续执行', '继续开发', '开发任务', '重构', '修复 bug', '写代码',
  '代码', '项目', 'git', '部署', '调试', '接口', '组件', '文件',
]

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word))
}

function containsSceneIntent(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()

  // 明确的排除词优先（开发任务类请求一律不视为场景工具意图）
  if (containsAny(lower, SCENE_EXCLUDE_PHRASES)) return false

  // 直接触发短语
  if (containsAny(lower, SCENE_DIRECT_PHRASES)) return true

  // 动作词 + 领域词双命中
  return containsAny(lower, SCENE_ACTION_WORDS) && containsAny(lower, SCENE_DOMAIN_WORDS)
}

/**
 * 判断一条用户消息是否为“场景工具”意图
 *
 * @param text 用户最新消息文本（可为空）
 * @param fallbackHistory 可选的此前消息（多轮场景工具对话中，即使当前消息
 *  只有“好的/继续/再看下XX”，若上一轮已在使用场景工具，也应保持可用）
 */
export function isSceneToolsIntent(text?: string | null, fallbackHistory?: string[]): boolean {
  if (text && containsSceneIntent(text)) return true
  if (!text && fallbackHistory && fallbackHistory.length > 0) {
    // 纯“继续/好的”类短消息：沿用最近一条含场景意图的消息判定
    const lastMeaningful = fallbackHistory.filter((m) => m && m.trim().length > 1).pop()
    return containsSceneIntent(lastMeaningful || '')
  }
  return false
}

/**
 * 从 LLM 消息数组中提取“最后一条用户文本”并做场景工具意图判定
 * 供工具加载上下文（getToolsForContext）使用
 */
export function isSceneToolsIntentFromMessages(messages?: Array<{ role?: string; content?: unknown }>): boolean {
  if (!messages || messages.length === 0) return false

  const userTexts: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'user') continue
    const content = msg.content
    if (typeof content === 'string') {
      userTexts.unshift(content)
    } else if (Array.isArray(content)) {
      const text = content
        .filter((p): p is { type: string; text?: string } => !!p && typeof p === 'object' && (p as { type?: string }).type === 'text')
        .map((p) => p.text || '')
        .join('')
      if (text) userTexts.unshift(text)
    }
  }

  // 只看最后一条用户消息；若是短衔接语（继续/好的等），
  // 顺带向前回溯最多两条以保持场景工具对话连贯
  const latest = userTexts[userTexts.length - 1] || ''
  if (latest.trim().length > 1) {
    return containsSceneIntent(latest)
  }
  const history = userTexts.slice(-3)
  return isSceneToolsIntent(latest, history)
}
