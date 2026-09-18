/**
 * 共享工具函数导出
 */

export { logger, type LogLevel, type LogCategory, type LogEntry } from './LogEngine'

// 路径工具函数
export {
  normalizePath,
  pathEquals,
  pathStartsWith,
  getBasename,
  getFileName,
  getDirname,
  getDirPath,
  getExtension,
  getPathSeparator,
  joinPaths,
  joinPath,
  toFullPath,
  toRelativePath,
  pathMatches,
  resolveImportPath,
  isPathInWorkspace,
  validatePath,
  hasPathTraversal,
  isSensitivePath,
} from './pathHelper'

// JSON 工具函数
export {
  getByPath,
  setByPath,
  hasPath,
  joinJsonPath,
  cleanToolCallArgs,
  fixUnescapedNewlines,
  fixMalformedJson,
  safeParseJson,
  generateId,
} from './jsonHelper'

// 性能监控
export {
  performanceMonitor,
  type PerformanceMetric,
  type MetricCategory,
  type MemorySnapshot,
} from './PerfTracker'

// 缓存服务
export {
  CacheService,
  cacheManager,
  createCache,
  createTypedCache,
  type CacheConfig,
  type CacheStats,
  type EvictionPolicy,
  type SetOptions,
  type CacheEvent,
} from './CacheManager'

// 重试工具
export {
  withRetry,
  withTimeout,
  sleep,
  cancellable,
  isRetryableError,
  type RetryConfig,
} from './retryPolicy'

// 日期工具
export {
  getRelativeTime,
} from './dateTimeHelper'

// 防抖与节流
export {
  debounce,
  throttle
} from './throttleDebounce'

// 统一存储服务
export {
  StorageService,
} from './StorageService'

// 版本比较工具
export {
  compareVersions,
  isVersionDirName,
  pickLatestVersionDir,
} from './versionHelper'