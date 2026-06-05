import { loadWorkflowDefinitions } from './workflowPersistenceV2';
import { workflowClientAPI } from './workflowClientAPI';
import { StorageService } from '@shared/toolkit/StorageService';

const MIGRATION_FLAG_KEY = 'workflow_migration_done_v1';

export async function migrateLocalWorkflowsToServer(): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  alreadyMigrated: boolean;
}> {
  const alreadyMigrated = StorageService.get<string>(MIGRATION_FLAG_KEY) === 'true';

  if (alreadyMigrated) {
    return { imported: 0, skipped: 0, errors: [], alreadyMigrated: true };
  }

  if (!workflowClientAPI.isAvailable()) {
    return { imported: 0, skipped: 0, errors: ['Not authenticated'], alreadyMigrated: false };
  }

  const localDefs = loadWorkflowDefinitions();
  if (localDefs.length === 0) {
    StorageService.set(MIGRATION_FLAG_KEY, 'true');
    return { imported: 0, skipped: 0, errors: [], alreadyMigrated: false };
  }

  try {
    const result = await workflowClientAPI.batchSync(localDefs);

    if (result.errors.length === 0) {
      StorageService.set(MIGRATION_FLAG_KEY, 'true');
    }

    return { ...result, alreadyMigrated: false };
  } catch (err) {
    return {
      imported: 0,
      skipped: 0,
      errors: [(err as Error).message || 'Migration failed'],
      alreadyMigrated: false,
    };
  }
}

export function resetMigrationFlag(): void {
  StorageService.remove(MIGRATION_FLAG_KEY);
}

export function isMigrationDone(): boolean {
  return StorageService.get<string>(MIGRATION_FLAG_KEY) === 'true';
}
