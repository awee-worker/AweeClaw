/**
 * 数据分析师场景模块入口
 *
 * 导出 ScenarioModule 实现，由场景加载器自动发现和注册。
 */

import type { ScenarioModule, ScenarioModuleContext } from '../types'
import { dataAnalystScenario } from './config/scenario'
import DATA_ANALYST_TOOLS from './tools/definitions'

const dataAnalystModule: ScenarioModule = {
  id: 'data-analyst',
  version: '1.0.0',

  getPlugin: () => dataAnalystScenario,

  getTools: () => DATA_ANALYST_TOOLS,

  onActivate: async (context: ScenarioModuleContext) => {
    const { scenarioId, workspacePath } = context
    if (workspacePath) {
      const dbPath = `${workspacePath}/.data/default.db`
      try {
        const { api } = await import('@/renderer/services/electronAPI')
        await api.data.connectDatabase({
          id: 'default',
          driver: 'sqlite',
          filePath: dbPath,
        })
      } catch {}
    }
  },

  onDeactivate: async () => {
    try {
      const { api } = await import('@/renderer/services/electronAPI')
      await api.data.disconnectDatabase('default')
    } catch {}
  },
}

export default dataAnalystModule
