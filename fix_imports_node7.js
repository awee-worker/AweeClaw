const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');

function walkDir(dir) {
  const results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git' && file !== 'example') {
        results.push(...walkDir(filePath));
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(filePath);
    }
  }
  return results;
}

// Build a map of all existing .ts/.tsx files (without extension) to their full paths
const allFiles = walkDir(SRC_DIR);
const fileMap = new Map();

for (const f of allFiles) {
  const rel = path.relative(SRC_DIR, f).replace(/\.tsx?$/, '');
  fileMap.set(rel, f);
  
  // Also add just the filename for lookup
  const basename = path.basename(f).replace(/\.tsx?$/, '');
  if (!fileMap.has(basename)) {
    fileMap.set(basename, f);
  }
}

// Map of relative module references that need to be resolved
// Format: { fromFilePattern: { oldImport: newImport } }
const RELATIVE_FIXES = {
  // renderer/intelligence files referencing old paths
  'renderer/intelligence/': {
    './engine': '@intelligence/engine',
    './languageMap': '@intelligence/utils/languageMap',
    './MentionParser': '@intelligence/utils/MentionParser',
    '../tools': '@intelligence/toolkit',
    '../fileChangeUtils': '@intelligence/utils/fileChangeUtils',
    '../engine/ToolConverter': '@intelligence/engine/ToolConverter',
    '../engine/MessageConverter': '@intelligence/engine/MessageConverter',
    '../common/Logo': '@components/brand-mascot/Logo',
    '../common/FileIcon': '@components/explorer/FileIcon',
    '../common/TextWithFileLinks': '@components/intelligence/TextWithFileLinks',
    '../common/LazyImage': '@components/intelligence/LazyImage',
    '../LoopDetector': '@intelligence/utils/LoopDetector',
    '../EditRetryStrategy': '@intelligence/toolkit/EditRetryStrategy',
    '../toolCallLeakFilter': '@intelligence/utils/toolCallLeakFilter',
    '../store': '@intelligence/state/AgentStore',
    '../chat/EmptyChatSuggestions': '@components/conversation/EmptyChatSuggestions',
    '../sidebar/panels/ExplorerView': '@components/explorer/ExplorerView',
    '../sidebar/PanelComponentRegistry': '@components/layout/PanelComponentRegistry',
  },
  'renderer/adapters/': {
    './runtime/updater': '@services/updater',
    './runtime/shellService': '@services/shellService',
    './runtime/shellRegistryService': '@services/shellRegistryService',
    './runtime/python': '@services/python',
    './runtime/electronAPI': '@services/electronAPI',
    './runtime/debugger': '@services/debugger',
    './runtime/channel': '@services/channel',
    './runtime/SyncService': '@services/SyncService',
    './runtime/StructuredService': '@services/StructuredService',
    './runtime/StreamingService': '@services/StreamingService',
    './runtime/EmbeddingService': '@services/EmbeddingService',
    './hooks': '@hooks',
    './foundation/ToastProvider': '@components/foundation/ToastProvider',
    './foundation/GlobalToastContainer': '@components/foundation/GlobalToastContainer',
    './foundation/GlobalErrorHandler': '@components/foundation/GlobalErrorHandler',
    './foundation/ErrorBoundary': '@components/foundation/ErrorBoundary',
    './foundation/ConfirmDialog': '@components/foundation/ConfirmDialog',
    './explorer/Sidebar': '@components/explorer/Sidebar',
    './domains/mode/ModeRegistry': '@intelligence/modes/ModeRegistry',
    './domains/mode/ModeDescriptor': '@intelligence/modes/ModeDescriptor',
    './domains/message': '@intelligence/engine/MessageAssembler',
    './domains/context': '@intelligence/context',
    './domains/budget': '@intelligence/llm-layer/budget',
    './components/welcome/WelcomePage': '@components/onboarding/WelcomePage',
    './components/panels/TerminalPanel': '@components/dock-panels/TerminalPanel',
    './components/panels/DebugPanel': '@components/dock-panels/DebugPanel',
    './components/dialogs/QuickOpen': '@components/modals/QuickOpen',
    './components/dialogs/OnboardingWizard': '@components/onboarding/OnboardingWizard',
    './components/dialogs/KeyboardShortcuts': '@components/modals/KeyboardShortcuts',
    './components/dialogs/CommandPalette': '@components/modals/CommandPalette',
    './components/dialogs/AboutDialog': '@components/modals/AboutDialog',
    './components/ChatPanel': '@components/conversation/ChatPanel',
    './code-editor/ThemeManager': '@components/code-editor/ThemeManager',
    './code-editor/Editor': '@components/code-editor/Editor',
    './ipc': '@bridge/ipcMain',
    './ipc/window': '@bridge/window',
    './ipc/updater': '@bridge/updater',
    './security': '@guard',
    './monacoTheme': '@components/code-editor/monacoTheme',
    './modules/window/ShutdownWindowController': '@modules/lifecycle/ShutdownWindowController',
    './modules/python': '@modules/python-runtime',
    './store': '@store',
    './tools': '@intelligence/toolkit',
  },
  'renderer/shell/': {
    '../runtime/shellService': '@services/shellService',
    '../runtime/shellRegistryService': '@services/shellRegistryService',
    '../runtime/remoteEditorService': '@services/remoteEditorService',
    '../runtime/llm/runtime/EmbeddingService': '@services/EmbeddingService',
    '../python': '@services/python',
    '../planner/TaskBoard': '@components/plan/TaskBoard',
    '../panels/ToolCallLogContent': '@components/intelligence/ToolCallLogContent',
    '../panels/PlanListContent': '@components/plan/PlanListContent',
    '../panels/NotificationCenterContent': '@components/intelligence/NotificationCenterContent',
    '../panels/ContextStatsContent': '@components/intelligence/ContextStatsContent',
    '../modules/llm': '@modules/ai-provider',
    '../indexing/astParser': '@services/astParser',
    '../indexing': '@services/indexing',
    '../foundation/ConfirmDialog': '@components/foundation/ConfirmDialog',
    '../engine/GenerationRecovery': '@intelligence/engine/GenerationRecovery',
    '../editor/FilePreview': '@components/code-editor/FilePreview',
    '../editor/DiffViewer': '@components/code-editor/DiffViewer',
    '../editor/DiffPreview': '@components/code-editor/DiffPreview',
    '../ai-provider/runtime/SyncService': '@services/SyncService',
  },
  'main/': {
    '../bridge/window': '@bridge/window',
  },
  'renderer/components/scenario/': {
    '../../types/scenario': '@protocols/scenario',
  },
  'scenarios/': {
    '../../scenario-system/core/ScenarioDatabaseManager': '@scenario-system/core/ScenarioDatabaseManager',
    './definitions': '../tools/definitions',
  },
  'shared/configuration/scenarios/': {
    '../../types/scenario': '@protocols/scenario',
  },
};

// Also fix remaining @-alias paths
const ALIAS_FIXES = {
  '@renderer/agent/tools/providers': '@intelligence/toolkit/providers',
  '@renderer/agent/types': '@intelligence/types',
  '@renderer/agent/store/AgentStore': '@intelligence/state/AgentStore',
  '@renderer/agent/store/ThreadPageManager': '@intelligence/state/ThreadPageManager',
  '@renderer/agent/store/InactiveThreadPersister': '@intelligence/state/InactiveThreadPersister',
  '@renderer/agent/harness/permissions/ToolPermissionManager': '@intelligence/harness/permissions/ToolPermissionManager',
  '@renderer/agent/tools/commandRuntime': '@intelligence/toolkit/commandRuntime',
  '@renderer/agent/tools': '@intelligence/toolkit',
  '@renderer/agent/utils/LoopDetector': '@intelligence/utils/LoopDetector',
  '@renderer/services/TerminalManager': '@services/TerminalManager',
  '@renderer/services/mcpService': '@services/mcpService',
  '@renderer/services/WorkspaceManager': '@services/WorkspaceManager',
  '@renderer/shell/runtime/shellRegistryService': '@services/shellRegistryService',
  '@renderer/hooks': '@hooks',
  '@main/security/secureTerminal': '@guard/secureTerminal',
  '@main/security/terminalInput': '@guard/terminalInput',
  '@shared/utils/tokenCounter': '@toolkit/tokenCounter',
  '@shared/utils/pathUtils': '@toolkit/pathUtils',
  '@shared/utils/errorHandler': '@toolkit/errorHandler',
  '@shared/types/workflow': '@protocols/workflow',
  '@shared/types/multiAgent': '@protocols/multiAgent',
  '@shared/types': '@protocols',
  '@shared/errors': '@shared/exceptions',
  '@services/shellRegistryService': '@services/shellRegistryService',
  '@scenario-system/core/ScenarioLoader': '@scenario-system/core/ScenarioLoader',
  '@scenario-system/core/ExternalScenarioLoader': '@scenario-system/core/ExternalScenarioLoader',
  '@scenario-system/core/DeclarativeScenarioModule': '@scenario-system/core/DeclarativeScenarioModule',
};

let totalFixed = 0;

for (const filePath of allFiles) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const relPath = path.relative(SRC_DIR, filePath);

  // Apply alias fixes
  for (const [oldAlias, newAlias] of Object.entries(ALIAS_FIXES)) {
    if (content.includes(oldAlias)) {
      content = content.split(oldAlias).join(newAlias);
      modified = true;
    }
  }

  // Apply relative path fixes based on file location
  for (const [locationPattern, fixes] of Object.entries(RELATIVE_FIXES)) {
    if (relPath.includes(locationPattern)) {
      for (const [oldImport, newImport] of Object.entries(fixes)) {
        // Match both from 'xxx' and from "xxx"
        const singleQuote = `from '${oldImport}'`;
        const doubleQuote = `from "${oldImport}"`;
        if (content.includes(singleQuote) || content.includes(doubleQuote)) {
          content = content.split(singleQuote).join(`from '${newImport}'`);
          content = content.split(doubleQuote).join(`from "${newImport}"`);
          modified = true;
        }
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
