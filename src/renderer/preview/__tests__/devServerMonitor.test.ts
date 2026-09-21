/**
 * 预览服务存活监控的地址判定测试
 *
 * 探活只对本地回环地址发起。判定过宽会把外部站点也纳入周期探测（无谓的网络请求），
 * 过窄则本地服务停了也发现不了，因此把边界钉住。
 */

import { describe, it, expect } from 'vitest'
import { isLocalPreviewUrl } from '../devServerMonitor'

describe('isLocalPreviewUrl', () => {
  it('识别本地回环地址（dev server 与内置静态预览）', () => {
    expect(isLocalPreviewUrl('http://localhost:5173')).toBe(true)
    expect(isLocalPreviewUrl('http://localhost:5173/')).toBe(true)
    expect(isLocalPreviewUrl('http://127.0.0.1:50540/index.html')).toBe(true)
    expect(isLocalPreviewUrl('http://127.0.0.1:50540/')).toBe(true)
    expect(isLocalPreviewUrl('https://127.0.0.1:8443/app')).toBe(true)
    expect(isLocalPreviewUrl('http://[::1]:3000/')).toBe(true)
  })

  it('外部地址不参与探活', () => {
    expect(isLocalPreviewUrl('https://www.google.com')).toBe(false)
    expect(isLocalPreviewUrl('https://example.com/docs')).toBe(false)
    expect(isLocalPreviewUrl('file:///tmp/index.html')).toBe(false)
  })

  it('域名中仅含 localhost 字样的不算本地服务', () => {
    expect(isLocalPreviewUrl('http://notlocalhost.example.com:5173/')).toBe(false)
    expect(isLocalPreviewUrl('https://example.com/localhost:5173')).toBe(false)
  })
})
