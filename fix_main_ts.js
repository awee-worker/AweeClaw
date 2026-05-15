const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/main/main.ts');
let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
  ["import('./ipc')", "import('./bridge/ipcMain')"],
  ["import('./security')", "import('./guard')"],
  ["import('./runtime/debugger')", "import('./modules/dap-adapter')"],
  ["import('../bridge/window')", "import('./bridge/window')"],
  ["import('./runtime/updater')", "import('./modules/auto-update')"],
  ["import('./runtime/channel')", "import('./modules/messaging')"],
  ["import('./runtime/python')", "import('./modules/python-runtime')"],
  ["import('./ipc/updater')", "import('./bridge/updater')"],
  ["typeof import('./ipc')", "typeof import('./bridge/ipcMain')"],
  ["typeof import('./security')", "typeof import('./guard')"],
];

for (const [old, newStr] of replacements) {
  content = content.split(old).join(newStr);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed main.ts');
