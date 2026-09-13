import { describe, expect, it } from 'vitest'

import {
  getInteractiveTerminalBackend,
  hasTrailingBackgroundOperator,
  isLongRunningCommand,
  matchesLongRunningCommand,
} from '@intelligence/toolkit/commandExecutor'

describe('commandExecutor', () => {
  it('routes macOS interactive agent sessions away from PTY', () => {
    expect(getInteractiveTerminalBackend('darwin')).toBe('pipe')
  })

  it('keeps PTY backend on non-macOS platforms', () => {
    expect(getInteractiveTerminalBackend('linux')).toBe('pty')
    expect(getInteractiveTerminalBackend('win32')).toBe('pty')
  })

  it('detects long-running commands and explicit background requests', () => {
    expect(isLongRunningCommand('npm run dev', false)).toBe(true)
    expect(isLongRunningCommand('vite', false)).toBe(true)
    expect(isLongRunningCommand('npm test', true)).toBe(true)
    expect(isLongRunningCommand('npm test', false)).toBe(false)
  })

  it('treats a trailing background operator as an explicit background request', () => {
    expect(hasTrailingBackgroundOperator('cd /tmp/app && python3 -m http.server 8080 &')).toBe(true)
    expect(hasTrailingBackgroundOperator('./start.sh &')).toBe(true)
    expect(hasTrailingBackgroundOperator('node server.js &   ')).toBe(true)
    // 以 && 结尾不是后台操作符；引号里的 & 也不算
    expect(hasTrailingBackgroundOperator('cd /tmp && npm test')).toBe(false)
    expect(hasTrailingBackgroundOperator('npm test &&')).toBe(false)
    expect(hasTrailingBackgroundOperator('echo "a &"')).toBe(false)
    expect(isLongRunningCommand('./start.sh &', false)).toBe(true)
  })

  it('keeps cd + server combinations on the background channel', () => {
    expect(matchesLongRunningCommand('cd /Volumes/data/site && python3 -m http.server 8080 &')).toBe(true)
    expect(matchesLongRunningCommand('cd /Volumes/data/site && python3 -m http.server 8080')).toBe(true)
    expect(matchesLongRunningCommand('python3.12 -m http.server')).toBe(true)
  })

  it('does not fire on keywords that are not in command position', () => {
    // 关键词只是被 echo / grep 引用（或在引号内）时，不能判定为长进程
    expect(matchesLongRunningCommand('grep -rn "npm run dev" src')).toBe(false)
    expect(matchesLongRunningCommand('echo "python3 -m http.server"')).toBe(false)
    expect(matchesLongRunningCommand('/usr/bin/python3 -m http.server 8080')).toBe(false)
  })
})
