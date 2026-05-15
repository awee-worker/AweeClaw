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

// Map of all old-style references to their correct alias paths
// These are references that exist in source files but point to non-existent paths
const UNIVERSAL_FIXES = {
  // @services/* -> these files are in renderer/shell/services/ or renderer/adapters/
  '@services/shellRegistryService': '@intelligence/runtime/shellRegistryService',
  '@services/shellService': '@intelligence/runtime/shellService',
  '@services/remoteEditorService': '@intelligence/runtime/remoteEditorService',
  
  // @intelligence/* paths that don't exist
  '@intelligence/context/types': '@intelligence/types',
  '@intelligence/prompt-engine/AdaptivePromptEngine': '@intelligence/prompt-engine/index',
  '@intelligence/engine/MessageAssembler': '@intelligence/engine/index',
  '@intelligence/context/summaryService': '@intelligence/context/index',
  '@intelligence/context/CompressionManager': '@intelligence/context/index',
  '@intelligence': '@intelligence/index',
  
  // @hooks/useEditorActions doesn't exist
  '@hooks/useEditorActions': '@hooks/useFileSave',
  
  // @search-engine
  '@search-engine/search/treeSitterChunker': '@search-engine/search/index',
  
  // Relative paths that need fixing
  '../../scenario-system/core/ScenarioDatabaseManager': '@scenario-system/core/ScenarioDatabaseManager',
  '../tools/definitions': './tools/definitions',
};

// File-specific fixes for relative paths
const FILE_FIXES = {
  // renderer/intelligence/domains.ts references ./engine, ./languageMap
  'renderer/intelligence/domains.ts': {
    "from './engine'": "from '@intelligence/engine'",
    "from './languageMap'": "from '@intelligence/utils/languageMap'",
  },
  'renderer/intelligence/index.ts': {
    "from './engine'": "from '@intelligence/engine'",
    "from './languageMap'": "from '@intelligence/utils/languageMap'",
  },
  'renderer/intelligence/toolkit/executors.ts': {
    "from './engine'": "from '@intelligence/engine'",
  },
  // main/bridge/ files
  'main/bridge/indexing.ts': {
    "from './security'": "from '@guard'",
    "from './ipc/window'": "from '@bridge/window'",
  },
  'main/bridge/llm.ts': {
    "from './security'": "from '@guard'",
    "from './ipc/window'": "from '@bridge/window'",
    "from './monacoTheme'": "from '@components/code-editor/monacoTheme'",
  },
  'main/guard/secureTerminal.ts': {
    "from './ipc/window'": "from '@bridge/window'",
    "from './security'": "from '@guard'",
  },
  'main/main.ts': {
    "from './ipc/window'": "from '@bridge/window'",
    "from './security'": "from '@guard'",
    "from './modules/python'": "from '@modules/python-runtime'",
  },
  'main/language-server/lspManager.ts': {
    "from './ipc/window'": "from '@bridge/window'",
  },
  'main/modules/ai-provider/LLMService.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  'main/modules/ai-provider/services/StreamingService.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  'main/modules/ai-provider/services/SyncService.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  'main/modules/dap-adapter/adapters/index.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  'main/modules/messaging/ChannelBridge.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  'main/modules/tool-protocol/McpClient.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  'main/search-engine/embedder.ts': {
    "from '../bridge/window'": "from '@bridge/window'",
  },
  // renderer/components/code-editor/ files
  'renderer/components/code-editor/DiffPreview.tsx': {
    "from './useEditorActions'": "from '@hooks/useFileSave'",
  },
  'renderer/components/code-editor/DiffViewer.tsx': {
    "from './useEditorActions'": "from '@hooks/useFileSave'",
  },
  'renderer/components/code-editor/Editor.tsx': {
    "from './useEditorActions'": "from '@hooks/useFileSave'",
  },
  'renderer/components/code-editor/EditorContextMenu.tsx': {
    "from './useEditorActions'": "from '@hooks/useFileSave'",
  },
  'renderer/components/code-editor/SafeDiffEditor.tsx': {
    "from './useEditorActions'": "from '@hooks/useFileSave'",
  },
  // renderer/components/explorer/
  'renderer/components/explorer/panels/ExplorerView.tsx': {
    "from '../../tree/VirtualFileTree'": "from '@components/file-tree/VirtualFileTree'",
  },
  // renderer/toolkit/
  'renderer/toolkit/fileUtils.ts': {
    "from '../../smartReplace'": "from '@utils/smartReplace'",
    "from '../../python'": "from '@services/python'",
  },
  // renderer/App.tsx
  'renderer/App.tsx': {
    "from './hooks'": "from '@hooks'",
    "from './store'": "from '@store'",
    "from './tools'": "from '@intelligence/toolkit'",
  },
  // renderer/components/scenario/panelUtils.ts
  'renderer/components/scenario/panelUtils.ts': {
    "from '../../types/scenario'": "from '@protocols/scenario'",
  },
  // renderer/components/intelligence/ files
  'renderer/components/intelligence/ChatPanel.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  'renderer/components/intelligence/ChatMessage.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  'renderer/components/intelligence/RichContentRenderer.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
  },
  'renderer/components/intelligence/ToolCallCard.tsx': {
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  'renderer/components/intelligence/ChangesReviewPanel.tsx': {
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  // renderer/components/layout/StatusBar.tsx
  'renderer/components/layout/StatusBar.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
  },
  // renderer/components/modals/
  'renderer/components/modals/AboutDialog.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
  },
  'renderer/components/modals/OnboardingWizard.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
  },
  'renderer/components/modals/QuickOpen.tsx': {
    "from '../common/Logo'": "from '@components/brand-mascot/Logo'",
  },
  // renderer/components/dock-panels/
  'renderer/components/dock-panels/ComposerPanel.tsx': {
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  'renderer/components/dock-panels/ContextStatsContent.tsx': {
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  // renderer/components/explorer/panels/HistoryView.tsx
  'renderer/components/explorer/panels/HistoryView.tsx': {
    "from '../../tree/VirtualFileTree'": "from '@components/file-tree/VirtualFileTree'",
  },
  // renderer/components/file-tree/
  'renderer/components/file-tree/VirtualFileTree.tsx': {
    "from '../common/FileIcon'": "from '@components/explorer/FileIcon'",
  },
  // scenario-system/index.ts
  'scenario-system/index.ts': {
    "from './engine'": "from './core'",
  },
  // scenarios/store-diagnosis/components/ files
  'scenarios/store-diagnosis/components/StoreManagePanel.tsx': {
    "from '../tools/definitions'": "from '../tools/definitions'",
  },
  'scenarios/store-diagnosis/components/StoreDataEntryPanel.tsx': {
    "from '../tools/definitions'": "from '../tools/definitions'",
  },
  'scenarios/store-diagnosis/components/OptimizationPlansPanel.tsx': {
    "from '../tools/definitions'": "from '../tools/definitions'",
  },
  'scenarios/store-diagnosis/components/CompetitorPanel.tsx': {
    "from '../tools/definitions'": "from '../tools/definitions'",
  },
  'scenarios/store-diagnosis/components/DiagnosisRecordsPanel.tsx': {
    "from '../tools/definitions'": "from '../tools/definitions'",
  },
  'scenarios/store-diagnosis/components/IndustryBenchmarkPanel.tsx': {
    "from '../tools/definitions'": "from '../tools/definitions'",
  },
};

let totalFixed = 0;
const files = walkDir(SRC_DIR);

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const relPath = path.relative(SRC_DIR, filePath);

  // Apply universal fixes
  for (const [oldRef, newRef] of Object.entries(UNIVERSAL_FIXES)) {
    if (content.includes(oldRef)) {
      content = content.split(oldRef).join(newRef);
      modified = true;
    }
  }

  // Apply file-specific fixes
  for (const [filePattern, fixes] of Object.entries(FILE_FIXES)) {
    if (relPath === filePattern || relPath.startsWith(filePattern)) {
      for (const [oldImport, newImport] of Object.entries(fixes)) {
        if (content.includes(oldImport)) {
          content = content.split(oldImport).join(newImport);
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
