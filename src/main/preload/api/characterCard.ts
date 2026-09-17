/**
 * 角色卡 API
 *
 * 覆盖 IPC 频道：
 * - character-card:import-card              导入角色卡
 * - character-card:export-card              导出角色卡
 * - character-card:export-card-with-assets  导出角色卡及资产
 * - character-card:get-card                 获取单张角色卡
 * - character-card:get-all-cards            获取全部角色卡
 * - character-card:query-cards              条件查询角色卡
 * - character-card:update-card              更新角色卡
 * - character-card:delete-card              删除角色卡
 * - character-card:get-storage-stats        存储统计
 * - character-card:backup-card              备份角色卡
 * - character-card:restore-card             恢复角色卡
 * - character-card:validate-card            校验角色卡
 * - character-card:check-card-exists        判断角色卡是否存在
 * - character-card:generate-id              生成角色卡 ID
 */
import { invoke } from '../ipcHelpers'

export function createCharacterCardApi() {
  return {
    characterCardImportCard: (params: { filePath: string; config?: unknown }) =>
      invoke('character-card:import-card')(params),
    characterCardExportCard: (params: { cardId: string; options: unknown }) =>
      invoke('character-card:export-card')(params),
    characterCardExportCardWithAssets: (params: { cardId: string; outputPath?: string }) =>
      invoke('character-card:export-card-with-assets')(params),
    characterCardGetCard: (params: { cardId: string }) =>
      invoke('character-card:get-card')(params),
    characterCardGetAllCards: invoke('character-card:get-all-cards'),
    characterCardQueryCards: (params: unknown) => invoke('character-card:query-cards')(params),
    characterCardUpdateCard: (params: unknown) => invoke('character-card:update-card')(params),
    characterCardDeleteCard: (params: { cardId: string }) =>
      invoke('character-card:delete-card')(params),
    characterCardGetStorageStats: invoke('character-card:get-storage-stats'),
    characterCardBackupCard: (params: { cardId: string }) =>
      invoke('character-card:backup-card')(params),
    characterCardRestoreCard: (params: { backupPath: string }) =>
      invoke('character-card:restore-card')(params),
    characterCardValidateCard: (params: { cardId: string }) =>
      invoke('character-card:validate-card')(params),
    characterCardCheckCardExists: (params: { cardId: string }) =>
      invoke('character-card:check-card-exists')(params),
    characterCardGenerateId: invoke('character-card:generate-id'),
  }
}
