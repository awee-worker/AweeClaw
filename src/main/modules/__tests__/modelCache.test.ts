/**
 * 模型缓存校验与清理测试
 *
 * 覆盖半成品缓存的判定边界：下载中断会留下错误页或截断文件（例如只有几百 KB 的 onnx），
 * 这类残留必须能被识别并清理，否则每次重试都会读到同一份坏数据而无法自愈。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EMBEDDER_META_FILES,
  EMBEDDER_WEIGHT_FILES,
  calculateDirSize,
  discardInvalidModelCache,
  formatBytes,
  inspectModelCache,
  removeModelCache,
  resolveModelDir,
} from '../modelCache'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

/** 创建指定大小的稀疏文件，避免测试真实写入大文件 */
function writeFileOfSize(filePath: string, size: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, '')
  if (size > 0) fs.truncateSync(filePath, size)
}

/** 写入一份完整的模型缓存 */
function writeCompleteModel(modelDir: string): void {
  writeFileOfSize(path.join(modelDir, 'onnx/model_quantized.onnx'), 6 * 1024 * 1024)
  writeFileOfSize(path.join(modelDir, 'config.json'), 1024)
  writeFileOfSize(path.join(modelDir, 'tokenizer.json'), 2048)
}

describe('modelCache', () => {
  let cacheDir: string
  let modelDir: string

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awee-model-cache-'))
    modelDir = resolveModelDir(cacheDir, MODEL_ID)
  })

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  it('目录不存在时判定为未下载', () => {
    const result = inspectModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(result.present).toBe(false)
    expect(result.complete).toBe(false)
    expect(result.sizeBytes).toBe(0)
  })

  it('权重与元数据齐备时判定为完整', () => {
    writeCompleteModel(modelDir)

    const result = inspectModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(result.present).toBe(true)
    expect(result.complete).toBe(true)
    expect(result.invalidFiles).toEqual([])
    expect(result.sizeBytes).toBeGreaterThan(6 * 1024 * 1024)
  })

  it('权重文件是错误页（体积过小）时判定为不完整', () => {
    writeFileOfSize(path.join(modelDir, 'onnx/model_quantized.onnx'), 315_894)
    writeFileOfSize(path.join(modelDir, 'config.json'), 1024)
    writeFileOfSize(path.join(modelDir, 'tokenizer.json'), 2048)

    const result = inspectModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(result.present).toBe(true)
    expect(result.complete).toBe(false)
    expect(result.invalidFiles).toContain('onnx/model_quantized.onnx')
  })

  it('权重文件缺失、仅剩元数据时判定为不完整', () => {
    writeFileOfSize(path.join(modelDir, 'config.json'), 1024)

    const result = inspectModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(result.complete).toBe(false)
    expect(result.invalidFiles).toContain('onnx/model_quantized.onnx')
    expect(result.invalidFiles).toContain('tokenizer.json')
  })

  it('未量化的 model.onnx 同样满足权重要求', () => {
    writeFileOfSize(path.join(modelDir, 'onnx/model.onnx'), 6 * 1024 * 1024)
    writeFileOfSize(path.join(modelDir, 'config.json'), 1024)
    writeFileOfSize(path.join(modelDir, 'tokenizer.json'), 2048)

    const result = inspectModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(result.complete).toBe(true)
  })

  it('清理半成品缓存，保留完整缓存', () => {
    writeFileOfSize(path.join(modelDir, 'onnx/model_quantized.onnx'), 2048)

    const first = discardInvalidModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(first.removed).toBe(true)
    expect(first.invalidFiles.length).toBeGreaterThan(0)
    expect(fs.existsSync(modelDir)).toBe(false)

    writeCompleteModel(modelDir)

    const second = discardInvalidModelCache(cacheDir, MODEL_ID, EMBEDDER_WEIGHT_FILES, EMBEDDER_META_FILES)
    expect(second.removed).toBe(false)
    expect(second.invalidFiles).toEqual([])
    expect(fs.existsSync(modelDir)).toBe(true)
  })

  it('目录不存在时不执行删除', () => {
    expect(removeModelCache(cacheDir, MODEL_ID)).toBe(false)
  })

  it('统计嵌套文件占用', () => {
    writeFileOfSize(path.join(modelDir, 'a/b.bin'), 1000)
    writeFileOfSize(path.join(modelDir, 'c.bin'), 500)

    expect(calculateDirSize(modelDir)).toBe(1500)
  })

  it('输出可读体积', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(22 * 1024 * 1024)).toBe('22.0 MB')
  })
})
