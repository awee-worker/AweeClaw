/**
 * 图片资源模块类型声明
 *
 * 为 AweeClaw 客户端中通过 Vite 导入的图片资源提供 TypeScript 类型支持。
 * 涵盖 GIF/PNG/JPG/SVG 四种常见图片格式，导入后返回资源 URL 字符串。
 *
 * @module AweeClawImageAssets
 */

declare module '*.gif' {
  /** 图片资源 URL */
  const imageUrl: string
  export default imageUrl
}

declare module '*.png' {
  /** 图片资源 URL */
  const imageUrl: string
  export default imageUrl
}

declare module '*.jpg' {
  /** 图片资源 URL */
  const imageUrl: string
  export default imageUrl
}

declare module '*.svg' {
  /** 图片资源 URL */
  const imageUrl: string
  export default imageUrl
}
