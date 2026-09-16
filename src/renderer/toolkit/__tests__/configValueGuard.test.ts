/**
 * configValueGuard 单测
 *
 * 覆盖「表单 onChange 误传事件对象」这一类真实故障：
 * 脏值必须被拦下，且不能连带拦掉同批次里合法的字段。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isConfigPrimitive, isConfigValue, pickConfigPatch } from '../configValueGuard'

/** 模拟 React 事件对象（类实例，非纯对象） */
class FakeChangeEvent {
  target = { checked: true, value: '1.8' }
  currentTarget = this.target
  type = 'change'
}

/** 模拟 DOM 节点 */
class FakeNode {
  nodeName = 'INPUT'
}

describe('configValueGuard', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  describe('isConfigPrimitive', () => {
    it('放行 string / number / boolean', () => {
      expect(isConfigPrimitive('Junhao')).toBe(true)
      expect(isConfigPrimitive(0)).toBe(true)
      expect(isConfigPrimitive(false)).toBe(true)
    })

    it('拦截 NaN / Infinity —— 它们同样是 number，会绕过 typeof 判断', () => {
      expect(isConfigPrimitive(parseFloat(''))).toBe(false)
      expect(isConfigPrimitive(Infinity)).toBe(false)
      expect(isConfigPrimitive(-Infinity)).toBe(false)
    })

    it('拦截对象与函数', () => {
      expect(isConfigPrimitive(new FakeChangeEvent())).toBe(false)
      expect(isConfigPrimitive([])).toBe(false)
      expect(isConfigPrimitive(() => undefined)).toBe(false)
      expect(isConfigPrimitive(undefined)).toBe(false)
    })
  })

  describe('isConfigValue', () => {
    it('放行 undefined / null（清空可选字段的合法写法）', () => {
      expect(isConfigValue(undefined)).toBe(true)
      expect(isConfigValue(null)).toBe(true)
    })

    it('放行由原始值组成的数组与纯对象', () => {
      expect(isConfigValue(['127.0.0.1', '10.0.0.1'])).toBe(true)
      expect(isConfigValue({ enabled: true, port: 39540 })).toBe(true)
    })

    it('拦截事件对象 / DOM 节点 / 函数', () => {
      expect(isConfigValue(new FakeChangeEvent())).toBe(false)
      expect(isConfigValue(new FakeNode())).toBe(false)
      expect(isConfigValue({ onDone: () => undefined })).toBe(false)
    })
  })

  describe('pickConfigPatch', () => {
    it('全部字段合法时原样返回，且不告警', () => {
      const patch = { enabled: true, speed: 1.0 }
      expect(pickConfigPatch(patch, 'TestPanel')).toEqual(patch)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('丢弃误传事件对象的字段（LocalVoiceSettings 场景）', () => {
      const clean = pickConfigPatch({ enabled: new FakeChangeEvent() as unknown as boolean }, 'TestPanel')
      expect(clean).toEqual({})
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0][0])).toContain('TestPanel')
    })

    it('逐字段剪枝：一个脏值不连带拦掉同批次合法字段', () => {
      const patch = {
        enabled: true,
        tts: { modelName: 'moss', defaultSpeed: new FakeChangeEvent() as unknown as number },
      }
      expect(pickConfigPatch(patch, 'TestPanel')).toEqual({ enabled: true, tts: { modelName: 'moss' } })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      // 告警需给出精确路径，便于定位调用方
      expect(String(warnSpy.mock.calls[0][1])).toContain('tts.defaultSpeed')
    })

    it('嵌套对象整体保留结构，仅剔除脏叶子', () => {
      const patch = {
        send: { enabled: true, host: '127.0.0.1' },
        receive: { enabled: new FakeChangeEvent() as unknown as boolean, port: 39539 },
      }
      expect(pickConfigPatch(patch, 'VmcSettings')).toEqual({
        send: { enabled: true, host: '127.0.0.1' },
        receive: { port: 39539 },
      })
    })

    it('数组内出现脏值时丢弃整个数组字段', () => {
      const patch = {
        receive: {
          allowedIps: ['127.0.0.1', new FakeNode() as unknown as string],
          port: 39539,
        },
      }
      expect(pickConfigPatch(patch, 'VmcSettings')).toEqual({ receive: { port: 39539 } })
      expect(String(warnSpy.mock.calls[0][1])).toContain('allowedIps')
    })

    it('拦截 NaN（输入框清空时 parseFloat 的返回值）', () => {
      expect(pickConfigPatch({ defaultSpeed: parseFloat('') }, 'TestPanel')).toEqual({})
    })

    it('保留 undefined —— 用于「随机/清空」的显式写法', () => {
      const clean = pickConfigPatch({ mood: undefined }, 'ProactiveRandomTopicSettings')
      expect(Object.keys(clean)).toEqual(['mood'])
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
