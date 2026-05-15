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

// Comprehensive mapping of old relative paths to new alias-based paths
// Grouped by source file location
const FILE_SPECIFIC_FIXES = {
  // renderer/shell/index.ts - references old structure
  'renderer/shell/index.ts': {
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
    './runtime/updater': '@services/updater',
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
    './AgentConfig': '@intelligence/utils/AgentConfig',
  },
  // renderer/shell/components/ files
  'renderer/shell/components/': {
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
    '../sidebar/panels/ExplorerView': '@components/explorer/ExplorerView',
    '../sidebar/PanelComponentRegistry': '@components/layout/PanelComponentRegistry',
    '../common/Logo': '@components/brand-mascot/Logo',
    '../common/FileIcon': '@components/explorer/FileIcon',
    '../common/TextWithFileLinks': '@components/intelligence/TextWithFileLinks',
    '../common/LazyImage': '@components/intelligence/LazyImage',
    '../chat/EmptyChatSuggestions': '@components/conversation/EmptyChatSuggestions',
    '../store': '@store',
    '../EditRetryStrategy': '@intelligence/toolkit/EditRetryStrategy',
  },
  // renderer/adapters/ files
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
    './AgentConfig': '@intelligence/utils/AgentConfig',
  },
  // renderer/intelligence/ files
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
    '../modules/python': '@modules/python-runtime',
    '../bridge/window': '@bridge/window',
  },
  // main/ files
  'main/': {
    '../bridge/window': '@bridge/window',
    './security': '@guard',
    './ipc/window': '@bridge/window',
  },
  // renderer/components/ files
  'renderer/components/scenario/': {
    '../../types/scenario': '@protocols/scenario',
  },
  // renderer/App.tsx
  'renderer/App.tsx': {
    './hooks': '@hooks',
    './store': '@store',
    './tools': '@intelligence/toolkit',
  },
  // scenarios/ files
  'scenarios/store-diagnosis/': {
    '../../scenario-system/core/ScenarioDatabaseManager': '@scenario-system/core/ScenarioDatabaseManager',
    '../tools/definitions': './tools/definitions',
  },
  'scenarios/': {
    '../../scenario-system/core/ScenarioDatabaseManager': '@scenario-system/core/ScenarioDatabaseManager',
  },
  // shared/configuration/scenarios/
  'shared/configuration/scenarios/': {
    '../../types/scenario': '@protocols/scenario',
  },
  // renderer/components/code-editor/
  'renderer/components/code-editor/': {
    './useEditorActions': '@hooks/useEditorActions',
  },
  // renderer/components/explorer/
  'renderer/components/explorer/': {
    '../../tree/VirtualFileTree': '@components/file-tree/VirtualFileTree',
  },
  // renderer/toolkit/
  'renderer/toolkit/': {
    '../../smartReplace': '@utils/smartReplace',
    '../../python': '@services/python',
    '../../panels/CheckpointPanel': '@components/intelligence/CheckpointPanel',
  },
};

// Also fix remaining @-alias paths that don't resolve
const ALIAS_FIXES = {
  '@services/shellRegistryService': '@services/shellRegistryService',
  '@services/shellService': '@services/shellService',
  '@services/remoteEditorService': '@services/remoteEditorService',
  '@intelligence/context/types': '@intelligence/context/types',
  '@intelligence/prompt-engine/AdaptivePromptEngine': '@intelligence/prompt-engine/AdaptivePromptEngine',
  '@intelligence/engine/MessageAssembler': '@intelligence/engine/MessageAssembler',
  '@intelligence/context/summaryService': '@intelligence/context/summaryService',
  '@intelligence/context/CompressionManager': '@intelligence/context/CompressionManager',
  '@intelligence': '@intelligence/index',
  '@search-engine/search/treeSitterChunker': '@search-engine/search/treeSitterChunker',
};

let totalFixed = 0;
const files = walkDir(SRC_DIR);

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const relPath = path.relative(SRC_DIR, filePath);

  // Apply file-specific fixes
  for (const [locationPattern, fixes] of Object.entries(FILE_SPECIFIC_FIXES)) {
    if (relPath.startsWith(locationPattern) || relPath === locationPattern.replace(/\/$/, '')) {
      for (const [oldImport, newImport] of Object.entries(fixes)) {
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
