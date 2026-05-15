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

  // Fix import('/llm') -> import('@protocols/llm')
  if (content.includes("import('/llm')")) {
    content = content.split("import('/llm')").join("import('@protocols/llm')");
    modified = true;
  }

  // Fix from '' in intelligence/ files -> from '@intelligence/types'
  if (content.includes("from ''")) {
    if (relPath.includes('renderer/intelligence/')) {
      content = content.split("from ''").join("from '@intelligence/types'");
      modified = true;
    } else if (relPath.includes('scenarios/') || relPath.includes('scenario-system/')) {
      content = content.split("from ''").join("from '@scenario-system/types'");
      modified = true;
    }
  }

  // Fix from '../scenarioBrandIdentity' - this is a valid relative path, check if file exists
  // The scenarioBrandIdentity.ts is at src/scenarios/scenarioBrandIdentity.ts
  // Files in src/scenarios/xxx/ reference it as '../scenarioBrandIdentity' which is correct
  // But files in src/scenarios/xxx/config/ reference it as '../../scenarioBrandIdentity'
  // These should work, but let's check if the file exists
  // Actually, the issue might be that we replaced it incorrectly before
  
  // Fix ../../scenario-system/engine/ScenarioDatabaseManager - this is a valid relative path
  // from src/scenarios/store-diagnosis/tools/executors.ts
  // The actual file is at src/scenario-system/engine/ScenarioDatabaseManager.ts
  // From src/scenarios/store-diagnosis/tools/ -> ../../scenario-system/ is wrong
  // It should be ../../../scenario-system/
  if (content.includes("from '../../scenario-system/engine/ScenarioDatabaseManager'")) {
    content = content.split("from '../../scenario-system/engine/ScenarioDatabaseManager'").join("from '../../../scenario-system/engine/ScenarioDatabaseManager'");
    modified = true;
  }

  // Fix @scenario-system/types - add tsconfig path alias
  // For now, use relative path
  if (content.includes("from '@scenario-system/types'")) {
    // Calculate relative path from current file to src/scenario-system/types.ts
    const scenarioTypesFile = path.join(SRC_DIR, 'scenario-system', 'types.ts');
    if (fs.existsSync(scenarioTypesFile)) {
      const fileDir = path.dirname(filePath);
      let relToScenario = path.relative(fileDir, scenarioTypesFile);
      if (!relToScenario.startsWith('.')) {
        relToScenario = './' + relToScenario;
      }
      relToScenario = relToScenario.replace(/\.ts$/, '');
      content = content.split("from '@scenario-system/types'").join(`from '${relToScenario}'`);
      modified = true;
    }
  }

  // Fix api.fs references - these should use api.file instead
  if (content.includes('api.fs.')) {
    content = content.split('api.fs.').join('api.file.');
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
