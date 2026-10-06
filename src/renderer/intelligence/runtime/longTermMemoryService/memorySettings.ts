/**
 * 记忆系统设置读取
 *
 * 「记忆系统设置」面板把用户配置写入 localStorage，运行期各消费方
 * （遗忘调度、保留值计算、写入分类）统一从这里读取，避免多处各自解析出一套口径。
 *
 * 逐条遍历时重复解析 JSON 代价偏高，因此缓存一份，设置保存后显式失效。
 */

/** 保留策略中的层级，与设置面板的 MemoryTier 对齐 */
export type MemoryTierKey = 'permanent' | 'long_term' | 'short_term' | 'working'

/** 缺省各层级保留天数（0 表示不过期） */
export const DEFAULT_TIER_RETENTION_DAYS: Record<MemoryTierKey, number> = {
  permanent: 3650,
  long_term: 180,
  short_term: 30,
  working: 1,
}

export interface MemorySettings {
  /** 是否启用自动遗忘（关闭后不再自动运行记忆巩固阶段） */
  autoForgettingEnabled: boolean
  /** 遗忘引擎运行间隔（小时） */
  forgettingIntervalHours: number
  /** 每次复习对保留值的提升倍数 */
  reviewBoostMultiplier: number
  /** 是否在写入时自动分类 */
  autoClassificationEnabled: boolean
  /** 分类最低置信度，低于此值的分类归入未分类 */
  minClassificationConfidence: number
  /** 是否共享记忆用于模型训练（同意标记，当前无下游消费方） */
  shareMemoryForTraining: boolean
  /** 是否加密敏感记忆（同步到主进程，命中敏感规则的记忆以密文落库） */
  encryptSensitiveMemory: boolean
  /** 各层级保留天数 */
  tierRetentionDays: Record<MemoryTierKey, number>
  /** 是否启用云端同步 */
  cloudSyncEnabled: boolean
  /** 退出时是否自动同步 */
  autoSyncOnExit: boolean
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  autoForgettingEnabled: true,
  forgettingIntervalHours: 24,
  reviewBoostMultiplier: 1,
  autoClassificationEnabled: true,
  minClassificationConfidence: 0.6,
  shareMemoryForTraining: false,
  encryptSensitiveMemory: true,
  tierRetentionDays: { ...DEFAULT_TIER_RETENTION_DAYS },
  cloudSyncEnabled: false,
  autoSyncOnExit: false,
}

/** 设置面板写入的 localStorage 键 */
const SETTINGS_STORAGE_KEY = 'memory-settings'

/** 数值区间，与设置面板输入框保持一致 */
const FORGETTING_INTERVAL_RANGE = { min: 1, max: 168 }
const REVIEW_BOOST_RANGE = { min: 0.5, max: 2 }
const MIN_CLASSIFICATION_CONFIDENCE_RANGE = { min: 0.3, max: 0.9 }
const RETENTION_DAYS_RANGE = { min: 0, max: 3650 }

let cache: MemorySettings | null = null

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 把存储里的原始对象规整为合法设置，缺项与越界一律回落 */
function normalize(raw: unknown): MemorySettings {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<MemorySettings>

  const tierRetentionDays: Record<MemoryTierKey, number> = { ...DEFAULT_TIER_RETENTION_DAYS }
  const days = saved.tierRetentionDays
  if (days && typeof days === 'object') {
    for (const tier of Object.keys(DEFAULT_TIER_RETENTION_DAYS) as MemoryTierKey[]) {
      if (days[tier] !== undefined) {
        tierRetentionDays[tier] = Math.round(
          clampNumber(
            days[tier],
            RETENTION_DAYS_RANGE.min,
            RETENTION_DAYS_RANGE.max,
            tierRetentionDays[tier],
          ),
        )
      }
    }
  }

  return {
    autoForgettingEnabled: toBoolean(
      saved.autoForgettingEnabled,
      DEFAULT_MEMORY_SETTINGS.autoForgettingEnabled,
    ),
    forgettingIntervalHours: clampNumber(
      saved.forgettingIntervalHours,
      FORGETTING_INTERVAL_RANGE.min,
      FORGETTING_INTERVAL_RANGE.max,
      DEFAULT_MEMORY_SETTINGS.forgettingIntervalHours,
    ),
    reviewBoostMultiplier: clampNumber(
      saved.reviewBoostMultiplier,
      REVIEW_BOOST_RANGE.min,
      REVIEW_BOOST_RANGE.max,
      DEFAULT_MEMORY_SETTINGS.reviewBoostMultiplier,
    ),
    autoClassificationEnabled: toBoolean(
      saved.autoClassificationEnabled,
      DEFAULT_MEMORY_SETTINGS.autoClassificationEnabled,
    ),
    minClassificationConfidence: clampNumber(
      saved.minClassificationConfidence,
      MIN_CLASSIFICATION_CONFIDENCE_RANGE.min,
      MIN_CLASSIFICATION_CONFIDENCE_RANGE.max,
      DEFAULT_MEMORY_SETTINGS.minClassificationConfidence,
    ),
    shareMemoryForTraining: toBoolean(
      saved.shareMemoryForTraining,
      DEFAULT_MEMORY_SETTINGS.shareMemoryForTraining,
    ),
    encryptSensitiveMemory: toBoolean(
      saved.encryptSensitiveMemory,
      DEFAULT_MEMORY_SETTINGS.encryptSensitiveMemory,
    ),
    tierRetentionDays,
    cloudSyncEnabled: toBoolean(saved.cloudSyncEnabled, DEFAULT_MEMORY_SETTINGS.cloudSyncEnabled),
    autoSyncOnExit: toBoolean(saved.autoSyncOnExit, DEFAULT_MEMORY_SETTINGS.autoSyncOnExit),
  }
}

/** 读取记忆系统设置（带缓存）。未写入或数据损坏时回落到默认值。 */
export function getMemorySettings(): MemorySettings {
  if (cache) return cache

  let next = DEFAULT_MEMORY_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) next = normalize(JSON.parse(raw))
  } catch {
    // 存储不可用或数据损坏：用默认值，不影响记忆的读写
  }

  cache = next
  return next
}

/** 设置变更后调用，使缓存失效（下次读取重新解析） */
export function invalidateMemorySettings(): void {
  cache = null
}

if (typeof window !== 'undefined') {
  // 其他窗口（如设置窗口）改了存储时同步失效缓存
  window.addEventListener('storage', (event) => {
    if (event.key === SETTINGS_STORAGE_KEY) cache = null
  })
}
