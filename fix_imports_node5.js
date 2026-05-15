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

let totalFixed = 0;
const files = walkDir(SRC_DIR);

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const relPath = path.relative(SRC_DIR, filePath);

  // Fix config/scenario.ts files: ../scenarioBrandIdentity -> ../../scenarioBrandIdentity
  if (relPath.includes('/config/scenario.ts') && content.includes("from '../scenarioBrandIdentity'")) {
    content = content.split("from '../scenarioBrandIdentity'").join("from '../../scenarioBrandIdentity'");
    modified = true;
  }

  // Fix ScenarioDatabaseManager paths from scenarios/store-diagnosis/tools/
  // From tools/ -> ../../../scenario-system/core/ScenarioDatabaseManager
  // From components/ -> ../../../scenario-system/core/ScenarioDatabaseManager
  // From index.ts -> ../../scenario-system/core/ScenarioDatabaseManager
  if (content.includes('scenario-system/core/ScenarioDatabaseManager')) {
    // Already correct, no change needed
  }

  // Fix remaining old path references
  if (content.includes("from './definitions'")) {
    // Check if this is in a scenario tools directory
    if (relPath.includes('scenarios/') && relPath.includes('/components/')) {
      content = content.split("from './definitions'").join("from '../tools/definitions'");
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
