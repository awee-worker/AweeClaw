/**
 * Java 语言注册回归测试
 *
 * 设置 → 语言服务器 的清单、LSP 路由、lint 自动安装都读同一份注册表，
 * 任何一处漏配都会表现为「界面有 Java 但打开文件没有诊断」：
 *  1) 定义里的 languages 为空 → LspSettingsPanel 会按 `languages.length > 0` 过滤掉，
 *     设置里看不到 Java，但服务端其实已实现
 *  2) 未进 LSP_SUPPORTED_LANGUAGES → isLspSupported / lint 前置判断直接跳过 Java
 *  3) 仍留在 LSP_EXTENSIBLE_LANGUAGES → 与实际支持列表口径冲突，后续接入手册会写错
 */
import { describe, it, expect } from 'vitest'
import {
  LSP_SERVER_DEFINITIONS,
  LSP_SUPPORTED_LANGUAGES,
  LSP_EXTENSIBLE_LANGUAGES,
  LANGUAGE_TO_LSP_ID,
  EXTENSION_TO_LANGUAGE,
  getServerIdForLanguage,
  getLanguageFromPath,
  isLspSupported,
} from '@shared/languageRegistry'

const javaDef = LSP_SERVER_DEFINITIONS.find((server) => server.id === 'java')

describe('Java 语言服务器定义', () => {
  it('注册表里存在 java 条目', () => {
    expect(javaDef).toBeDefined()
  })

  it('languages 恰为 [java]，不能为空（为空会被设置面板过滤掉）', () => {
    expect(javaDef?.languages).toEqual(['java'])
  })

  it('展示字段完整，供设置面板直接渲染', () => {
    expect(javaDef?.name).toBe('Java')
    expect(javaDef?.displayLanguages).toEqual(['Java'])
    expect(javaDef?.description).toContain('JDT')
  })

  it('标为可自动安装，界面才会给出安装按钮', () => {
    expect(javaDef?.installable).toBe(true)
    expect(javaDef?.builtin).toBe(false)
  })
})

describe('Java 在 LSP 链路上的映射', () => {
  it('语言 id 能路由到 java 服务器', () => {
    expect(getServerIdForLanguage('java')).toBe('java')
  })

  it('进入 LSP_SUPPORTED_LANGUAGES（渲染层 isLspSupported 依赖它）', () => {
    expect(LSP_SUPPORTED_LANGUAGES).toContain('java')
    expect(isLspSupported('java')).toBe(true)
  })

  it('不再出现在「尚未支持」的扩展语言列表里', () => {
    expect(LSP_EXTENSIBLE_LANGUAGES as readonly string[]).not.toContain('java')
  })

  it('LSP 语言 id 与注册的服务器一致', () => {
    expect(LANGUAGE_TO_LSP_ID.java).toBe('java')
  })
})

describe('.java 文件的语言识别', () => {
  it('扩展名映射到 java', () => {
    expect(EXTENSION_TO_LANGUAGE.java).toBe('java')
  })

  it('大小写扩展名同样识别为 java', () => {
    expect(getLanguageFromPath('/tmp/Demo.java')).toBe('java')
    expect(getLanguageFromPath('/tmp/Demo.JAVA')).toBe('java')
  })
})

describe('注册表整体一致性', () => {
  it('服务器 id 不重复', () => {
    const ids = LSP_SERVER_DEFINITIONS.map((server) => server.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('声明了语言的定义一定非空且语言不重复注册', () => {
    const seen = new Map<string, string>()
    for (const server of LSP_SERVER_DEFINITIONS) {
      const langs = server.languages
      if (langs.length === 0) continue
      expect(new Set(langs).size).toBe(langs.length)
      for (const lang of langs) {
        const owner = seen.get(lang)
        // 同一语言只能有一个默认服务器，否则服务器选择不确定
        expect(owner === undefined || owner === server.id).toBe(true)
        seen.set(lang, server.id)
      }
    }
  })
})
