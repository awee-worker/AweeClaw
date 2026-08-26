/**
 * 场景模式内置工具注册表
 *
 * 每个工具：元数据（名称/图标/模式/级别）+ 懒加载组件。
 * SceneToolsPanel 按当前场景模式过滤展示。
 */

import { lazy } from 'react'
import type { SceneMode } from '@protocols/sceneModeProtocol'

export interface SceneToolMeta {
  id: string
  name: string
  nameEn: string
  /** lucide icon name */
  icon: string
  mode: SceneMode
  description: string
  /** core=P0 核心，enhanced=P1 增强 */
  tier: 'core' | 'enhanced'
  component: React.LazyExoticComponent<React.ComponentType>
}

// ============================================
// 工作模式
// ============================================

const WorkTodo = lazy(() => import('./work/WorkTodo'))
const WorkPomodoro = lazy(() => import('./work/WorkPomodoro'))
const WorkMeeting = lazy(() => import('./work/WorkMeeting'))
const WorkWeeklyReport = lazy(() => import('./work/WorkWeeklyReport'))
const WorkFileOrganizer = lazy(() => import('./work/WorkFileOrganizer'))
const WorkHours = lazy(() => import('./work/WorkHours'))
const WorkSnippets = lazy(() => import('./work/WorkSnippets'))

// ============================================
// 生活模式
// ============================================

const LifeLedger = lazy(() => import('./life/LifeLedger'))
const LifeWater = lazy(() => import('./life/LifeWater'))
const LifeMoodDiary = lazy(() => import('./life/LifeMoodDiary'))
const LifeWeather = lazy(() => import('./life/LifeWeather'))
const LifeShopping = lazy(() => import('./life/LifeShopping'))
const LifeAnniversary = lazy(() => import('./life/LifeAnniversary'))
const LifeRecipe = lazy(() => import('./life/LifeRecipe'))

// ============================================
// 学习模式
// ============================================

const StudyFlashcards = lazy(() => import('./study/StudyFlashcards'))
const StudyPomodoro = lazy(() => import('./study/StudyPomodoro'))
const StudyMistakeBook = lazy(() => import('./study/StudyMistakeBook'))
const StudyDashboard = lazy(() => import('./study/StudyDashboard'))
const StudyNotes = lazy(() => import('./study/StudyNotes'))
const StudyReader = lazy(() => import('./study/StudyReader'))
const StudyPlanner = lazy(() => import('./study/StudyPlanner'))

// ============================================
// 注册表
// ============================================

export const SCENE_TOOLS: SceneToolMeta[] = [
  // ---- 工作 ----
  { id: 'work-todo', name: '待办清单', nameEn: 'Todo List', icon: 'ListTodo', mode: 'work', description: '任务管理：优先级、截止日期、完成追踪', tier: 'core', component: WorkTodo },
  { id: 'work-pomodoro', name: '番茄专注钟', nameEn: 'Pomodoro', icon: 'Timer', mode: 'work', description: '25 分钟专注循环，专注数据自动沉淀', tier: 'core', component: WorkPomodoro },
  { id: 'work-meeting', name: '会议助手', nameEn: 'Meeting Assistant', icon: 'Users', mode: 'work', description: '会前准备卡片 + 纪要要点 + 行动项', tier: 'core', component: WorkMeeting },
  { id: 'work-weekly', name: '周报生成器', nameEn: 'Weekly Report', icon: 'FileText', mode: 'work', description: '由待办完成与专注数据自动汇总周报', tier: 'enhanced', component: WorkWeeklyReport },
  { id: 'work-files', name: '文件整理助手', nameEn: 'File Organizer', icon: 'FolderTree', mode: 'work', description: '按规则自动归类工作区文件', tier: 'enhanced', component: WorkFileOrganizer },
  { id: 'work-hours', name: '工时记录', nameEn: 'Work Hours', icon: 'Clock', mode: 'work', description: '上下班打卡、加班统计', tier: 'enhanced', component: WorkHours },
  { id: 'work-snippets', name: '快捷话术库', nameEn: 'Snippets', icon: 'MessageSquareQuote', mode: 'work', description: '常用邮件模板与回复话术一键复制', tier: 'enhanced', component: WorkSnippets },

  // ---- 生活 ----
  { id: 'life-ledger', name: '记账本', nameEn: 'Ledger', icon: 'Wallet', mode: 'life', description: '收支记录、分类统计、月度小结', tier: 'core', component: LifeLedger },
  { id: 'life-water', name: '喝水打卡', nameEn: 'Water Tracker', icon: 'Droplets', mode: 'life', description: '每日饮水目标与进度打卡', tier: 'core', component: LifeWater },
  { id: 'life-mood', name: '心情日记', nameEn: 'Mood Diary', icon: 'HeartHandshake', mode: 'life', description: '情绪打卡 + 一句话日记', tier: 'core', component: LifeMoodDiary },
  { id: 'life-weather', name: '天气卡片', nameEn: 'Weather', icon: 'CloudSun', mode: 'life', description: '当前天气与通勤建议', tier: 'enhanced', component: LifeWeather },
  { id: 'life-shopping', name: '购物清单', nameEn: 'Shopping List', icon: 'ShoppingCart', mode: 'life', description: '可勾选的采购清单', tier: 'enhanced', component: LifeShopping },
  { id: 'life-anniversary', name: '纪念日提醒', nameEn: 'Anniversaries', icon: 'Cake', mode: 'life', description: '生日与纪念日倒计时', tier: 'enhanced', component: LifeAnniversary },
  { id: 'life-recipe', name: '菜谱推荐', nameEn: 'Recipes', icon: 'ChefHat', mode: 'life', description: '家常菜谱收藏与做法', tier: 'enhanced', component: LifeRecipe },

  // ---- 学习 ----
  { id: 'study-flashcards', name: '闪卡复习', nameEn: 'Flashcards', icon: 'Layers', mode: 'study', description: '间隔重复记忆，贴合遗忘曲线', tier: 'core', component: StudyFlashcards },
  { id: 'study-pomodoro', name: '学习番茄钟', nameEn: 'Study Timer', icon: 'AlarmClock', mode: 'study', description: '分科目专注计时，进入学习时长统计', tier: 'core', component: StudyPomodoro },
  { id: 'study-mistakes', name: '错题本', nameEn: 'Mistake Book', icon: 'BookX', mode: 'study', description: '错题记录与定期重做', tier: 'core', component: StudyMistakeBook },
  { id: 'study-dashboard', name: '学习仪表盘', nameEn: 'Study Dashboard', icon: 'BarChart3', mode: 'study', description: '时长、科目分布与连续打卡可视化', tier: 'enhanced', component: StudyDashboard },
  { id: 'study-notes', name: '笔记库', nameEn: 'Notes', icon: 'NotebookPen', mode: 'study', description: 'Markdown 笔记与标签检索', tier: 'enhanced', component: StudyNotes },
  { id: 'study-reader', name: '阅读助手', nameEn: 'Reader', icon: 'BookOpen', mode: 'study', description: '阅读清单、摘要与进度管理', tier: 'enhanced', component: StudyReader },
  { id: 'study-planner', name: '学习计划表', nameEn: 'Study Planner', icon: 'CalendarRange', mode: 'study', description: '周计划排布与完成统计', tier: 'enhanced', component: StudyPlanner },
]

export function getToolsByMode(mode: SceneMode): SceneToolMeta[] {
  return SCENE_TOOLS.filter((t) => t.mode === mode)
}

export function getToolById(id: string): SceneToolMeta | undefined {
  return SCENE_TOOLS.find((t) => t.id === id)
}
