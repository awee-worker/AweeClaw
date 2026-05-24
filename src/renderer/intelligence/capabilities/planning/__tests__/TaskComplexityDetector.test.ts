import { describe, it, expect, beforeEach } from 'vitest'
import { TaskComplexityDetector } from '../TaskComplexityDetector'

describe('TaskComplexityDetector', () => {
  let detector: TaskComplexityDetector

  beforeEach(() => {
    detector = new TaskComplexityDetector()
  })

  describe('简单任务检测', () => {
    it('空任务应该返回 0 分', () => {
      const result = detector.analyze('')
      expect(result.total).toBe(0)
      expect(result.needsMultiAgent).toBe(false)
    })

    it('问候语应该是简单任务', () => {
      const result = detector.analyze('你好')
      expect(result.needsMultiAgent).toBe(false)
      expect(result.total).toBeLessThan(25)
    })

    it('简单代码问题应该是简单任务', () => {
      const result = detector.analyze('怎么写一个 for 循环？')
      expect(result.needsMultiAgent).toBe(false)
    })

    it('解释概念应该是简单任务', () => {
      const result = detector.analyze('解释一下什么是闭包')
      expect(result.needsMultiAgent).toBe(false)
    })
  })

  describe('多步骤任务检测', () => {
    it('设计到实现应该触发多 Agent', () => {
      const result = detector.analyze('设计并实现一个登录系统')
      expect(result.needsMultiAgent).toBe(true)
      expect(result.features).toContain('设计到实现的完整流程')
    })

    it('前后端联动应该触发多 Agent', () => {
      const result = detector.analyze('帮我写前端页面和后端接口')
      expect(result.needsMultiAgent).toBe(true)
      expect(result.features).toContain('前后端联动')
    })

    it('显式多步骤应该被检测', () => {
      const result = detector.analyze('首先设计数据库，然后写 API，最后做前端')
      expect(result.features.some(f => f.includes('显式多步骤') || f.includes('领域'))).toBe(true)
    })
  })

  describe('领域交叉检测', () => {
    it('涉及多个技术领域应该触发多 Agent', () => {
      const result = detector.analyze(
        '设计微服务架构，实现前后端分离，配置数据库索引，添加单元测试'
      )
      expect(result.needsMultiAgent).toBe(true)
      expect(result.dimensions.domainCrossing).toBeGreaterThan(20)
      expect(result.suggestedRoles).toContain('architect')
      expect(result.suggestedRoles).toContain('developer')
    })

    it('单一领域不应该触发', () => {
      const result = detector.analyze('帮我优化一个 SQL 查询')
      expect(result.needsMultiAgent).toBe(false)
    })
  })

  describe('特殊关键词检测', () => {
    it('从零搭建应该加分', () => {
      const result = detector.analyze('从零开始搭建一个电商项目')
      expect(result.features).toContain('从零搭建')
      expect(result.total).toBeGreaterThan(10)
    })

    it('技术选型应该加分', () => {
      const result = detector.analyze('帮我做技术选型，对比 React 和 Vue')
      expect(result.features).toContain('技术选型')
    })

    it('大规模系统应该高分', () => {
      const result = detector.analyze('设计一个高并发的分布式系统')
      expect(result.features).toContain('大规模系统')
      expect(result.total).toBeGreaterThan(20)
    })
  })

  describe('任务长度检测', () => {
    it('长任务应该加分', () => {
      const longTask = 'A'.repeat(250)
      const result = detector.analyze(longTask)
      expect(result.dimensions.length).toBe(30)
      expect(result.features).toContain('长任务描述（>200字）')
    })

    it('短任务不应该因长度加分', () => {
      const result = detector.analyze('你好')
      expect(result.dimensions.length).toBe(0)
    })
  })

  describe('综合场景', () => {
    it('复杂全栈任务应该高分', () => {
      const result = detector.analyze(
        '我需要从零开始搭建一个社交平台，包括用户认证系统、实时聊天功能、' +
        '朋友圈动态流、后端 API 设计、数据库表结构设计、前端响应式界面。' +
        '要求支持高并发，需要做好安全认证和性能优化。'
      )
      expect(result.needsMultiAgent).toBe(true)
      expect(result.total).toBeGreaterThan(60)
      expect(result.suggestedRoles.length).toBeGreaterThanOrEqual(2)
    })

    it('中等复杂度任务应该被检测到', () => {
      const result = detector.analyze(
        '帮我实现一个 Todo 应用的前端界面和后端接口'
      )
      // 这个任务有前后端联动
      expect(result.total).toBeGreaterThan(20)
      expect(result.features).toContain('前后端联动')
    })
  })

  describe('配置调整', () => {
    it('降低阈值应该更容易触发', () => {
      detector.updateConfig({ threshold: 20 })
      const result = detector.analyze('帮我写前端和后端')
      expect(result.needsMultiAgent).toBe(true)
    })

    it('提高阈值应该更难触发', () => {
      detector.updateConfig({ threshold: 90 })
      const result = detector.analyze('设计并实现一个登录系统')
      expect(result.needsMultiAgent).toBe(false)
    })
  })

  describe('needsMultiAgent 快捷方法', () => {
    it('应该与 analyze 结果一致', () => {
      const task = '设计并实现一个用户认证系统'
      expect(detector.needsMultiAgent(task)).toBe(detector.analyze(task).needsMultiAgent)
    })
  })
})
