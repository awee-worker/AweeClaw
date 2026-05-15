export { FileServiceAdapter } from './FileServiceAdapter'
export { LintServiceAdapter } from './LintServiceAdapter'
export { MemoryServiceAdapter } from './MemoryServiceAdapter'
export { SkillServiceAdapter } from './SkillServiceAdapter'
export { FileCacheServiceAdapter } from './FileCacheServiceAdapter'
export { EventBusAdapter } from './EventBusAdapter'
export { AgentStoreAdapter } from './AgentStoreAdapter'
export { GlobalStoreAdapter } from './GlobalStoreAdapter'
export { ElectronAPIAdapter } from './ElectronAPIAdapter'

import { agentHarness } from '../Harness'
import { FileServiceAdapter } from './FileServiceAdapter'
import { LintServiceAdapter } from './LintServiceAdapter'
import { MemoryServiceAdapter } from './MemoryServiceAdapter'
import { SkillServiceAdapter } from './SkillServiceAdapter'
import { FileCacheServiceAdapter } from './FileCacheServiceAdapter'
import { EventBusAdapter } from './EventBusAdapter'
import { AgentStoreAdapter } from './AgentStoreAdapter'
import { GlobalStoreAdapter } from './GlobalStoreAdapter'
import { ElectronAPIAdapter } from './ElectronAPIAdapter'

export async function initializeHarness(workspacePath: string): Promise<void> {
  await agentHarness.initialize({
    fileService: new FileServiceAdapter(),
    lintService: new LintServiceAdapter(),
    memoryService: new MemoryServiceAdapter(),
    skillService: new SkillServiceAdapter(),
    fileCacheService: new FileCacheServiceAdapter(),
    eventBus: new EventBusAdapter(),
    agentStore: new AgentStoreAdapter(),
    globalStore: new GlobalStoreAdapter(),
    electronAPI: new ElectronAPIAdapter(),
    workspacePath,
  })
}
