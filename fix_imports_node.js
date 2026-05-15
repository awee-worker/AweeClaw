const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');

const REPLACEMENTS = [
  ['@intelligence/AgentConfig', '@intelligence/utils/AgentConfig'],
  ['../AgentConfig', '@intelligence/utils/AgentConfig'],
  ['@renderer/agent/tools/providers', '@intelligence/toolkit/providers'],
  ['@renderer/agent/types', '@intelligence/types'],
  ['@renderer/agent/store/AgentStore', '@intelligence/state/AgentStore'],
  ['@renderer/agent/harness/permissions/ToolPermissionManager', '@intelligence/harness/permissions/ToolPermissionManager'],
  ['@renderer/hooks', '@hooks'],
  ['@renderer/services/TerminalManager', '@services/TerminalManager'],
  ['@main/security/secureTerminal', '@guard/secureTerminal'],
  ['@intelligence/presentation/toolDisplay', '@intelligence/display/toolDisplay'],
  ['@intelligence/MentionParser', '@intelligence/utils/MentionParser'],
  ['../agentText', '@intelligence/utils/agentText'],
  ['..//foundation/ToastProvider', '@components/foundation/ToastProvider'],
  ['../../foundation/ToastProvider', '@components/foundation/ToastProvider'],
  ['../engine/RequestExecution', '@modules/ai-provider/core/RequestExecution'],
  ['@shared/utils', '@toolkit'],
  ['@shared/types/workflow', '@protocols/workflow'],
  ['@shared/types', '@protocols'],
  ['@/shared/types', '@protocols'],
  ['@/scenario-system/engine/ScenarioDatabaseManager', '@scenario-system/engine/ScenarioDatabaseManager'],
  ['../../scenarioBrandIdentity', '../scenarioBrandIdentity'],
  ['/llmPersistence', '@configuration/llmPersistence'],
  ['/agentConfig', '@configuration/agentConfig'],
  ['/workMode', '@protocols/workMode'],
  ['./toolkit/definitions', './definitions'],
  ['./languageMap', './languageMap'],
  ['./engine', './engine'],
  ['./security', './security'],
  ['./monacoTheme', './monacoTheme'],
  ['./ipc/window', '../bridge/window'],
];

const EMPTY_IMPORT_REPLACEMENTS = [
  {
    context: 'scenarios/',
    replacement: '@scenario-system/types'
  },
  {
    context: 'scenario-system/',
    replacement: '@scenario-system/types'
  }
];

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

let totalFixed = 0;

const files = walkDir(SRC_DIR);
for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const [oldPath, newPath] of REPLACEMENTS) {
    if (content.includes(oldPath)) {
      content = content.split(oldPath).join(newPath);
      modified = true;
    }
  }

  if (content.includes("from ''")) {
    for (const { context, replacement } of EMPTY_IMPORT_REPLACEMENTS) {
      if (filePath.includes(context)) {
        content = content.split("from ''").join(`from '${replacement}'`);
        modified = true;
        break;
      }
    }
  }

  if (content.includes("from '/")) {
    content = content.replace(/from '\/llm'/g, "from '@protocols/llm'");
    content = content.replace(/from '\/tools'/g, "from '@configuration/tools'");
    content = content.replace(/from '\/toolGroups'/g, "from '@configuration/toolGroups'");
    content = content.replace(/from '\/workMode'/g, "from '@protocols/workMode'");
    content = content.replace(/from '\/providers'/g, "from '@configuration/providers'");
    content = content.replace(/from '\/foundation\//g, "from '@components/foundation/");
    content = content.replace(/from '\/exceptions'/g, "from '@shared/exceptions'");
    content = content.replace(/from '\/editFile'/g, "from '@toolkit/editFile'");
    content = content.replace(/from '\/readFile'/g, "from '@toolkit/readFile'");
    content = content.replace(/from '\/llmPersistence'/g, "from '@configuration/llmPersistence'");
    content = content.replace(/from '\/agentConfig'/g, "from '@configuration/agentConfig'");
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
