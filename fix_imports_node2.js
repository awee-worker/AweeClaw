const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');

const DOUBLE_REPLACE_FIXES = [
  ['@shared/configuration@configuration/', '@configuration/'],
  ['@shared/protocols@protocols/', '@protocols/'],
  ['@protocols@protocols/', '@protocols/'],
  ['@configuration@configuration/', '@configuration/'],
  ['@toolkit@toolkit/', '@toolkit/'],
  ['.@configuration/', '@configuration/'],
];

const REMAINING_FIXES = [
  ['@renderer/agent/tools/providers', '@intelligence/toolkit/providers'],
  ['@renderer/agent/types', '@intelligence/types'],
  ['@renderer/agent/store/AgentStore', '@intelligence/state/AgentStore'],
  ['@renderer/agent/harness/permissions/ToolPermissionManager', '@intelligence/harness/permissions/ToolPermissionManager'],
  ['@renderer/services/TerminalManager', '@services/TerminalManager'],
  ['@renderer/hooks', '@hooks'],
  ['@main/security/secureTerminal', '@guard/secureTerminal'],
  ['@shared/types/workflow', '@protocols/workflow'],
  ['@shared/types', '@protocols'],
  ['@scenario-system/engine/ScenarioDatabaseManager', '../../scenario-system/engine/ScenarioDatabaseManager'],
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

  for (const [oldPath, newPath] of DOUBLE_REPLACE_FIXES) {
    if (content.includes(oldPath)) {
      content = content.split(oldPath).join(newPath);
      modified = true;
    }
  }

  for (const [oldPath, newPath] of REMAINING_FIXES) {
    if (content.includes(oldPath)) {
      content = content.split(oldPath).join(newPath);
      modified = true;
    }
  }

  if (content.includes("from ''")) {
    const relPath = path.relative(SRC_DIR, filePath);
    if (relPath.includes('scenarios/') || relPath.includes('scenario-system/')) {
      content = content.split("from ''").join("from '@scenario-system/types'");
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
