import { memo, useMemo } from 'react'

interface FileIconProps {
  filename: string
  isDirectory?: boolean
  isOpen?: boolean
  size?: number
  className?: string
}

type IconDef = { glyph: string; hue: string }

const EXT_ICONS: Record<string, IconDef> = {
  ts: { glyph: '\ue628', hue: '#3178c6' },
  tsx: { glyph: '\ue7ba', hue: '#3178c6' },
  js: { glyph: '\ue781', hue: '#f7df1e' },
  jsx: { glyph: '\ue7ba', hue: '#61dafb' },
  mjs: { glyph: '\ue781', hue: '#f7df1e' },
  cjs: { glyph: '\ue781', hue: '#f7df1e' },
  vue: { glyph: '\ue6a0', hue: '#4fc08d' },
  svelte: { glyph: '\ue697', hue: '#ff3e00' },
  html: { glyph: '\ue736', hue: '#e34f26' },
  htm: { glyph: '\ue736', hue: '#e34f26' },
  css: { glyph: '\ue749', hue: '#1572b6' },
  scss: { glyph: '\ue74b', hue: '#cc6699' },
  sass: { glyph: '\ue74b', hue: '#cc6699' },
  less: { glyph: '\ue758', hue: '#1d365d' },
  styl: { glyph: '\ue600', hue: '#ff6347' },
  json: { glyph: '\ue60b', hue: '#cbcb41' },
  json5: { glyph: '\ue60b', hue: '#cbcb41' },
  jsonc: { glyph: '\ue60b', hue: '#cbcb41' },
  yaml: { glyph: '\ue6a8', hue: '#cb171e' },
  yml: { glyph: '\ue6a8', hue: '#cb171e' },
  toml: { glyph: '\ue6b2', hue: '#9c4121' },
  xml: { glyph: '\ue619', hue: '#e37933' },
  csv: { glyph: '\uf1c3', hue: '#237346' },
  py: { glyph: '\ue73c', hue: '#3776ab' },
  pyw: { glyph: '\ue73c', hue: '#3776ab' },
  pyx: { glyph: '\ue73c', hue: '#3776ab' },
  pyi: { glyph: '\ue73c', hue: '#3776ab' },
  ipynb: { glyph: '\ue678', hue: '#f37626' },
  go: { glyph: '\ue627', hue: '#00add8' },
  mod: { glyph: '\ue627', hue: '#00add8' },
  sum: { glyph: '\ue627', hue: '#00add8' },
  rs: { glyph: '\ue7a8', hue: '#dea584' },
  rb: { glyph: '\ue791', hue: '#cc342d' },
  erb: { glyph: '\ue791', hue: '#cc342d' },
  java: { glyph: '\ue738', hue: '#ed8b00' },
  kt: { glyph: '\ue634', hue: '#7f52ff' },
  kts: { glyph: '\ue634', hue: '#7f52ff' },
  gradle: { glyph: '\ue660', hue: '#02303a' },
  c: { glyph: '\ue61e', hue: '#a8b9cc' },
  h: { glyph: '\ue61e', hue: '#a8b9cc' },
  cpp: { glyph: '\ue61d', hue: '#00599c' },
  hpp: { glyph: '\ue61d', hue: '#00599c' },
  cc: { glyph: '\ue61d', hue: '#00599c' },
  cs: { glyph: '\ue648', hue: '#239120' },
  swift: { glyph: '\ue755', hue: '#fa7343' },
  php: { glyph: '\ue73d', hue: '#777bb4' },
  sh: { glyph: '\ue795', hue: '#89e051' },
  bash: { glyph: '\ue795', hue: '#89e051' },
  zsh: { glyph: '\ue795', hue: '#89e051' },
  ps1: { glyph: '\ue683', hue: '#5391fe' },
  bat: { glyph: '\ue629', hue: '#c1f12e' },
  cmd: { glyph: '\ue629', hue: '#c1f12e' },
  md: { glyph: '\ue73e', hue: '#083fa1' },
  mdx: { glyph: '\ue73e', hue: '#083fa1' },
  txt: { glyph: '\uf15c', hue: '#a9a9a9' },
  sql: { glyph: '\ue706', hue: '#e38c00' },
  graphql: { glyph: '\ue662', hue: '#e535ab' },
  gql: { glyph: '\ue662', hue: '#e535ab' },
  prisma: { glyph: '\ue684', hue: '#2d3748' },
  gitignore: { glyph: '\ue702', hue: '#f05032' },
  env: { glyph: '\uf462', hue: '#ecd53f' },
  lock: { glyph: '\uf023', hue: '#e8e8e8' },
  png: { glyph: '\uf1c5', hue: '#a074c4' },
  jpg: { glyph: '\uf1c5', hue: '#a074c4' },
  gif: { glyph: '\uf1c5', hue: '#a074c4' },
  svg: { glyph: '\ue698', hue: '#ffb13b' },
  mp3: { glyph: '\uf1c7', hue: '#e91e63' },
  mp4: { glyph: '\uf1c8', hue: '#9c27b0' },
  zip: { glyph: '\uf1c6', hue: '#ffc107' },
  tar: { glyph: '\uf1c6', hue: '#ffc107' },
  gz: { glyph: '\uf1c6', hue: '#ffc107' },
  pdf: { glyph: '\uf1c1', hue: '#ff0000' },
  doc: { glyph: '\uf1c2', hue: '#2b579a' },
  docx: { glyph: '\uf1c2', hue: '#2b579a' },
  xls: { glyph: '\uf1c3', hue: '#217346' },
  xlsx: { glyph: '\uf1c3', hue: '#217346' },
  ttf: { glyph: '\uf031', hue: '#a9a9a9' },
  woff: { glyph: '\uf031', hue: '#a9a9a9' },
  woff2: { glyph: '\uf031', hue: '#a9a9a9' },
  log: { glyph: '\uf18d', hue: '#a9a9a9' },
}

const NAMED_FILES: Record<string, IconDef> = {
  'package.json': { glyph: '\ue71e', hue: '#cb3837' },
  'package-lock.json': { glyph: '\ue71e', hue: '#cb3837' },
  'yarn.lock': { glyph: '\ue6a7', hue: '#2c8ebb' },
  'pnpm-lock.yaml': { glyph: '\ue71e', hue: '#f69220' },
  'tsconfig.json': { glyph: '\ue628', hue: '#3178c6' },
  'jsconfig.json': { glyph: '\ue781', hue: '#f7df1e' },
  'vite.config.ts': { glyph: '\ue6b4', hue: '#646cff' },
  'vite.config.js': { glyph: '\ue6b4', hue: '#646cff' },
  'webpack.config.js': { glyph: '\ue6a3', hue: '#8dd6f9' },
  '.gitignore': { glyph: '\ue702', hue: '#f05032' },
  '.env': { glyph: '\uf462', hue: '#ecd53f' },
  '.env.local': { glyph: '\uf462', hue: '#ecd53f' },
  '.env.development': { glyph: '\uf462', hue: '#ecd53f' },
  '.env.production': { glyph: '\uf462', hue: '#ecd53f' },
  '.eslintrc': { glyph: '\ue655', hue: '#4b32c3' },
  '.eslintrc.js': { glyph: '\ue655', hue: '#4b32c3' },
  '.prettierrc': { glyph: '\ue6b4', hue: '#f7b93e' },
  'dockerfile': { glyph: '\ue7b0', hue: '#2496ed' },
  'docker-compose.yml': { glyph: '\ue7b0', hue: '#2496ed' },
  'makefile': { glyph: '\ue673', hue: '#6d8086' },
  'readme.md': { glyph: '\ue73e', hue: '#083fa1' },
  'license': { glyph: '\uf2c2', hue: '#d4af37' },
}

const DIR_ICONS: Record<string, IconDef> = {
  src: { glyph: '\uf07b', hue: '#42a5f5' },
  lib: { glyph: '\uf07b', hue: '#7e57c2' },
  dist: { glyph: '\uf07b', hue: '#66bb6a' },
  build: { glyph: '\uf07b', hue: '#ffa726' },
  node_modules: { glyph: '\ue71e', hue: '#8bc34a' },
  test: { glyph: '\uf07b', hue: '#ef5350' },
  tests: { glyph: '\uf07b', hue: '#ef5350' },
  __tests__: { glyph: '\uf07b', hue: '#ef5350' },
  docs: { glyph: '\uf07b', hue: '#42a5f5' },
  public: { glyph: '\uf07b', hue: '#29b6f6' },
  assets: { glyph: '\uf07b', hue: '#ab47bc' },
  images: { glyph: '\uf07b', hue: '#ab47bc' },
  styles: { glyph: '\uf07b', hue: '#ec407a' },
  components: { glyph: '\uf07b', hue: '#26a69a' },
  pages: { glyph: '\uf07b', hue: '#5c6bc0' },
  views: { glyph: '\uf07b', hue: '#5c6bc0' },
  hooks: { glyph: '\uf07b', hue: '#29b6f6' },
  utils: { glyph: '\uf07b', hue: '#78909c' },
  services: { glyph: '\uf07b', hue: '#ff7043' },
  api: { glyph: '\uf07b', hue: '#66bb6a' },
  routes: { glyph: '\uf07b', hue: '#ffa726' },
  store: { glyph: '\uf07b', hue: '#7e57c2' },
  stores: { glyph: '\uf07b', hue: '#7e57c2' },
  models: { glyph: '\uf07b', hue: '#26a69a' },
  types: { glyph: '\uf07b', hue: '#3178c6' },
  config: { glyph: '\uf07b', hue: '#78909c' },
  scripts: { glyph: '\uf07b', hue: '#66bb6a' },
  plugins: { glyph: '\uf07b', hue: '#ab47bc' },
  middleware: { glyph: '\uf07b', hue: '#ff7043' },
  locales: { glyph: '\uf07b', hue: '#29b6f6' },
  templates: { glyph: '\uf07b', hue: '#7e57c2' },
  '.git': { glyph: '\ue702', hue: '#f05032' },
  '.github': { glyph: '\ue709', hue: '#181717' },
  '.vscode': { glyph: '\ue70c', hue: '#007acc' },
  android: { glyph: '\ue70e', hue: '#3ddc84' },
  ios: { glyph: '\ue711', hue: '#000000' },
  main: { glyph: '\uf07b', hue: '#42a5f5' },
  renderer: { glyph: '\uf07b', hue: '#42a5f5' },
  shared: { glyph: '\uf07b', hue: '#78909c' },
  core: { glyph: '\uf07b', hue: '#ffa726' },
  features: { glyph: '\uf07b', hue: '#66bb6a' },
  modules: { glyph: '\uf07b', hue: '#7e57c2' },
  agent: { glyph: '\uf07b', hue: '#ab47bc' },
  security: { glyph: '\uf07b', hue: '#ef5350' },
  indexing: { glyph: '\uf07b', hue: '#26a69a' },
  ipc: { glyph: '\uf07b', hue: '#ff7043' },
}

const FALLBACK_FILE: IconDef = { glyph: '\uf15c', hue: '#a9a9a9' }
const FALLBACK_DIR: IconDef = { glyph: '\uf07b', hue: '#90a4ae' }
const FALLBACK_DIR_OPEN: IconDef = { glyph: '\uf07c', hue: '#90a4ae' }

function resolveFileIcon(name: string): IconDef {
  const lower = name.toLowerCase()
  if (NAMED_FILES[lower]) return NAMED_FILES[lower]
  const ext = lower.split('.').pop() || ''
  if (EXT_ICONS[ext]) return EXT_ICONS[ext]
  if (lower.startsWith('.env')) return EXT_ICONS['env'] ?? FALLBACK_FILE
  if (lower.includes('eslint')) return NAMED_FILES['.eslintrc'] ?? FALLBACK_FILE
  if (lower.includes('prettier')) return NAMED_FILES['.prettierrc'] ?? FALLBACK_FILE
  if (lower.includes('webpack')) return NAMED_FILES['webpack.config.js'] ?? FALLBACK_FILE
  if (lower.includes('vite.config')) return NAMED_FILES['vite.config.ts'] ?? FALLBACK_FILE
  if (lower.includes('tsconfig')) return NAMED_FILES['tsconfig.json'] ?? FALLBACK_FILE
  if (lower.includes('dockerfile')) return NAMED_FILES['dockerfile'] ?? FALLBACK_FILE
  if (lower === 'license' || lower.startsWith('license.')) return NAMED_FILES['license'] ?? FALLBACK_FILE
  if (lower === 'readme' || lower.startsWith('readme.')) return NAMED_FILES['readme.md'] ?? FALLBACK_FILE
  return FALLBACK_FILE
}

function resolveDirIcon(name: string, open: boolean): IconDef {
  const mapped = DIR_ICONS[name.toLowerCase()]
  if (mapped) return { glyph: open ? '\uf07c' : mapped.glyph, hue: mapped.hue }
  return open ? FALLBACK_DIR_OPEN : FALLBACK_DIR
}

export const FileIcon = memo(function FileIcon({ filename, isDirectory = false, isOpen = false, size = 16, className = '' }: FileIconProps) {
  const { glyph, hue } = useMemo(() => isDirectory ? resolveDirIcon(filename, isOpen) : resolveFileIcon(filename), [filename, isDirectory, isOpen])
  return (
    <span className={`nf-icon inline-flex items-center justify-center flex-shrink-0 ${className}`} style={{ fontSize: size, width: size, height: size, color: hue, lineHeight: 1 }}>
      {glyph}
    </span>
  )
})

export default FileIcon
