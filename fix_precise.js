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

// Fix specific files that still have broken imports
const FIXES = {
  // renderer/intelligence/domains.ts - references ./languageMap
  'renderer/intelligence/domains.ts': [
    ["from './languageMap'", "from '../components/code-editor/utils/languageMap'"],
    ["from '../engine/ToolConverter'", "from './capabilities/message/ToolConverter'"],
    ["from '../engine/MessageConverter'", "from './capabilities/message/MessageConverter'"],
  ],
  // renderer/intelligence/index.ts
  'renderer/intelligence/index.ts': [
    ["from './languageMap'", "from '../components/code-editor/utils/languageMap'"],
  ],
  // renderer/intelligence/toolkit/executors.ts
  'renderer/intelligence/toolkit/executors.ts': [
    ["from '../engine/ToolConverter'", "from '../capabilities/message/ToolConverter'"],
    ["from '../engine/MessageConverter'", "from '../capabilities/message/MessageConverter'"],
  ],
  // renderer/shell/index.ts - references ./runtime/* and ./domains/*
  'renderer/shell/index.ts': [
    ["from './runtime/SyncService'", "from '../../main/modules/ai-provider/services/SyncService'"],
    ["from './runtime/StructuredService'", "from '../../main/modules/ai-provider/services/StructuredService'"],
    ["from './runtime/StreamingService'", "from '../../main/modules/ai-provider/services/StreamingService'"],
    ["from './runtime/EmbeddingService'", "from '../../main/modules/ai-provider/services/EmbeddingService'"],
    ["from './domains/mode/ModeRegistry'", "from '../intelligence/capabilities/mode/ModeRegistry'"],
    ["from './domains/mode/ModeDescriptor'", "from '../intelligence/capabilities/mode/ModeDescriptor'"],
    ["from './domains/message'", "from '../intelligence/capabilities/message'"],
    ["from './domains/context'", "from '../intelligence/context'"],
    ["from './domains/budget'", "from '../intelligence/llm-layer/budget'"],
    ["from './tools'", "from '../intelligence/toolkit'"],
    ["from './AgentConfig'", "from '../intelligence/utils/AgentConfig'"],
  ],
  // renderer/shell/components/RemoteFileBrowser.tsx
  'renderer/shell/components/RemoteFileBrowser.tsx': [
    ["from '../runtime/llm/runtime/EmbeddingService'", "from '../../../main/modules/ai-provider/services/EmbeddingService'"],
    ["from '../python'", "from '../../adapters/electronAPI'"],
    ["from '../planner/TaskBoard'", "from '../../components/plan/TaskBoard'"],
    ["from '../panels/ToolCallLogContent'", "from '../../components/dock-panels/ToolCallLogContent'"],
    ["from '../panels/PlanListContent'", "from '../../components/dock-panels/PlanListContent'"],
    ["from '../panels/NotificationCenterContent'", "from '../../components/dock-panels/NotificationCenterContent'"],
    ["from '../panels/ContextStatsContent'", "from '../../components/dock-panels/ContextStatsContent'"],
    ["from '../foundation/ConfirmDialog'", "from '../../components/foundation/ConfirmDialog'"],
    ["from '../engine/GenerationRecovery'", "from '../../intelligence/capabilities/message/GenerationRecovery'"],
    ["from '../editor/FilePreview'", "from '../../components/code-editor/FilePreview'"],
    ["from '../editor/DiffViewer'", "from '../../components/code-editor/DiffViewer'"],
    ["from '../editor/DiffPreview'", "from '../../components/code-editor/DiffPreview'"],
    ["from '../sidebar/panels/ExplorerView'", "from '../../components/explorer/panels/ExplorerView'"],
    ["from '../sidebar/PanelComponentRegistry'", "from '../../components/explorer/PanelComponentRegistry'"],
    ["from '../common/TextWithFileLinks'", "from '../../components/foundation/TextWithFileLinks'"],
    ["from '../common/LazyImage'", "from '../../components/foundation/LazyImage'"],
    ["from '../common/FileIcon'", "from '../../components/foundation/FileIcon'"],
    ["from '../chat/EmptyChatSuggestions'", "from '../../components/conversation/EmptyChatSuggestions'"],
    ["from '../ai-provider/runtime/SyncService'", "from '../../../main/modules/ai-provider/services/SyncService'"],
    ["from '../EditRetryStrategy'", "from '../../intelligence/utils/EditRetryStrategy'"],
  ],
  // renderer/shell/components/ShellManagerDialog.tsx
  'renderer/shell/components/ShellManagerDialog.tsx': [
    ["from '../common/FileIcon'", "from '../../components/foundation/FileIcon'"],
    ["from '../foundation/ConfirmDialog'", "from '../../components/foundation/ConfirmDialog'"],
  ],
  // renderer/shell/components/ShellMenu.tsx
  'renderer/shell/components/ShellMenu.tsx': [
    ["from '../common/FileIcon'", "from '../../components/foundation/FileIcon'"],
  ],
  // renderer/shell/components/ShellStudio.tsx
  'renderer/shell/components/ShellStudio.tsx': [
    ["from '../common/FileIcon'", "from '../../components/foundation/FileIcon'"],
    ["from '../foundation/ConfirmDialog'", "from '../../components/foundation/ConfirmDialog'"],
  ],
  // renderer/adapters/appShutdownService.ts
  'renderer/adapters/appShutdownService.ts': [
    ["from './runtime/SyncService'", "from '../../main/modules/ai-provider/services/SyncService'"],
    ["from './runtime/StructuredService'", "from '../../main/modules/ai-provider/services/StructuredService'"],
    ["from './runtime/StreamingService'", "from '../../main/modules/ai-provider/services/StreamingService'"],
    ["from './runtime/EmbeddingService'", "from '../../main/modules/ai-provider/services/EmbeddingService'"],
    ["from './domains/mode/ModeRegistry'", "from '../intelligence/capabilities/mode/ModeRegistry'"],
    ["from './domains/mode/ModeDescriptor'", "from '../intelligence/capabilities/mode/ModeDescriptor'"],
    ["from './domains/message'", "from '../intelligence/capabilities/message'"],
    ["from './domains/context'", "from '../intelligence/context'"],
    ["from './domains/budget'", "from '../intelligence/llm-layer/budget'"],
    ["from './tools'", "from '../intelligence/toolkit'"],
    ["from './AgentConfig'", "from '../intelligence/utils/AgentConfig'"],
  ],
  // renderer/adapters/initService.ts
  'renderer/adapters/initService.ts': [
    ["from './runtime/SyncService'", "from '../../main/modules/ai-provider/services/SyncService'"],
    ["from './runtime/StructuredService'", "from '../../main/modules/ai-provider/services/StructuredService'"],
    ["from './runtime/StreamingService'", "from '../../main/modules/ai-provider/services/StreamingService'"],
    ["from './runtime/EmbeddingService'", "from '../../main/modules/ai-provider/services/EmbeddingService'"],
    ["from './domains/mode/ModeRegistry'", "from '../intelligence/capabilities/mode/ModeRegistry'"],
    ["from './domains/mode/ModeDescriptor'", "from '../intelligence/capabilities/mode/ModeDescriptor'"],
    ["from './domains/message'", "from '../intelligence/capabilities/message'"],
    ["from './domains/context'", "from '../intelligence/context'"],
    ["from './domains/budget'", "from '../intelligence/llm-layer/budget'"],
    ["from './tools'", "from '../intelligence/toolkit'"],
    ["from './AgentConfig'", "from '../intelligence/utils/AgentConfig'"],
  ],
  // renderer/components/layout/StatusBar.tsx
  'renderer/components/layout/StatusBar.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
    ["from './monacoTheme'", "from '../code-editor/utils/monacoTheme'"],
  ],
  // renderer/components/intelligence/ChatPanel.tsx
  'renderer/components/intelligence/ChatPanel.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
  ],
  // renderer/components/intelligence/ChatMessage.tsx
  'renderer/components/intelligence/ChatMessage.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
  ],
  // renderer/components/intelligence/RichContentRenderer.tsx
  'renderer/components/intelligence/RichContentRenderer.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
  ],
  // renderer/components/intelligence/ToolCallCard.tsx
  'renderer/components/intelligence/ToolCallCard.tsx': [
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
  ],
  // renderer/components/intelligence/ChangesReviewPanel.tsx
  'renderer/components/intelligence/ChangesReviewPanel.tsx': [
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
  ],
  // renderer/components/modals/AboutDialog.tsx
  'renderer/components/modals/AboutDialog.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
  ],
  // renderer/components/modals/OnboardingWizard.tsx
  'renderer/components/modals/OnboardingWizard.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
  ],
  // renderer/components/modals/QuickOpen.tsx
  'renderer/components/modals/QuickOpen.tsx': [
    ["from '../common/Logo'", "from '../foundation/Logo'"],
  ],
  // renderer/components/dock-panels/ComposerPanel.tsx
  'renderer/components/dock-panels/ComposerPanel.tsx': [
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
  ],
  // renderer/components/file-tree/VirtualFileTree.tsx
  'renderer/components/file-tree/VirtualFileTree.tsx': [
    ["from '../common/FileIcon'", "from '../foundation/FileIcon'"],
  ],
  // renderer/components/code-editor/Editor.tsx
  'renderer/components/code-editor/Editor.tsx': [
    ["from './useEditorActions'", "from '../../hooks/useFileSave'"],
  ],
  // renderer/components/code-editor/DiffPreview.tsx
  'renderer/components/code-editor/DiffPreview.tsx': [
    ["from './useEditorActions'", "from '../../hooks/useFileSave'"],
  ],
  // renderer/components/code-editor/DiffViewer.tsx
  'renderer/components/code-editor/DiffViewer.tsx': [
    ["from './useEditorActions'", "from '../../hooks/useFileSave'"],
  ],
  // renderer/components/code-editor/SafeDiffEditor.tsx
  'renderer/components/code-editor/SafeDiffEditor.tsx': [
    ["from './useEditorActions'", "from '../../hooks/useFileSave'"],
  ],
  // renderer/components/explorer/panels/HistoryView.tsx
  'renderer/components/explorer/panels/HistoryView.tsx': [
    ["from '../../tree/VirtualFileTree'", "from '../../file-tree/VirtualFileTree'"],
  ],
  // renderer/components/scenario/panelUtils.ts
  'renderer/components/scenario/panelUtils.ts': [
    ["from '../../types/scenario'", "from '../../../shared/protocols/scenario'"],
  ],
  // renderer/toolkit/fileUtils.ts
  'renderer/toolkit/fileUtils.ts': [
    ["from '../../smartReplace'", "from './smartReplace'"],
    ["from '../../python'", "from '../adapters/electronAPI'"],
    ["from '../../panels/CheckpointPanel'", "from '../components/dock-panels/CheckpointPanel'"],
  ],
  // renderer/App.tsx
  'renderer/App.tsx': [
    ["from '@services/electronAPI'", "from './adapters/electronAPI'"],
    ["from '@intelligence/runtime/ShellComposer'", "from './shell/ShellComposer'"],
    ["from '@intelligence/runtime/ShellStudio'", "from './shell/components/ShellStudio'"],
    ["from '@services/shellRegistryService'", "from './shell/services/shellRegistryService'"],
    ["from '@services/shellService'", "from './shell/services/shellService'"],
    ["from '@services/remoteEditorService'", "from './shell/services/remoteEditorService'"],
    ["from '@services/ShellStudio'", "from './shell/components/ShellStudio'"],
    ["from '@services/ShellComposer'", "from './shell/ShellComposer'"],
    ["from '@components/brand-mascot'", "from './components/brand-mascot'"],
    ["from '@components/explorer'", "from './components/explorer'"],
    ["from '@components/conversation'", "from './components/conversation'"],
    ["from '@components/onboarding'", "from './components/onboarding'"],
  ],
  // main/bridge/indexing.ts
  'main/bridge/indexing.ts': [
    ["from '@search-engine'", "from '../search-engine'"],
    ["from '@search-engine/search/astParser'", "from '../search-engine/search/astParser'"],
  ],
  // main/main.ts - remaining fixes
  'main/main.ts': [
    ["from './bridge/ipcMain'", "from './bridge'"],
    ["from './bridge/updater'", "from './modules/auto-update'"],
  ],
  // main/bridge/llm.ts
  'main/bridge/llm.ts': [
    ["from './monacoTheme'", "from '../../renderer/components/code-editor/utils/monacoTheme'"],
  ],
  // main/guard/secureTerminal.ts
  'main/guard/secureTerminal.ts': [
    ["from './bridge/ipcMain'", "from '../bridge'"],
  ],
  // main/language-server/lspManager.ts
  'main/language-server/lspManager.ts': [
    ["from './bridge/ipcMain'", "from '../bridge'"],
  ],
  // main/modules/ai-provider/LLMService.ts
  'main/modules/ai-provider/LLMService.ts': [
    ["from '../bridge/window'", "from '../../bridge/window'"],
  ],
  // main/modules/ai-provider/services/StreamingService.ts
  'main/modules/ai-provider/services/StreamingService.ts': [
    ["from '../bridge/window'", "from '../../../bridge/window'"],
  ],
  // main/modules/ai-provider/services/SyncService.ts
  'main/modules/ai-provider/services/SyncService.ts': [
    ["from '../bridge/window'", "from '../../../bridge/window'"],
  ],
  // main/modules/dap-adapter/adapters/index.ts
  'main/modules/dap-adapter/adapters/index.ts': [
    ["from '../bridge/window'", "from '../../../bridge/window'"],
  ],
  // main/modules/messaging/ChannelBridge.ts
  'main/modules/messaging/ChannelBridge.ts': [
    ["from '../bridge/window'", "from '../../bridge/window'"],
  ],
  // main/modules/tool-protocol/McpClient.ts
  'main/modules/tool-protocol/McpClient.ts': [
    ["from '../bridge/window'", "from '../../bridge/window'"],
  ],
};

// Also fix all files that reference @services/shellRegistryService etc.
const UNIVERSAL_FIXES = {
  '@services/shellRegistryService': './shell/services/shellRegistryService',
  '@services/shellService': './shell/services/shellService',
  '@services/remoteEditorService': './shell/services/remoteEditorService',
  '@services/ShellStudio': './shell/components/ShellStudio',
  '@services/ShellComposer': './shell/ShellComposer',
  '@services/electronAPI': './adapters/electronAPI',
  '@components/brand-mascot': './components/brand-mascot',
  '@components/explorer': './components/explorer',
  '@components/conversation': './components/conversation',
  '@components/onboarding': './components/onboarding',
  '@intelligence/prompt-engine': './intelligence/prompt-engine',
  '@intelligence': './intelligence',
  '@search-engine': '../search-engine',
};

let totalFixed = 0;
const allFiles = walkDir(SRC_DIR);

for (const filePath of allFiles) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const relPath = path.relative(SRC_DIR, filePath);

  // Apply file-specific fixes
  if (FIXES[relPath]) {
    for (const [oldRef, newRef] of FIXES[relPath]) {
      if (content.includes(oldRef)) {
        content = content.split(oldRef).join(newRef);
        modified = true;
      }
    }
  }

  // Apply universal fixes only to renderer/ files
  if (relPath.startsWith('renderer/')) {
    for (const [oldRef, newRef] of Object.entries(UNIVERSAL_FIXES)) {
      // Only replace if it's an import path (not part of a longer path)
      const regex = new RegExp(`from '${oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g');
      if (regex.test(content)) {
        content = content.replace(regex, `from '${newRef}'`);
        modified = true;
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
