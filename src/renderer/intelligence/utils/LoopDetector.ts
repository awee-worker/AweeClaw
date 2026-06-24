/**
 * 循环检测器统一入口
 *
 * 本文件为向后兼容入口，重新导出 CycleDetector 中的循环检测器。
 * 新代码请直接从 '@intelligence/utils/CycleDetector' 导入。
 */
export {
  CycleDetector,
  CycleDetector as LoopDetector,
  type LoopCheckResult,
  type LoopCheckResult as LoopDetectionResult,
} from './CycleDetector'
