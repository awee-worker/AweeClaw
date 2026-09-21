/**
 * 命令执行通道判定单元测试
 *
 * 锁定「命令是否必须走后台通道」的判定，防止回归踩坏两条链路：
 * 1. 后台意图识别 —— 命令含 shell 的 `&` 后台操作符时必须当场返回，
 *    不能进入等待结束标记的通道（`... &; printf END` 在 bash/sh 下是语法错误，
 *    命令不执行且结束标记永不输出，表现为「一直执行中、拿不到结果」）；
 * 2. 误报排除 —— `&&`、I/O 重定向、引号内的 `&` 都不是后台意图，
 *    误判会让正常命令被扔进后台通道，AI 只拿到「已启动」而丢失真实输出。
 *
 * @module Toolkit/commandExecutor/test
 */

import { describe, it, expect } from 'vitest'
import {
  hasBackgroundIntent,
  hasBackgroundOperator,
  hasTrailingBackgroundOperator,
  isLongRunningCommand,
  matchesLongRunningCommand,
  resolveCommandTimeout,
  DEFAULT_TIMEOUT_MS,
} from '../commandExecutor'

describe('hasTrailingBackgroundOperator', () => {
  it('识别行尾的后台操作符', () => {
    expect(hasTrailingBackgroundOperator('python3 -m http.server 8877 &')).toBe(true)
    expect(hasTrailingBackgroundOperator('cd /tmp && npm run dev &')).toBe(true)
    expect(hasTrailingBackgroundOperator('python3 -m http.server 8877 &\n')).toBe(true)
  })

  it('不把逻辑与和普通命令当作后台', () => {
    expect(hasTrailingBackgroundOperator('npm run build && npm test')).toBe(false)
    expect(hasTrailingBackgroundOperator('python3 -m http.server 8877')).toBe(false)
  })
})

describe('hasBackgroundOperator', () => {
  it('识别不在行尾的后台操作符', () => {
    expect(hasBackgroundOperator('nohup python3 -m http.server 8877 & disown')).toBe(true)
    expect(hasBackgroundOperator('python3 -m http.server 8877 & echo started')).toBe(true)
    expect(hasBackgroundOperator('python3 -m http.server 8877 &')).toBe(true)
  })

  it('识别被重定向包裹的后台操作符', () => {
    expect(hasBackgroundOperator('python3 -m http.server 8877 > /dev/null 2>&1 &')).toBe(true)
    expect(hasBackgroundOperator('python3 -m http.server 8877 1>/tmp/out.log &')).toBe(true)
  })

  it('排除逻辑与运算符', () => {
    expect(hasBackgroundOperator('npm run build && npm test')).toBe(false)
    expect(hasBackgroundOperator('a && b && c')).toBe(false)
  })

  it('排除 I/O 重定向语法', () => {
    expect(hasBackgroundOperator('cmd 2>&1')).toBe(false)
    expect(hasBackgroundOperator('cmd > /tmp/out.log 2>&1')).toBe(false)
    expect(hasBackgroundOperator('cmd &> /tmp/both.log')).toBe(false)
    expect(hasBackgroundOperator('cmd &>> /tmp/both.log')).toBe(false)
  })

  it('排除引号内的 &', () => {
    expect(hasBackgroundOperator('curl "http://demo.local/api?a=1&b=2"')).toBe(false)
    expect(hasBackgroundOperator("echo 'left & right'")).toBe(false)
    expect(hasBackgroundOperator('awk \'{print $1 & $2}\' file.txt')).toBe(false)
  })

  it('未加引号的 URL 查询串不会误判', () => {
    // 后台操作符必然以空白 / 分号 / 管道 / 行尾收尾，URL 里的 & 后面直接跟键名
    expect(hasBackgroundOperator('curl http://demo.local/api?a=1&b=2')).toBe(false)
  })
})

describe('hasBackgroundIntent', () => {
  it('调用方显式声明后台时成立', () => {
    expect(hasBackgroundIntent('npm run dev', true)).toBe(true)
    expect(hasBackgroundIntent('npm run dev')).toBe(false)
  })

  it('命令自带的 & 与显式声明等价', () => {
    expect(hasBackgroundIntent('python3 -m http.server 8877 &')).toBe(true)
  })
})

describe('matchesLongRunningCommand', () => {
  it('匹配常见常驻服务命令', () => {
    expect(matchesLongRunningCommand('python3 -m http.server 8877 &')).toBe(true)
    expect(matchesLongRunningCommand('npm run dev')).toBe(true)
    expect(matchesLongRunningCommand('cd app && vite')).toBe(true)
    expect(matchesLongRunningCommand('uvicorn main:app --reload')).toBe(true)
  })

  it('跳过启动包装器后再匹配主体', () => {
    expect(matchesLongRunningCommand('nohup python3 -m http.server 8877')).toBe(true)
    expect(matchesLongRunningCommand('setsid npm run dev')).toBe(true)
    expect(matchesLongRunningCommand('sudo python3 -m http.server 8877')).toBe(true)
  })

  it('包装器后的短命令不会被误判为常驻', () => {
    expect(matchesLongRunningCommand('time ls -la')).toBe(false)
    expect(matchesLongRunningCommand('sudo cat /etc/hosts')).toBe(false)
    expect(matchesLongRunningCommand('env FOO=1 npm test')).toBe(false)
  })
})

describe('isLongRunningCommand', () => {
  it('后台意图或常驻命令任一成立即为真', () => {
    expect(isLongRunningCommand('python3 -m http.server 8877')).toBe(true)
    expect(isLongRunningCommand('./build.sh', true)).toBe(true)
    expect(isLongRunningCommand('./build.sh')).toBe(false)
  })
})

describe('resolveCommandTimeout', () => {
  it('常驻命令不设超时', () => {
    expect(resolveCommandTimeout('python3 -m http.server 8877 &', { isLongRunning: true })).toBe(0)
  })

  it('普通命令使用默认超时', () => {
    expect(resolveCommandTimeout('ls -la')).toBe(DEFAULT_TIMEOUT_MS)
  })
})
