/**
 * 修复重复的 Language 导入和错误的自身导入
 * 
 * 用法：node scripts/i18n-fix-duplicate-imports.js
 */

const fs = require('fs')
const path = require('path')

const fixes = [
  // Duplicate type Language in same import
  {
    file: 'src/renderer/components/intelligence/InlineDiffPreview.tsx',
    search: "import { t, type Language, type Language  } from '@renderer/i18n'",
    replace: "import { t, type Language } from '@renderer/i18n'"
  },
  {
    file: 'src/renderer/components/intelligence/ToolCallCard.tsx',
    search: "import { t, type Language, type Language  } from '@renderer/i18n'",
    replace: "import { t, type Language } from '@renderer/i18n'"
  },
  // Duplicate Language import across two lines
  {
    file: 'src/renderer/components/settings/tabs/AppearanceSettings.tsx',
    search: "import type { Language } from '@renderer/i18n'",
    replace: ''
  },
  {
    file: 'src/renderer/components/user/BillingCenterPage.tsx',
    search: "import { type BillingTab, type Language } from './tabs'",
    replace: "import { type BillingTab } from './tabs'"
  },
  {
    file: 'src/renderer/components/user/UserProfilePage.tsx',
    search: "import { type ProfileTab, type Language } from './tabs'",
    replace: "import { type ProfileTab } from './tabs'"
  },
  // Duplicate t import
  {
    file: 'src/renderer/components/intelligence/ChatMessage.tsx',
    search: "import { t } from '../../i18n'",
    replace: ''
  },
  // Self-import in i18nSetup.ts
  {
    file: 'src/renderer/i18n/i18nSetup.ts',
    search: "import { t, type Language } from '@renderer/i18n'",
    replace: ''
  },
]

let fixed = 0
for (const fix of fixes) {
  const fullPath = path.join(__dirname, '..', fix.file)
  try {
    let content = fs.readFileSync(fullPath, 'utf-8')
    if (content.includes(fix.search)) {
      content = content.replace(fix.search, fix.replace)
      // Clean up double blank lines
      content = content.replace(/\n{3,}/g, '\n\n')
      fs.writeFileSync(fullPath, content, 'utf-8')
      console.log(`  ✓ ${fix.file}`)
      fixed++
    } else {
      console.log(`  - ${fix.file} (pattern not found)`)
    }
  } catch (err) {
    console.error(`  ✗ ${fix.file}: ${err.message}`)
  }
}

// Also check if Language type is exported from ./tabs files
const tabsDir = path.join(__dirname, '../src/renderer/components/user/tabs')
if (fs.existsSync(tabsDir)) {
  const indexFile = path.join(tabsDir, 'index.ts')
  if (fs.existsSync(indexFile)) {
    let content = fs.readFileSync(indexFile, 'utf-8')
    if (content.includes("export type { Language }") || content.includes("export { Language }")) {
      content = content.replace(/export\s+(type\s+)?\{\s*Language\s*\}\s*\n?/g, '')
      fs.writeFileSync(indexFile, content, 'utf-8')
      console.log('  ✓ Removed Language export from user/tabs/index.ts')
      fixed++
    }
  }
}

console.log(`\nFixed ${fixed} files`)
