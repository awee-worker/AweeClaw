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

// Map of old path aliases to new ones based on actual directory structure
const ALIAS_MAP = {
  '@renderer/agent/tools/providers': '@intelligence/toolkit/providers',
  '@renderer/agent/types': '@intelligence/types',
  '@renderer/agent/store/AgentStore': '@intelligence/state/AgentStore',
  '@renderer/agent/store/ThreadPageManager': '@intelligence/state/ThreadPageManager',
  '@renderer/agent/store/InactiveThreadPersister': '@intelligence/state/InactiveThreadPersister',
  '@renderer/agent/harness/permissions/ToolPermissionManager': '@intelligence/harness/permissions/ToolPermissionManager',
  '@renderer/agent/harness/pipeline/builtins/rateLimit': '@intelligence/harness/pipeline/builtins/rateLimit',
  '@renderer/agent/harness/pipeline/builtins/errorBoundary': '@intelligence/harness/pipeline/builtins/errorBoundary',
  '@renderer/agent/harness/pipeline/builtins/audit': '@intelligence/harness/pipeline/builtins/audit',
  '@renderer/agent/harness/pipeline/Pipeline': '@intelligence/harness/pipeline/Pipeline',
  '@renderer/agent/harness/pipeline/Middleware': '@intelligence/harness/pipeline/Middleware',
  '@renderer/agent/tools/commandRuntime': '@intelligence/toolkit/commandRuntime',
  '@renderer/agent/tools': '@intelligence/toolkit',
  '@renderer/agent/prompts/PromptBuilder': '@intelligence/prompt-engine/PromptBuilder',
  '@renderer/agent/plugins/types': '@intelligence/plugins/types',
  '@renderer/agent/plugins/PluginRegistry': '@intelligence/plugins/PluginRegistry',
  '@renderer/agent/multiAgent/Orchestrator': '@intelligence/multiAgent/Orchestrator',
  '@renderer/agent/memory/ProjectKnowledgeGraph': '@intelligence/cognitive/ProjectKnowledgeGraph',
  '@renderer/agent/memory/LongTermMemory': '@intelligence/cognitive/LongTermMemory',
  '@renderer/agent/memory/AdaptivePromptEngine': '@intelligence/prompt-engine/AdaptivePromptEngine',
  '@renderer/agent/localModel/types': '@intelligence/localModel/types',
  '@renderer/agent/localModel/LocalModelDiscovery': '@intelligence/localModel/LocalModelDiscovery',
  '@renderer/agent/llm/ContextBuilder': '@intelligence/llm-layer/ContextBuilder',
  '@renderer/agent/domains/message/MessageAssembler': '@intelligence/engine/MessageAssembler',
  '@renderer/agent/domains/context/types': '@intelligence/context/types',
  '@renderer/agent/domains/context/summaryService': '@intelligence/context/summaryService',
  '@renderer/agent/domains/context/CompressionManager': '@intelligence/context/CompressionManager',
  '@renderer/agent/core/types': '@intelligence/types',
  '@renderer/agent/core/tools': '@intelligence/toolkit',
  '@renderer/agent/core/EventBus': '@intelligence/engine/EventBus',
  '@renderer/agent/utils/LoopDetector': '@intelligence/utils/LoopDetector',
  '@renderer/services/TerminalManager': '@services/TerminalManager',
  '@renderer/services/mcpService': '@services/mcpService',
  '@renderer/services/WorkspaceManager': '@services/WorkspaceManager',
  '@renderer/shell/runtime/shellRegistryService': '@services/shellRegistryService',
  '@renderer/hooks': '@hooks',
  '@main/security/secureTerminal': '@guard/secureTerminal',
  '@main/security/terminalInput': '@guard/terminalInput',
  '@main/services/llm/types': '@modules/ai-provider/types',
  '@main/services/llm/core/RequestCache': '@modules/ai-provider/core/RequestCache',
  '@main/services/llm/core/CacheCompatibility': '@modules/ai-provider/core/CacheCompatibility',
  '@shared/utils/tokenCounter': '@toolkit/tokenCounter',
  '@shared/utils/pathUtils': '@toolkit/pathUtils',
  '@shared/utils/errorHandler': '@toolkit/errorHandler',
  '@shared/types/workflow': '@protocols/workflow',
  '@shared/types/multiAgent': '@protocols/multiAgent',
  '@shared/types': '@protocols',
  '@shared/errors': '@shared/exceptions',
  '@intelligence/toolCallLeakFilter': '@intelligence/utils/toolCallLeakFilter',
  '@intelligence/fileChangeUtils': '@intelligence/utils/fileChangeUtils',
  '@intelligence/domains/context/types': '@intelligence/context/types',
  '@components/MentionPopup': '@components/intelligence/MentionPopup',
  '@/shared/utils/readFile': '@toolkit/readFile',
  '@/shared/utils/editFile': '@toolkit/editFile',
  '@/shared/types': '@protocols',
  '@/shared/config/tools': '@configuration/tools',
  '@/scenario-system/engine/ScenarioLoader': '@scenario-system/core/ScenarioLoader',
  '@/scenario-system/engine/ExternalScenarioLoader': '@scenario-system/core/ExternalScenarioLoader',
  '@/scenario-system/engine/DeclarativeScenarioModule': '@scenario-system/core/DeclarativeScenarioModule',
  '@/renderer/hooks': '@hooks',
  '@/renderer/components/chat': '@components/conversation',
  '@/renderer/agent': '@intelligence',
};

// Fix double-replaced paths
const DOUBLE_FIX = {
  '../config@configuration/agentConfig': '@configuration/agentConfig',
  '../@intelligence/utils/AgentConfig': '@intelligence/utils/AgentConfig',
  '.@protocols/workMode': '@protocols/workMode',
  '..//foundation/ConfirmDialog': '@components/foundation/ConfirmDialog',
  '..//foundation/ToastProvider': '@components/foundation/ToastProvider',
};

let totalFixed = 0;
const files = walkDir(SRC_DIR);

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Fix double-replaced paths first
  for (const [old, fix] of Object.entries(DOUBLE_FIX)) {
    if (content.includes(old)) {
      content = content.split(old).join(fix);
      modified = true;
    }
  }

  // Fix alias paths
  for (const [oldAlias, newAlias] of Object.entries(ALIAS_MAP)) {
    if (content.includes(oldAlias)) {
      content = content.split(oldAlias).join(newAlias);
      modified = true;
    }
  }

  // Fix /defaults -> @configuration/defaults
  if (content.includes("from '/defaults'")) {
    content = content.split("from '/defaults'").join("from '@configuration/defaults'");
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
