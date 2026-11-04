/**
 * 编辑器语言映射的 Java 覆盖测试
 *
 * Monaco 的 java 语言由 basic-languages 提供，语言 id 就叫 'java'，
 * 因此映射层**不需要**额外的 override。若有人误加（例如把它映射成 'c'），
 * 表现为「打开 .java 文件语法高亮错乱」且 LSP 请求也发不出去。
 */
import { describe, it, expect } from 'vitest'
import { getLanguage } from '@components/workspace-editor/utils/langIdMapper'

describe('Monaco 语言 id 映射', () => {
  it('.java 映射为 java，而不是被覆盖成其它语言', () => {
    expect(getLanguage('/projects/demo/src/main/java/com/demo/App.java')).toBe('java')
  })

  it('大写扩展名同样映射为 java', () => {
    expect(getLanguage('/tmp/App.JAVA')).toBe('java')
  })

  it('已有 override 不受影响（TSX 仍走 typescript）', () => {
    expect(getLanguage('/tmp/App.tsx')).toBe('typescript')
  })

  it('未知扩展名退回 plaintext', () => {
    expect(getLanguage('/tmp/notes.unknownext')).toBe('plaintext')
  })
})
