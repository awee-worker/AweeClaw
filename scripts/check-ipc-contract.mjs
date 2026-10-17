/**
 * IPC 契约一致性检查
 *
 * 背景：主进程（preload/types.ts）与渲染进程（types/electronBridge.d.ts）
 * 各自声明了它们之间传输的数据结构。两份定义互不相干时，结构漂移不会有任何
 * 编译错误 —— 只有运行时字段对不上才暴露。此前有 3 个类型处于这种双份维护状态。
 *
 * 规则：跨层共用的数据结构只能定义在 shared/protocols/ipcContract.ts，
 * 两端通过 re-export 引用。本脚本检测是否又出现了同名的独立定义。
 *
 * 用法：npm run check:contract
 * 退出码：0 一致；1 发现重复定义
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SIDES = [
  { name: 'renderer', file: 'src/renderer/types/electronBridge.d.ts' },
  { name: 'preload', file: 'src/main/preload/types.ts' },
]

/**
 * 提取文件里有实际定义的导出名。
 *
 * 只统计 interface / type alias / enum / class 这类「声明」，
 * 通过 `export type { X } from ...` 转发的条目不计入 —— 那正是期望的写法。
 */
function collectDefinedNames(absPath) {
  if (!fs.existsSync(absPath)) return new Map()
  const src = fs.readFileSync(absPath, 'utf8')
  const names = new Map()

  // 逐个声明块匹配：export interface X / export type X = / export enum X / export class X
  const declRe = /^export\s+(?:declare\s+)?(interface|type|enum|class)\s+([A-Za-z0-9_$]+)/gm
  let m
  while ((m = declRe.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length
    names.set(m[2], line)
  }
  return names
}

const collected = SIDES.map((side) => ({
  ...side,
  names: collectDefinedNames(path.join(ROOT, side.file)),
}))

for (const side of collected) {
  console.log(`${side.name.padEnd(9)} ${side.file} 定义 ${side.names.size} 个类型`)
}

const [a, b] = collected
const duplicated = [...a.names.keys()].filter((n) => b.names.has(n))

if (duplicated.length === 0) {
  console.log('\n✓ 未发现跨层重复定义')
  process.exit(0)
}

console.error('\n✗ 发现跨层重复定义的类型：')
for (const name of duplicated) {
  console.error(
    `  ${name}  —— ${a.file}:${a.names.get(name)} 与 ${b.file}:${b.names.get(name)}`,
  )
}
console.error(
  '\n请把定义收敛到 src/shared/protocols/ipcContract.ts，两端改为 re-export，避免结构漂移。',
)
process.exit(1)
