import { useWorkPlanStore, todayStr, uid } from '../../stores'
import type { SceneToolDS, TrackKeyFn } from '../../factory'

function resolveTask(e: any): string {
  return String(e.task ?? e.description ?? e.content ?? e.text ?? e.name ?? '').trim()
}

/** 工作计划 — 有自定义 add/update 逻辑，不走通用工厂 */
export const DS: SceneToolDS = {
  id: 'work-plan',
  name: '工作计划',
  mode: 'work',
  description: '周/月/日工作计划管理，支持到期提醒、优先级、完成追踪',
  itemSchema: 'add: { planType:"week"|"month"|"day"(必填), title:string(必填), baseDate:"YYYY-MM-DD"(必填,计划基准日期。计算方法:用户说"本周"→本周一日期;说"下周"→下周一日期;说"本月"→本月1日;说"下月"→下月1日。当前日期从系统提示中获取), entries:[{date:"YYYY-MM-DD"(必填,该任务执行日期),task:string(必填,具体任务描述,不能为空),priority:"high"|"medium"|"low"(默认medium)}] }(entries至少1条) 完整示例: {planType:"week",title:"下周开发计划",baseDate:"2026-08-31",entries:[{date:"2026-08-31",task:"完成登录模块",priority:"high"},{date:"2026-09-01",task:"代码Review",priority:"medium"}]}; update: { id, patch:{title/entries} } entries更新时每条必须有date和task',
  read: () => useWorkPlanStore.getState().items,
  add: (item) => {
    try {
      const planType = item.planType as 'week' | 'month' | 'day' || 'week'
      const baseDate = (item.baseDate as string) || todayStr()
      const rawEntries = Array.isArray(item.entries) ? item.entries : []
      const entries = rawEntries.map((e: any) => ({
        id: e.id || uid('pe'),
        date: e.date || baseDate,
        task: resolveTask(e),
        priority: (e.priority as 'high' | 'medium' | 'low') || 'medium',
        done: Boolean(e.done),
        estimatedMin: e.estimatedMin ? Number(e.estimatedMin) : undefined,
      })).filter((e) => e.task)
      if (rawEntries.length === 0) {
        return { ok: false, error: '必须提供 entries 数组，每条至少含 date(YYYY-MM-DD) 和 task(任务描述)。正确示例：{planType:"week",title:"下周计划",baseDate:"2026-09-01",entries:[{date:"2026-09-01",task:"完成登录模块",priority:"high"}]}' }
      }
      if (entries.length === 0) {
        return { ok: false, error: 'entries 中所有任务的 task 均为空。每条 entry 必须有非空的 task 字段（也接受 description/content/text/name）。正确示例：entries:[{date:"2026-09-01",task:"完成登录模块",priority:"high"}]' }
      }
      useWorkPlanStore.getState().add({
        planType,
        title: String(item.title ?? '').trim() || (planType === 'week' ? '周计划' : planType === 'month' ? '月计划' : '日计划'),
        baseDate,
        entries,
        remindedDates: [],
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  update: (id, patch) => {
    try {
      const cleanPatch = { ...patch }
      if (Array.isArray(patch.entries)) {
        cleanPatch.entries = patch.entries.map((e: any) => ({
          id: e.id || uid('pe'),
          date: e.date || todayStr(),
          task: resolveTask(e),
          priority: (e.priority as 'high' | 'medium' | 'low') || 'medium',
          done: Boolean(e.done),
          estimatedMin: e.estimatedMin ? Number(e.estimatedMin) : undefined,
        })).filter((e: any) => e.task)
      }
      useWorkPlanStore.getState().update(id, cleanPatch)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  remove: (id) => {
    try {
      useWorkPlanStore.getState().remove(id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const trackKey: TrackKeyFn = (i) => (i as any)?.title ?? (i as any)?.id ?? ''
