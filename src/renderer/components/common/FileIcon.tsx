/**
 * 文件图标组件
 * 使用 Nerd Font 图标，类似 VS Code 的文件图标
 */

import { memo, useMemo } from 'react'

interface FileIconProps {
  filename: string
  isDirectory?: boolean
  isOpen?: boolean
  size?: number
  className?: string
}

// 文件扩展名到图标和颜色的映射
const FILE_ICON_MAP: Record<string, { icon: string; color: string }> = {
  // TypeScript/JavaScript
  ts: { icon: '\ue628', color: '#3178c6' },      // 
  tsx: { icon: '\ue7ba', color: '#3178c6' },     // 
  js: { icon: '\ue781', color: '#f7df1e' },      // 
  jsx: { icon: '\ue7ba', color: '#61dafb' },     // 
  mjs: { icon: '\ue781', color: '#f7df1e' },
  cjs: { icon: '\ue781', color: '#f7df1e' },
  
  // Web frameworks
  vue: { icon: '\ue6a0', color: '#4fc08d' },     // 
  svelte: { icon: '\ue697', color: '#ff3e00' },  // 
  
  // Markup
  html: { icon: '\ue736', color: '#e34f26' },    // 
  htm: { icon: '\ue736', color: '#e34f26' },
  
  // Styles
  css: { icon: '\ue749', color: '#1572b6' },     // 
  scss: { icon: '\ue74b', color: '#cc6699' },    // 
  sass: { icon: '\ue74b', color: '#cc6699' },
  less: { icon: '\ue758', color: '#1d365d' },    // 
  styl: { icon: '\ue600', color: '#ff6347' },

  // Data/Config
  json: { icon: '\ue60b', color: '#cbcb41' },    // 
  json5: { icon: '\ue60b', color: '#cbcb41' },
  jsonc: { icon: '\ue60b', color: '#cbcb41' },
  yaml: { icon: '\ue6a8', color: '#cb171e' },    // 
  yml: { icon: '\ue6a8', color: '#cb171e' },
  toml: { icon: '\ue6b2', color: '#9c4121' },    // 
  xml: { icon: '\ue619', color: '#e37933' },     // 
  csv: { icon: '\uf1c3', color: '#237346' },     // 
  
  // Python
  py: { icon: '\ue73c', color: '#3776ab' },      // 
  pyw: { icon: '\ue73c', color: '#3776ab' },
  pyx: { icon: '\ue73c', color: '#3776ab' },
  pyi: { icon: '\ue73c', color: '#3776ab' },
  ipynb: { icon: '\ue678', color: '#f37626' },   // 
  
  // Go
  go: { icon: '\ue627', color: '#00add8' },      // 
  mod: { icon: '\ue627', color: '#00add8' },
  sum: { icon: '\ue627', color: '#00add8' },
  
  // Rust
  rs: { icon: '\ue7a8', color: '#dea584' },      // 
  
  // Ruby
  rb: { icon: '\ue791', color: '#cc342d' },      // 
  erb: { icon: '\ue791', color: '#cc342d' },
  rake: { icon: '\ue791', color: '#cc342d' },
  gemspec: { icon: '\ue791', color: '#cc342d' },
  
  // Java/Kotlin
  java: { icon: '\ue738', color: '#ed8b00' },    // 
  kt: { icon: '\ue634', color: '#7f52ff' },      // 
  kts: { icon: '\ue634', color: '#7f52ff' },
  gradle: { icon: '\ue660', color: '#02303a' },  // 
  
  // C/C++
  c: { icon: '\ue61e', color: '#a8b9cc' },       // 
  h: { icon: '\ue61e', color: '#a8b9cc' },
  cpp: { icon: '\ue61d', color: '#00599c' },     // 
  hpp: { icon: '\ue61d', color: '#00599c' },
  cc: { icon: '\ue61d', color: '#00599c' },
  cxx: { icon: '\ue61d', color: '#00599c' },
  
  // C#
  cs: { icon: '\ue648', color: '#239120' },      // 
  csx: { icon: '\ue648', color: '#239120' },
  
  // Swift
  swift: { icon: '\ue755', color: '#fa7343' },   // 
  
  // PHP
  php: { icon: '\ue73d', color: '#777bb4' },     // 
  
  // Shell
  sh: { icon: '\ue795', color: '#89e051' },      // 
  bash: { icon: '\ue795', color: '#89e051' },
  zsh: { icon: '\ue795', color: '#89e051' },
  fish: { icon: '\ue795', color: '#89e051' },
  ps1: { icon: '\ue683', color: '#5391fe' },     // 
  psm1: { icon: '\ue683', color: '#5391fe' },
  bat: { icon: '\ue629', color: '#c1f12e' },     // 
  cmd: { icon: '\ue629', color: '#c1f12e' },

  // Markdown/Docs
  md: { icon: '\ue73e', color: '#083fa1' },      // 
  mdx: { icon: '\ue73e', color: '#083fa1' },
  markdown: { icon: '\ue73e', color: '#083fa1' },
  txt: { icon: '\uf15c', color: '#a9a9a9' },     // 
  rst: { icon: '\uf15c', color: '#a9a9a9' },
  
  // Database
  sql: { icon: '\ue706', color: '#e38c00' },     // 
  mysql: { icon: '\ue704', color: '#4479a1' },   // 
  pgsql: { icon: '\ue76e', color: '#336791' },   // 
  sqlite: { icon: '\ue7c4', color: '#003b57' },  // 
  graphql: { icon: '\ue662', color: '#e535ab' }, // 
  gql: { icon: '\ue662', color: '#e535ab' },
  prisma: { icon: '\ue684', color: '#2d3748' },  // 
  
  // Git
  gitignore: { icon: '\ue702', color: '#f05032' },    // 
  gitattributes: { icon: '\ue702', color: '#f05032' },
  gitmodules: { icon: '\ue702', color: '#f05032' },
  
  // Docker
  dockerfile: { icon: '\ue7b0', color: '#2496ed' },   // 
  dockerignore: { icon: '\ue7b0', color: '#2496ed' },
  
  // Config files
  env: { icon: '\uf462', color: '#ecd53f' },     // 
  editorconfig: { icon: '\ue652', color: '#fefefe' }, // 
  prettierrc: { icon: '\ue6b4', color: '#f7b93e' },   // 
  eslintrc: { icon: '\ue655', color: '#4b32c3' },     // 
  babelrc: { icon: '\ue639', color: '#f9dc3e' },      // 
  
  // Package managers
  lock: { icon: '\uf023', color: '#e8e8e8' },    // 
  
  // Images
  png: { icon: '\uf1c5', color: '#a074c4' },     // 
  jpg: { icon: '\uf1c5', color: '#a074c4' },
  jpeg: { icon: '\uf1c5', color: '#a074c4' },
  gif: { icon: '\uf1c5', color: '#a074c4' },
  webp: { icon: '\uf1c5', color: '#a074c4' },
  ico: { icon: '\uf1c5', color: '#a074c4' },
  bmp: { icon: '\uf1c5', color: '#a074c4' },
  svg: { icon: '\ue698', color: '#ffb13b' },     // 
  
  // Media
  mp3: { icon: '\uf1c7', color: '#e91e63' },     // 
  wav: { icon: '\uf1c7', color: '#e91e63' },
  ogg: { icon: '\uf1c7', color: '#e91e63' },
  flac: { icon: '\uf1c7', color: '#e91e63' },
  mp4: { icon: '\uf1c8', color: '#9c27b0' },     // 
  webm: { icon: '\uf1c8', color: '#9c27b0' },
  mkv: { icon: '\uf1c8', color: '#9c27b0' },
  avi: { icon: '\uf1c8', color: '#9c27b0' },
  
  // Archives
  zip: { icon: '\uf1c6', color: '#ffc107' },     // 
  tar: { icon: '\uf1c6', color: '#ffc107' },
  gz: { icon: '\uf1c6', color: '#ffc107' },
  rar: { icon: '\uf1c6', color: '#ffc107' },
  '7z': { icon: '\uf1c6', color: '#ffc107' },
  
  // Documents
  pdf: { icon: '\uf1c1', color: '#ff0000' },     // 
  doc: { icon: '\uf1c2', color: '#2b579a' },     // 
  docx: { icon: '\uf1c2', color: '#2b579a' },
  xls: { icon: '\uf1c3', color: '#217346' },     // 
  xlsx: { icon: '\uf1c3', color: '#217346' },
  ppt: { icon: '\uf1c4', color: '#d24726' },     // 
  pptx: { icon: '\uf1c4', color: '#d24726' },
  
  // Fonts
  ttf: { icon: '\uf031', color: '#a9a9a9' },     // 
  otf: { icon: '\uf031', color: '#a9a9a9' },
  woff: { icon: '\uf031', color: '#a9a9a9' },
  woff2: { icon: '\uf031', color: '#a9a9a9' },
  
  // Misc
  log: { icon: '\uf18d', color: '#a9a9a9' },     // 
  license: { icon: '\uf2c2', color: '#d4af37' }, // 
}


// 特殊文件名映射
const SPECIAL_FILES: Record<string, { icon: string; color: string }> = {
  'package.json': { icon: '\ue71e', color: '#cb3837' },      // npm
  'package-lock.json': { icon: '\ue71e', color: '#cb3837' },
  'yarn.lock': { icon: '\ue6a7', color: '#2c8ebb' },         // yarn
  'pnpm-lock.yaml': { icon: '\ue71e', color: '#f69220' },
  'tsconfig.json': { icon: '\ue628', color: '#3178c6' },     // ts
  'jsconfig.json': { icon: '\ue781', color: '#f7df1e' },     // js
  'vite.config.ts': { icon: '\ue6b4', color: '#646cff' },
  'vite.config.js': { icon: '\ue6b4', color: '#646cff' },
  'webpack.config.js': { icon: '\ue6a3', color: '#8dd6f9' }, // webpack
  'rollup.config.js': { icon: '\ue6a3', color: '#ec4a3f' },
  '.gitignore': { icon: '\ue702', color: '#f05032' },
  '.gitattributes': { icon: '\ue702', color: '#f05032' },
  '.env': { icon: '\uf462', color: '#ecd53f' },
  '.env.local': { icon: '\uf462', color: '#ecd53f' },
  '.env.development': { icon: '\uf462', color: '#ecd53f' },
  '.env.production': { icon: '\uf462', color: '#ecd53f' },
  '.eslintrc': { icon: '\ue655', color: '#4b32c3' },
  '.eslintrc.js': { icon: '\ue655', color: '#4b32c3' },
  '.eslintrc.json': { icon: '\ue655', color: '#4b32c3' },
  '.prettierrc': { icon: '\ue6b4', color: '#f7b93e' },
  '.prettierrc.js': { icon: '\ue6b4', color: '#f7b93e' },
  '.prettierrc.json': { icon: '\ue6b4', color: '#f7b93e' },
  'dockerfile': { icon: '\ue7b0', color: '#2496ed' },
  'docker-compose.yml': { icon: '\ue7b0', color: '#2496ed' },
  'docker-compose.yaml': { icon: '\ue7b0', color: '#2496ed' },
  'makefile': { icon: '\ue673', color: '#6d8086' },
  'cmakelists.txt': { icon: '\ue673', color: '#064f8c' },
  'readme.md': { icon: '\ue73e', color: '#083fa1' },
  'readme': { icon: '\ue73e', color: '#083fa1' },
  'changelog.md': { icon: '\ue73e', color: '#083fa1' },
  'changelog': { icon: '\ue73e', color: '#083fa1' },
  'license': { icon: '\uf2c2', color: '#d4af37' },
  'license.md': { icon: '\uf2c2', color: '#d4af37' },
  'license.txt': { icon: '\uf2c2', color: '#d4af37' },
  'contributing.md': { icon: '\ue73e', color: '#083fa1' },
  'authors': { icon: '\uf0c0', color: '#a9a9a9' },
}

// 文件夹图标映射
const FOLDER_ICON_MAP: Record<string, { icon: string; color: string }> = {
  src: { icon: '\uf07b', color: '#42a5f5' },
  source: { icon: '\uf07b', color: '#42a5f5' },
  lib: { icon: '\uf07b', color: '#7e57c2' },
  dist: { icon: '\uf07b', color: '#66bb6a' },
  build: { icon: '\uf07b', color: '#ffa726' },
  out: { icon: '\uf07b', color: '#66bb6a' },
  node_modules: { icon: '\ue71e', color: '#8bc34a' },
  packages: { icon: '\uf07b', color: '#8bc34a' },
  test: { icon: '\uf07b', color: '#ef5350' },
  tests: { icon: '\uf07b', color: '#ef5350' },
  __tests__: { icon: '\uf07b', color: '#ef5350' },
  spec: { icon: '\uf07b', color: '#ef5350' },
  docs: { icon: '\uf07b', color: '#42a5f5' },
  doc: { icon: '\uf07b', color: '#42a5f5' },
  public: { icon: '\uf07b', color: '#29b6f6' },
  static: { icon: '\uf07b', color: '#29b6f6' },
  assets: { icon: '\uf07b', color: '#ab47bc' },
  images: { icon: '\uf07b', color: '#ab47bc' },
  img: { icon: '\uf07b', color: '#ab47bc' },
  icons: { icon: '\uf07b', color: '#ab47bc' },
  styles: { icon: '\uf07b', color: '#ec407a' },
  css: { icon: '\uf07b', color: '#ec407a' },
  scss: { icon: '\uf07b', color: '#ec407a' },
  components: { icon: '\uf07b', color: '#26a69a' },
  pages: { icon: '\uf07b', color: '#5c6bc0' },
  views: { icon: '\uf07b', color: '#5c6bc0' },
  layouts: { icon: '\uf07b', color: '#7e57c2' },
  hooks: { icon: '\uf07b', color: '#29b6f6' },
  utils: { icon: '\uf07b', color: '#78909c' },
  helpers: { icon: '\uf07b', color: '#78909c' },
  services: { icon: '\uf07b', color: '#ff7043' },
  api: { icon: '\uf07b', color: '#66bb6a' },
  routes: { icon: '\uf07b', color: '#ffa726' },
  router: { icon: '\uf07b', color: '#ffa726' },
  store: { icon: '\uf07b', color: '#7e57c2' },
  stores: { icon: '\uf07b', color: '#7e57c2' },
  state: { icon: '\uf07b', color: '#7e57c2' },
  redux: { icon: '\uf07b', color: '#764abc' },
  models: { icon: '\uf07b', color: '#26a69a' },
  types: { icon: '\uf07b', color: '#3178c6' },
  interfaces: { icon: '\uf07b', color: '#3178c6' },
  config: { icon: '\uf07b', color: '#78909c' },
  configs: { icon: '\uf07b', color: '#78909c' },
  settings: { icon: '\uf07b', color: '#78909c' },
  scripts: { icon: '\uf07b', color: '#66bb6a' },
  bin: { icon: '\uf07b', color: '#ffa726' },
  vendor: { icon: '\uf07b', color: '#8d6e63' },
  plugins: { icon: '\uf07b', color: '#ab47bc' },
  middleware: { icon: '\uf07b', color: '#ff7043' },
  migrations: { icon: '\uf07b', color: '#78909c' },
  mocks: { icon: '\uf07b', color: '#ef5350' },
  __mocks__: { icon: '\uf07b', color: '#ef5350' },
  locales: { icon: '\uf07b', color: '#29b6f6' },
  i18n: { icon: '\uf07b', color: '#29b6f6' },
  templates: { icon: '\uf07b', color: '#7e57c2' },
  logs: { icon: '\uf07b', color: '#78909c' },
  tmp: { icon: '\uf07b', color: '#bdbdbd' },
  temp: { icon: '\uf07b', color: '#bdbdbd' },
  cache: { icon: '\uf07b', color: '#bdbdbd' },
  '.git': { icon: '\ue702', color: '#f05032' },
  '.github': { icon: '\ue709', color: '#181717' },
  '.vscode': { icon: '\ue70c', color: '#007acc' },
  '.idea': { icon: '\ue7b5', color: '#000000' },
  android: { icon: '\ue70e', color: '#3ddc84' },
  ios: { icon: '\ue711', color: '#000000' },
  electron: { icon: '\ue62e', color: '#47848f' },
  main: { icon: '\uf07b', color: '#42a5f5' },
  renderer: { icon: '\uf07b', color: '#42a5f5' },
  shared: { icon: '\uf07b', color: '#78909c' },
  common: { icon: '\uf07b', color: '#78909c' },
  core: { icon: '\uf07b', color: '#ffa726' },
  features: { icon: '\uf07b', color: '#66bb6a' },
  modules: { icon: '\uf07b', color: '#7e57c2' },
  agent: { icon: '\uf07b', color: '#ab47bc' },
  security: { icon: '\uf07b', color: '#ef5350' },
  indexing: { icon: '\uf07b', color: '#26a69a' },
  ipc: { icon: '\uf07b', color: '#ff7043' },
}

// 默认图标
const DEFAULT_FILE = { icon: '\uf15c', color: '#a9a9a9' }      // 
const DEFAULT_FOLDER = { icon: '\uf07b', color: '#90a4ae' }    // 
const DEFAULT_FOLDER_OPEN = { icon: '\uf07c', color: '#90a4ae' } // 


function getFileIcon(filename: string): { icon: string; color: string } {
  const lowerName = filename.toLowerCase()
  
  // 1. 检查特殊文件名
  if (SPECIAL_FILES[lowerName]) {
    return SPECIAL_FILES[lowerName]
  }
  
  // 2. 检查扩展名
  const ext = lowerName.split('.').pop() || ''
  if (FILE_ICON_MAP[ext]) {
    return FILE_ICON_MAP[ext]
  }
  
  // 3. 特殊模式匹配
  if (lowerName.startsWith('.env')) return FILE_ICON_MAP['env'] || DEFAULT_FILE
  if (lowerName.includes('eslint')) return SPECIAL_FILES['.eslintrc'] || DEFAULT_FILE
  if (lowerName.includes('prettier')) return SPECIAL_FILES['.prettierrc'] || DEFAULT_FILE
  if (lowerName.includes('webpack')) return SPECIAL_FILES['webpack.config.js'] || DEFAULT_FILE
  if (lowerName.includes('vite.config')) return SPECIAL_FILES['vite.config.ts'] || DEFAULT_FILE
  if (lowerName.includes('tsconfig')) return SPECIAL_FILES['tsconfig.json'] || DEFAULT_FILE
  if (lowerName.includes('dockerfile')) return SPECIAL_FILES['dockerfile'] || DEFAULT_FILE
  if (lowerName === 'license' || lowerName.startsWith('license.')) return SPECIAL_FILES['license'] || DEFAULT_FILE
  if (lowerName === 'readme' || lowerName.startsWith('readme.')) return SPECIAL_FILES['readme.md'] || DEFAULT_FILE
  
  return DEFAULT_FILE
}

function getFolderIcon(folderName: string, isOpen: boolean): { icon: string; color: string } {
  const lowerName = folderName.toLowerCase()
  
  const mapped = FOLDER_ICON_MAP[lowerName]
  if (mapped) {
    return {
      icon: isOpen ? '\uf07c' : mapped.icon,  // 打开时用打开的文件夹图标
      color: mapped.color
    }
  }
  
  return isOpen ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER
}

export const FileIcon = memo(function FileIcon({ 
  filename, 
  isDirectory = false, 
  isOpen = false,
  size = 16,
  className = ''
}: FileIconProps) {
  const { icon, color } = useMemo(() => {
    if (isDirectory) {
      return getFolderIcon(filename, isOpen)
    }
    return getFileIcon(filename)
  }, [filename, isDirectory, isOpen])

  return (
    <span 
      className={`nf-icon inline-flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ 
        fontSize: size,
        width: size,
        height: size,
        color,
        lineHeight: 1,
      }}
    >
      {icon}
    </span>
  )
})

export default FileIcon
