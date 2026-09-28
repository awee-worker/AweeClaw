/**
 * transformers.js 运行时环境
 *
 * @xenova/transformers 默认从 huggingface.co 拉取模型权重，国内网络下请求会直接
 * fetch failed，导致本地嵌入模型始终加载不出来。这里统一把远端指向 hf-mirror.com
 * 镜像（与本地语音的模型下载器使用同一镜像），并允许用 HF_ENDPOINT 覆盖。
 *
 * 只依赖 process.env，主进程与 Worker 线程均可复用。
 */

/** 默认镜像地址（国内可直连） */
const DEFAULT_MODEL_HOST = 'https://hf-mirror.com'

/** 覆盖站点地址的环境变量名（与 HuggingFace 官方 CLI 保持一致） */
const ENDPOINT_ENV_KEY = 'HF_ENDPOINT'

/** transformers.js 的 env 对象中需要用到的字段 */
export interface TransformersEnv {
  /** 远端主机前缀，例如 https://hf-mirror.com */
  remoteHost?: string
  /** 模型缓存目录 */
  cacheDir?: string | null
  /** 是否允许从本地 node_modules 加载模型 */
  allowLocalModels?: boolean
  /** 是否允许联网下载模型 */
  allowRemoteModels?: boolean
}

/** 解析实际生效的模型站点地址 */
export function resolveModelHost(): string {
  const override = process.env[ENDPOINT_ENV_KEY]?.trim()
  if (override) return override.replace(/\/+$/, '')
  return DEFAULT_MODEL_HOST
}

/**
 * 配置 transformers.js 的 env
 *
 * 统一处理三件事：切换到可访问的镜像站点、关闭本地模型查找（打包后 node_modules
 * 里没有模型文件，查找只会浪费时间）、指定缓存目录。
 *
 * @param env transformers 导出的 env 对象
 * @param cacheDir 模型缓存目录；不传则沿用 transformers 的默认值
 * @returns 实际生效的站点地址，便于日志与排查
 */
export function configureTransformersEnv(env: TransformersEnv, cacheDir?: string): string {
  const host = resolveModelHost()
  env.remoteHost = host
  env.allowLocalModels = false
  env.allowRemoteModels = true
  if (cacheDir) env.cacheDir = cacheDir
  return host
}
