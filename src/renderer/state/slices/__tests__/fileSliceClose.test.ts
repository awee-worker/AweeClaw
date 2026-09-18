/**
 * 已打开文件关闭行为测试
 *
 * 重点覆盖批量关闭：关闭全部/关闭其他/关闭右侧都依赖它，
 * 必须一次移除多个 Tab，并且只在必要时才重算活跃文件
 * （活跃文件变化会触发 Monaco 切换 model，成本很高）。
 */

import { describe, it, expect } from 'vitest'
import { create } from 'zustand'
import { createFileSlice, type FileSlice } from '../fileSlice'

function createTestStore() {
  return create<FileSlice>()((set, get, api) => ({
    ...createFileSlice(set, get, api),
  }))
}

function openThree(store: ReturnType<typeof createTestStore>) {
  store.getState().openFile('/a.ts', 'a')
  store.getState().openFile('/b.ts', 'b')
  store.getState().openFile('/c.ts', 'c')
}

describe('fileSlice 关闭文件', () => {
  it('closeFiles 一次移除多个 Tab', () => {
    const store = createTestStore()
    openThree(store)

    store.getState().closeFiles(['/a.ts', '/c.ts'])

    expect(store.getState().openFiles.map((f) => f.path)).toEqual(['/b.ts'])
  })

  it('关闭包含活跃文件时，活跃文件回退到剩余最后一个', () => {
    const store = createTestStore()
    openThree(store)
    expect(store.getState().activeFilePath).toBe('/c.ts')

    store.getState().closeFiles(['/a.ts', '/c.ts'])

    expect(store.getState().activeFilePath).toBe('/b.ts')
  })

  it('关闭不含活跃文件时，活跃文件保持不变', () => {
    const store = createTestStore()
    openThree(store)

    store.getState().closeFiles(['/a.ts'])

    expect(store.getState().activeFilePath).toBe('/c.ts')
  })

  it('全部关闭后活跃文件为 null', () => {
    const store = createTestStore()
    openThree(store)

    store.getState().closeFiles(['/a.ts', '/b.ts', '/c.ts'])

    expect(store.getState().openFiles).toHaveLength(0)
    expect(store.getState().activeFilePath).toBeNull()
  })

  it('传入不存在或空路径列表时不做任何改动', () => {
    const store = createTestStore()
    openThree(store)
    const before = store.getState().openFiles

    store.getState().closeFiles([])
    store.getState().closeFiles(['/missing.ts'])

    expect(store.getState().openFiles).toBe(before)
    expect(store.getState().activeFilePath).toBe('/c.ts')
  })

  it('closeFile 与批量关闭行为一致', () => {
    const store = createTestStore()
    openThree(store)

    store.getState().closeFile('/c.ts')

    expect(store.getState().openFiles.map((f) => f.path)).toEqual(['/a.ts', '/b.ts'])
    expect(store.getState().activeFilePath).toBe('/b.ts')
  })
})

describe('fileSlice 批量标记已保存', () => {
  it('一次清除多个文件的脏标记并更新版本号', () => {
    const store = createTestStore()
    store.getState().openFile('/a.ts', 'a')
    store.getState().openFile('/b.ts', 'b')

    store.getState().updateFileDirtyState('/a.ts', 2)
    store.getState().updateFileDirtyState('/b.ts', 3)
    expect(store.getState().openFiles.every((f) => f.isDirty)).toBe(true)

    store.getState().markFilesSaved([
      { path: '/a.ts', versionId: 2 },
      { path: '/b.ts', versionId: 3 },
    ])

    for (const file of store.getState().openFiles) {
      expect(file.isDirty).toBe(false)
    }
    expect(store.getState().openFiles.find((f) => f.path === '/a.ts')?.savedVersionId).toBe(2)
    expect(store.getState().openFiles.find((f) => f.path === '/b.ts')?.savedVersionId).toBe(3)
  })

  it('空列表不改变状态', () => {
    const store = createTestStore()
    store.getState().openFile('/a.ts', 'a')
    store.getState().updateFileDirtyState('/a.ts', 2)
    const before = store.getState().openFiles

    store.getState().markFilesSaved([])

    expect(store.getState().openFiles).toBe(before)
  })
})
