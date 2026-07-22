#!/usr/bin/env node
/**
 * 性能基线测试运行器 — 阶段9 s9-07
 *
 * 用途：
 * - 执行 perception 模块下所有 __tests__/baseline/*.test.ts 基准测试
 * - 汇总各模块 JSON 报告到 docs/phase9/baseline-summary.json
 * - 打印人类可读摘要表格
 *
 * 使用方式：
 *   node scripts/run-perf-baseline.js
 *   # 或通过 npm
 *   npm run test:baseline
 *
 * 输出：
 *   - docs/phase9/perception-fusion-baseline.json
 *   - docs/phase9/behavior-predictor-baseline.json
 *   - docs/phase9/impact-analyzer-baseline.json
 *   - docs/phase9/local-embedder-baseline.json
 *   - docs/phase9/baseline-summary.json（聚合）
 *
 * @module scripts/run-perf-baseline
 */

const { spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { resolve, dirname } = require('node:path')

// ============================================================
// 配置
// ============================================================

const PROJECT_ROOT = resolve(__dirname, '..')
// 测试文件中的报告写入路径为：__dirname/../../../../../../../docs/phase9/
// 即 PROJECT_ROOT 的上一级（整体项目根 aweclaw/docs/phase9）
const DOCS_DIR = resolve(PROJECT_ROOT, '..', 'docs/phase9')

/** 各模块基准测试文件与输出文件映射 */
const BASELINE_TESTS = [
  {
    name: 'PerceptionFusionService',
    testFile: 'src/main/modules/perception/__tests__/baseline/PerceptionFusionBaseline.test.ts',
    outputFile: 'perception-fusion-baseline.json',
  },
  {
    name: 'BehaviorPredictor',
    testFile: 'src/main/modules/perception/__tests__/baseline/BehaviorPredictorBaseline.test.ts',
    outputFile: 'behavior-predictor-baseline.json',
  },
  {
    name: 'ImpactAnalyzer',
    testFile: 'src/main/modules/perception/__tests__/baseline/ImpactAnalyzerBaseline.test.ts',
    outputFile: 'impact-analyzer-baseline.json',
  },
  {
    name: 'LocalEmbedder',
    testFile: 'src/main/modules/perception/__tests__/baseline/LocalEmbedderBaseline.test.ts',
    outputFile: 'local-embedder-baseline.json',
  },
]

// ============================================================
// 核心函数
// ============================================================

/**
 * 运行单个基准测试
 *
 * @param {typeof BASELINE_TESTS[0]} testConfig 测试配置
 * @returns {{ success: boolean, reportPath: string|null, error?: string }}
 */
function runBaselineTest(testConfig) {
  console.log(`\n▶ 运行基准测试: ${testConfig.name}`)
  console.log(`  文件: ${testConfig.testFile}`)

  const result = spawnSync(
    'npx',
    ['vitest', '--run', testConfig.testFile, '--reporter=verbose'],
    {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 120_000, // 2 分钟超时
    },
  )

  if (result.status !== 0) {
    console.error(`  ❌ 失败 (exit=${result.status})`)
    if (result.stderr) {
      console.error(`  stderr: ${result.stderr.slice(0, 500)}`)
    }
    return { success: false, reportPath: null, error: `Exit code ${result.status}` }
  }

  const reportPath = resolve(DOCS_DIR, testConfig.outputFile)
  if (!existsSync(reportPath)) {
    console.warn(`  ⚠️  测试通过但报告文件未生成: ${reportPath}`)
    return { success: true, reportPath: null }
  }

  console.log(`  ✅ 完成，报告: ${reportPath}`)
  return { success: true, reportPath }
}

/**
 * 聚合所有基准报告为 summary.json
 *
 * @param {Array<{ name: string, reportPath: string|null, success: boolean }>} results
 */
function aggregateSummary(results) {
  const summary = {
    generatedAt: new Date().toISOString(),
    phase: 'phase9-s9-07',
    version: '1.0.0',
    modules: [],
    allPassed: true,
  }

  for (const r of results) {
    if (!r.reportPath) {
      summary.modules.push({
        name: r.name,
        success: r.success,
        results: [],
      })
      if (!r.success) summary.allPassed = false
      continue
    }

    try {
      const reportData = JSON.parse(readFileSync(r.reportPath, 'utf-8'))
      summary.modules.push({
        name: r.name,
        success: reportData.summary?.allPassed ?? false,
        benchmarkCount: reportData.summary?.totalBenchmarks ?? 0,
        failingBenchmarks: reportData.summary?.failingBenchmarks ?? [],
        results: (reportData.results ?? []).map((b) => ({
          name: b.name,
          p50Ms: b.stats.p50Ms,
          p95Ms: b.stats.p95Ms,
          p99Ms: b.stats.p99Ms,
          meanMs: b.stats.meanMs,
          throughputOpsPerSec: b.stats.throughputOpsPerSec,
          failures: b.stats.failures,
        })),
      })
      if (!reportData.summary?.allPassed) summary.allPassed = false
    } catch (e) {
      summary.modules.push({
        name: r.name,
        success: false,
        error: `Failed to parse report: ${e.message}`,
      })
      summary.allPassed = false
    }
  }

  const summaryPath = resolve(DOCS_DIR, 'baseline-summary.json')
  mkdirSync(dirname(summaryPath), { recursive: true })
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
  console.log(`\n📊 聚合报告已生成: ${summaryPath}`)
  return summary
}

/**
 * 打印人类可读摘要
 *
 * @param {ReturnType<typeof aggregateSummary>} summary
 */
function printHumanSummary(summary) {
  console.log('\n========================================')
  console.log('  阶段9 s9-07 性能基线汇总')
  console.log('========================================')
  console.log(`生成时间: ${summary.generatedAt}`)
  console.log(`全部通过: ${summary.allPassed ? '✅' : '❌'}`)
  console.log('----------------------------------------')

  for (const mod of summary.modules) {
    console.log(`\n【${mod.name}】 ${mod.success ? '✅' : '❌'}`)
    if (mod.error) {
      console.log(`  错误: ${mod.error}`)
      continue
    }
    if (!mod.results || mod.results.length === 0) {
      console.log('  （无结果）')
      continue
    }
    for (const r of mod.results) {
      const status = r.failures === 0 ? '✅' : '❌'
      console.log(
        `  ${status} ${r.name}: ` +
          `p50=${r.p50Ms}ms p95=${r.p95Ms}ms p99=${r.p99Ms}ms ` +
          `throughput=${r.throughputOpsPerSec}ops/s`,
      )
    }
  }

  console.log('\n========================================\n')
}

// ============================================================
// 主流程
// ============================================================

function main() {
  console.log('阶段9 s9-07 性能基线测试运行器')
  console.log(`项目根: ${PROJECT_ROOT}`)
  console.log(`报告目录: ${DOCS_DIR}`)

  // 确保输出目录存在
  mkdirSync(DOCS_DIR, { recursive: true })

  // 顺序执行所有基准测试
  const results = []
  for (const testConfig of BASELINE_TESTS) {
    const r = runBaselineTest(testConfig)
    results.push({ name: testConfig.name, ...r })
  }

  // 聚合 + 打印
  const summary = aggregateSummary(results)
  printHumanSummary(summary)

  // 退出码：全部通过返回 0，否则返回 1
  process.exit(summary.allPassed ? 0 : 1)
}

main()
