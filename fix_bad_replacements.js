const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const TESTS_DIR = path.join(__dirname, 'tests');

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

// Fix the @intelligence/index/xxx -> @intelligence/xxx issue
const BAD_FIXES = {
  '@intelligence/index/types': '@intelligence/types',
  '@intelligence/index/state/AgentStore': '@intelligence/state/AgentStore',
  '@intelligence/index/utils/AgentConfig': '@intelligence/utils/AgentConfig',
  '@intelligence/index/engine': '@intelligence/engine',
  '@intelligence/index/toolkit': '@intelligence/toolkit',
  '@intelligence/index/utils': '@intelligence/utils',
  '@intelligence/index/state': '@intelligence/state',
  '@intelligence/index/prompt-engine': '@intelligence/prompt-engine',
  '@intelligence/index/harness': '@intelligence/harness',
  '@intelligence/index/plugins': '@intelligence/plugins',
  '@intelligence/index/multiAgent': '@intelligence/multiAgent',
  '@intelligence/index/cognitive': '@intelligence/cognitive',
  '@intelligence/index/localModel': '@intelligence/localModel',
  '@intelligence/index/llm-layer': '@intelligence/llm-layer',
  '@intelligence/index/context': '@intelligence/context',
  '@intelligence/index/display': '@intelligence/display',
  '@intelligence/index/capabilities': '@intelligence/capabilities',
  '@intelligence/index/emotion': '@intelligence/emotion',
  '@intelligence/index/application': '@intelligence/application',
  '@intelligence/index/runtime': '@intelligence/runtime',
  '@intelligence/index/planner': '@intelligence/planner',
  '@intelligence/index/modes': '@intelligence/modes',
};

let totalFixed = 0;
const allFiles = [...walkDir(SRC_DIR), ...walkDir(TESTS_DIR)];

for (const filePath of allFiles) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const [bad, good] of Object.entries(BAD_FIXES)) {
    if (content.includes(bad)) {
      content = content.split(bad).join(good);
      modified = true;
    }
  }

  // Also fix standalone @intelligence/index that should be @intelligence
  // But only in from/import statements, not in comments
  const fromPattern = /from\s+['"]@intelligence\/index['"]/g;
  if (fromPattern.test(content)) {
    content = content.replace(/from\s+['"]@intelligence\/index['"]/g, "from '@intelligence'");
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
