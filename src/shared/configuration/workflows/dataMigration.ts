import { loadWorkflowDefinitions } from './workflowPersistenceV2';
import { workflowClientAPI } from './workflowClientAPI';

const MIGRATION_FLAG_KEY = 'aweeclaw_workflow_migration_done_v1';

export async function migrateLocalWorkflowsToServer(): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  alreadyMigrated: boolean;
}> {
  const alreadyMigrated = localStorage.getItem(MIGRATION_FLAG_KEY) === 'true';

  if (alreadyMigrated) {
    return { imported: 0, skipped: 0, errors: [], alreadyMigrated: true };
  }

  if (!workflowClientAPI.isAvailable()) {
    return { imported: 0, skipped: 0, errors: ['Not authenticated'], alreadyMigrated: false };
  }

  const localDefs = loadWorkflowDefinitions();
  if (localDefs.length === 0) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
    return { imported: 0, skipped: 0, errors: [], alreadyMigrated: false };
  }

  try {
    const result = await workflowClientAPI.batchSync(localDefs);

    if (result.errors.length === 0) {
      localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
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
  localStorage.removeItem(MIGRATION_FLAG_KEY);
}

export function isMigrationDone(): boolean {
  return localStorage.getItem(MIGRATION_FLAG_KEY) === 'true';
}