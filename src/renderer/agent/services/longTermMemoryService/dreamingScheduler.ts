import { longTermMemoryService } from './index'
import { logger } from '@utils/Logger'
import { useStore } from '@store'

interface DreamingSchedule {
  phase: 'light' | 'rem' | 'deep'
  intervalMs: number
  lastRunAt: number
}

const SCHEDULES: DreamingSchedule[] = [
  { phase: 'light', intervalMs: 6 * 60 * 60 * 1000, lastRunAt: 0 },
  { phase: 'deep', intervalMs: 24 * 60 * 60 * 1000, lastRunAt: 0 },
  { phase: 'rem', intervalMs: 7 * 24 * 60 * 60 * 1000, lastRunAt: 0 },
]

class DreamingScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  start(): void {
    if (this.timer) return

    this.timer = setInterval(() => {
      this.tick()
    }, 5 * 60 * 1000)

    logger.agent.info('[DreamingScheduler] Started')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    logger.agent.info('[DreamingScheduler] Stopped')
  }

  private async tick(): Promise<void> {
    if (this.running) return

    const { workspacePath } = useStore.getState()
    if (!workspacePath) return

    const now = Date.now()
    for (const schedule of SCHEDULES) {
      if (now - schedule.lastRunAt >= schedule.intervalMs) {
        await this.runPhase(schedule)
        break
      }
    }
  }

  private async runPhase(schedule: DreamingSchedule): Promise<void> {
    this.running = true
    try {
      const result = await longTermMemoryService.runDreamingPhase(schedule.phase)
      schedule.lastRunAt = Date.now()

      const summary = Object.entries(result)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      logger.agent.info(`[DreamingScheduler] ${schedule.phase} phase completed: ${summary}`)
    } catch (err) {
      logger.agent.error(`[DreamingScheduler] ${schedule.phase} phase failed:`, err)
    } finally {
      this.running = false
    }
  }

  async runManual(phase: 'light' | 'rem' | 'deep'): Promise<Record<string, number>> {
    return longTermMemoryService.runDreamingPhase(phase)
  }

  getStatus(): Array<{ phase: string; nextRunIn: string }> {
    const now = Date.now()
    return SCHEDULES.map(s => {
      const elapsed = now - s.lastRunAt
      const remaining = Math.max(0, s.intervalMs - elapsed)
      return {
        phase: s.phase,
        nextRunIn: this.formatDuration(remaining),
      }
    })
  }

  private formatDuration(ms: number): string {
    const hours = Math.floor(ms / (60 * 60 * 1000))
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
    if (hours > 0) return `${hours}h`
    const minutes = Math.floor(ms / (60 * 1000))
    return `${minutes}m`
  }
}

export const dreamingScheduler = new DreamingScheduler()
