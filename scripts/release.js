/**
 * 版本发布脚本
 * 用法: node scripts/release.js [patch|minor|major]
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

const bumpType = process.argv[2] || 'patch'
const [major, minor, patch] = pkg.version.split('.').map(Number)

let newVersion
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`
    break
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`
    break
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`
}

console.log(`\n📦 Releasing v${newVersion}...\n`)

// 0. 检查 tag 是否已存在
try {
  execSync(`git rev-parse v${newVersion}`, { stdio: 'pipe' })
  console.error(`❌ Tag v${newVersion} already exists!`)
  process.exit(1)
} catch {
  // tag 不存在，继续
}

// 1. 更新 package.json 版本号
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ Updated package.json to v${newVersion}`)

// 2. 提交版本变更
execSync('git add package.json', { stdio: 'inherit' })
execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: 'inherit' })
console.log(`✅ Committed version bump`)

// 3. 创建 tag
execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: 'inherit' })
console.log(`✅ Created tag v${newVersion}`)

// 4. 推送到远程（包括 tag）
execSync('git push', { stdio: 'inherit' })
// 只推送当前版本的 tag，避免旧 tag 冲突
execSync(`git push origin v${newVersion}`, { stdio: 'inherit' })
console.log(`✅ Pushed to remote`)

console.log(`
🎉 Release v${newVersion} complete!

GitHub Actions will automatically:
1. Build installers for Windows, macOS, Linux
2. Create GitHub Release with all artifacts
3. Sync code and tags to Gitee

⚠️  Gitee Release 需要手动创建:
   https://gitee.com/jweelee/aweeclaw.git/releases/new
   - 选择 tag: v${newVersion}
   - 从 GitHub Release 下载安装包后上传到 Gitee
`)
