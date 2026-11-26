/**
 * 工作流数据库 API
 *
 * 覆盖 IPC 频道：workflow-db:*
 * 由 workflowPersistenceV2 / runHistoryV2 的内存镜像层调用，
 * 渲染进程不直接使用这些方法。
 */
import { invoke } from '../ipcHelpers'

export function createWorkflowDbApi() {
  return {
    workflowDbInitialize: invoke<{ ok: boolean; dbPath?: string }>('workflow-db:initialize'),
    workflowDbListDefs: invoke('workflow-db:listDefs'),
    workflowDbGetDef: (id: string) => invoke('workflow-db:getDef')(id),
    workflowDbUpsertDef: (def: unknown) => invoke('workflow-db:upsertDef')(def),
    workflowDbDeleteDef: (id: string) => invoke('workflow-db:deleteDef')(id),
    workflowDbListRuns: (limit?: number) => invoke('workflow-db:listRuns')(limit),
    workflowDbUpsertRun: (run: unknown) => invoke('workflow-db:upsertRun')(run),
    workflowDbTrimRuns: (keep: number) => invoke('workflow-db:trimRuns')(keep),
    workflowDbDeleteRun: (id: string) => invoke('workflow-db:deleteRun')(id),
    workflowDbClearRuns: invoke('workflow-db:clearRuns'),
    workflowDbImportLegacy: (payload: unknown) => invoke('workflow-db:importLegacy')(payload),
    workflowDbGetPath: invoke<{ ok: boolean; path?: string }>('workflow-db:getPath'),
  }
}
