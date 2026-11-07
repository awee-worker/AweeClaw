/**
 * 终局摘要的产物封装
 *
 * TaskSummary 要跨端到移动端，但两端之间只有「任务产物」这一条既有通道，
 * 没有为摘要单独开接口的必要。因此把摘要序列化成一条受约定标题约束的文本产物：
 * 后端按 artifacts 原样透传，移动端按标题认出它并渲染成三段式，其余产物照旧展示。
 *
 * 标题用双下划线包住是刻意的：正常文件名不会长成这样，不会误判。
 *
 * @module intelligence/decision/taskSummaryArtifact
 */
import type { TaskSummary } from './taskOutcome'

/** 摘要产物的固定标题：两端必须一致 */
export const TASK_SUMMARY_ARTIFACT_TITLE = '__task_summary__'

/** 摘要产物 */
export interface TaskSummaryArtifact {
  type: 'text'
  title: string
  content: string
}

/**
 * 把摘要封成产物
 *
 * 序列化失败不抛：摘要只是锦上添花，不能因为它把任务完成的上报一起带崩。
 */
export function toTaskSummaryArtifact(summary: TaskSummary): TaskSummaryArtifact | null {
  try {
    return {
      type: 'text',
      title: TASK_SUMMARY_ARTIFACT_TITLE,
      content: JSON.stringify(summary),
    }
  } catch {
    return null
  }
}
