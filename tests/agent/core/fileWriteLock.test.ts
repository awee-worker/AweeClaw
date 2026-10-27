/**
 * 文件写入锁测试
 *
 * 覆盖三件事：
 * 1. 同一文件的并发写入不会交错；
 * 2. 不同文件的写入仍然并行；
 * 3. 路径写法差异与目录锁都能正确判定冲突。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  acquireFileWriteLock,
  collectFileWriteLockTargets,
  resetFileWriteLockForTest,
  withFileWriteLock,
  type FileLockTarget,
} from '@intelligence/engine/fileWriteLock'

function target(path: string, directory = false): FileLockTarget[] {
  return [{ path, directory }]
}

/** 记录进入与离开顺序，用来判断是否交错 */
function makeRecorder(label: string, log: string[], delayMs = 20) {
  return async () => {
    log.push(`${label}:enter`)
    await new Promise(resolve => setTimeout(resolve, delayMs))
    log.push(`${label}:leave`)
  }
}

beforeEach(() => {
  resetFileWriteLockForTest()
})

describe('withFileWriteLock', () => {
  it('串行化同一文件的并发写入', async () => {
    const log: string[] = []

    await Promise.all([
      withFileWriteLock(target('/ws/a.ts'), makeRecorder('first', log)),
      withFileWriteLock(target('/ws/a.ts'), makeRecorder('second', log)),
    ])

    expect(log).toEqual([
      'first:enter',
      'first:leave',
      'second:enter',
      'second:leave',
    ])
  })

  it('允许不同文件的写入并行', async () => {
    const log: string[] = []
    const startedAt = Date.now()

    await Promise.all([
      withFileWriteLock(target('/ws/a.ts'), makeRecorder('a', log, 60)),
      withFileWriteLock(target('/ws/b.ts'), makeRecorder('b', log, 60)),
      withFileWriteLock(target('/ws/c.ts'), makeRecorder('c', log, 60)),
    ])

    // 并行时三者同时进入，耗时接近单个写入而不是三倍
    expect(log.slice(0, 3).sort()).toEqual(['a:enter', 'b:enter', 'c:enter'])
    expect(Date.now() - startedAt).toBeLessThan(150)
  })

  it('写入抛错时依然释放锁', async () => {
    await expect(withFileWriteLock(target('/ws/a.ts'), async () => {
      throw new Error('write failed')
    })).rejects.toThrow('write failed')

    // 锁已释放，后续写入可以立即拿到
    const release = await acquireFileWriteLock(target('/ws/a.ts'))
    release()
  })

  it('目录锁覆盖其下的文件写入', async () => {
    const log: string[] = []

    await Promise.all([
      withFileWriteLock(target('/ws/src', true), makeRecorder('rmdir', log)),
      withFileWriteLock(target('/ws/src/a.ts'), makeRecorder('write', log)),
    ])

    expect(log).toEqual([
      'rmdir:enter',
      'rmdir:leave',
      'write:enter',
      'write:leave',
    ])
  })

  it('空目标不加锁', async () => {
    const log: string[] = []
    const startedAt = Date.now()

    await Promise.all([
      withFileWriteLock([], makeRecorder('a', log, 60)),
      withFileWriteLock([], makeRecorder('b', log, 60)),
    ])

    expect(log.slice(0, 2).sort()).toEqual(['a:enter', 'b:enter'])
    expect(Date.now() - startedAt).toBeLessThan(150)
  })
})

describe('collectFileWriteLockTargets', () => {
  const workspace = '/ws'

  it('归一化相对路径、反斜杠与 .. 写法', () => {
    const variants = ['src/a.ts', './src/a.ts', 'src\\a.ts', 'src/../src/a.ts', '/ws/src/a.ts']

    const paths = variants.map(variant =>
      collectFileWriteLockTargets('write_file', { path: variant }, workspace)[0]?.path,
    )

    expect(new Set(paths).size).toBe(1)
    expect(paths[0]).toBe('/ws/src/a.ts')
  })

  it('忽略大小写差异', () => {
    const upper = collectFileWriteLockTargets('edit_file', { path: 'Src/A.ts' }, workspace)
    const lower = collectFileWriteLockTargets('edit_file', { path: 'src/a.ts' }, workspace)

    expect(upper[0]?.path).toBe(lower[0]?.path)
  })

  it('识别创建目录时的两种写法', () => {
    const withSlash = collectFileWriteLockTargets('create_file_or_folder', { path: 'reports/' }, workspace)
    const withoutSlash = collectFileWriteLockTargets('create_file_or_folder', { path: 'reports' }, workspace)

    expect(withSlash[0]?.directory).toBe(true)
    expect(withoutSlash[0]?.directory).toBe(true)
  })

  it('创建文件不按目录处理', () => {
    const targets = collectFileWriteLockTargets(
      'create_file_or_folder',
      { path: 'src/config.ts', content: 'export default {}' },
      workspace,
    )

    expect(targets[0]?.directory).toBe(false)
  })

  it('删除一律按目录处理，避免漏掉目录内的写入', () => {
    const targets = collectFileWriteLockTargets('delete_file_or_folder', { path: 'src/a.ts' }, workspace)

    expect(targets[0]?.directory).toBe(true)
  })

  it('非写入工具不产生锁', () => {
    expect(collectFileWriteLockTargets('read_file', { path: 'src/a.ts' }, workspace)).toEqual([])
    expect(collectFileWriteLockTargets('run_command', { command: 'ls' }, workspace)).toEqual([])
  })

  it('缺少路径参数时不产生锁', () => {
    expect(collectFileWriteLockTargets('write_file', {}, workspace)).toEqual([])
    expect(collectFileWriteLockTargets('write_file', undefined, workspace)).toEqual([])
  })
})
