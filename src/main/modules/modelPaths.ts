/**
 * 本地模型缓存路径
 *
 * 统一各类本地模型（文本嵌入 / 视觉语言等）的缓存根目录，使不同模块命中同一份权重文件：
 * 既避免同一模型被重复下载占用双份磁盘，也让清理与排查有唯一入口。
 *
 * transformers.js 默认把模型写入相对进程 cwd 的 .cache 目录，打包后该位置不可写，
 * 因此这里显式指向用户配置目录下的 models/，并遵循用户自定义的配置路径。
 *
 * 仅限主进程使用：依赖 Electron 与 electron-store。
 */

import * as path from 'path'
import { getUserConfigDir } from './configPath'

/**
 * 未就绪环境的兜底目录
 *
 * app 未初始化（例如单元测试）时无法读取 userData，退回到用户主目录下的隐藏目录。
 */
function fallbackHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '/tmp'
}

/**
 * 模型缓存根目录
 *
 * 优先使用用户自定义配置路径，未设置时使用 Electron 默认 userData。
 */
export function getModelsRootDir(): string {
  try {
    return path.join(getUserConfigDir(), 'models')
  } catch {
    return path.join(fallbackHomeDir(), '.aweeclaw', 'models')
  }
}

/**
 * 文本嵌入模型缓存目录
 *
 * 感知层的 LocalEmbedder 与代码检索的 Transformer 嵌入策略共用此目录，
 * 二者加载的是同一个模型权重，因此必须指向同一路径，否则会各下载一份。
 */
export function getEmbedderCacheDir(): string {
  return path.join(getModelsRootDir(), 'embedder')
}
