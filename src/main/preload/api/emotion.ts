/**
 * 表情包 API
 *
 * 覆盖 IPC 频道：
 * - emotion:get-emotion       获取单个表情包
 * - emotion:get-all-emotions  获取全部表情包
 * - emotion:add-emotion       添加表情包
 * - emotion:update-emotion    更新表情包
 * - emotion:delete-emotion    删除表情包
 * - emotion:import-file       从文件导入表情包
 */
import { invoke } from '../ipcHelpers'

export function createEmotionApi() {
  return {
    emotionGetEmotion: (params: { name: string }) => invoke('emotion:get-emotion')(params),
    emotionGetAllEmotions: invoke('emotion:get-all-emotions'),
    emotionAddEmotion: (params: unknown) => invoke('emotion:add-emotion')(params),
    emotionUpdateEmotion: (params: { name: string; updates: unknown }) =>
      invoke('emotion:update-emotion')(params),
    emotionDeleteEmotion: (params: { name: string }) => invoke('emotion:delete-emotion')(params),
    emotionImportFile: (params: { filePath: string; name?: string }) =>
      invoke('emotion:import-file')(params),
  }
}
