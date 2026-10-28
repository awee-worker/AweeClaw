/**
 * 客户端真实版本号
 *
 * 场景的 minAppVersion 兼容性校验必须比对真实运行版本。此前该值以常量形式
 * 写在模块内，发版时容易漏改：客户端已升到新版本，常量仍停在旧值，声明了
 * minAppVersion 的第三方场景会被误判为「客户端版本过低」而拒绝注册。
 *
 * 版本号由构建期 define 注入，来源为 package.json 的 version，与
 * electron 的 app.getVersion() 同源，不需要在两处各自维护。
 */

/** 构建期注入的版本号；未注入时该标识符不存在 */
declare const __APP_VERSION__: string | undefined

/**
 * 读取客户端版本号。
 *
 * 注入缺失（例如被打进未配置 define 的子构建）时返回 '0.0.0'，
 * 按最旧版本处理——宁可让兼容性校验更严格，也不放宽放行。
 */
export function resolveAppVersion(): string {
  const injected = (globalThis as Record<string, unknown>).__APP_VERSION__
  if (typeof injected === 'string' && injected.trim()) return injected.trim()

  if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()) {
    return __APP_VERSION__.trim()
  }

  return '0.0.0'
}
