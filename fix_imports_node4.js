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

  // Fix ScenarioDatabaseManager path: engine -> core
  if (content.includes('scenario-system/engine/ScenarioDatabaseManager')) {
    content = content.split('scenario-system/engine/ScenarioDatabaseManager').join('scenario-system/core/ScenarioDatabaseManager');
    modified = true;
  }

  // Fix ./definitions -> ../tools/definitions for scenario components
  const relPath = path.relative(SRC_DIR, filePath);
  if (content.includes("from './definitions'")) {
    if (relPath.includes('scenarios/') && relPath.includes('/components/')) {
      content = content.split("from './definitions'").join("from '../tools/definitions'");
      modified = true;
    }
  }

  // Fix api.file.writeFile -> api.file.write
  if (content.includes('api.file.writeFile')) {
    content = content.split('api.file.writeFile').join('api.file.write');
    modified = true;
  }
  
  // Fix api.file.readFile -> api.file.read
  if (content.includes('api.file.readFile')) {
    content = content.split('api.file.readFile').join('api.file.read');
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    totalFixed++;
  }
}

console.log(`Fixed ${totalFixed} files`);
