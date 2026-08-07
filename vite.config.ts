import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import path from 'path'
import fs from 'fs'

// 外部依赖（不打包到 bundle）
const EXTERNAL_DEPS = [
  'electron',
  'electron-store',
  'electron-updater',
  '@anthropic-ai/sdk',
  'openai',
  '@google/genai',
  'node-pty',
  'ssh2',
  'cpu-features',
  '@parcel/watcher',
  '@parcel/watcher-win32-x64',
  '@parcel/watcher-win32-arm64',
  '@parcel/watcher-darwin-x64',
  '@parcel/watcher-darwin-arm64',
  '@parcel/watcher-linux-x64-glibc',
  '@parcel/watcher-linux-x64-musl',
  '@parcel/watcher-linux-arm64-glibc',
  '@parcel/watcher-linux-arm64-musl',
  'dugite',
  '@vscode/ripgrep',
  '@lancedb/lancedb',
  'apache-arrow',
  '@xenova/transformers',
  'onnxruntime-node',
  'onnxruntime-web',
  '@larksuiteoapi/node-sdk',
  'ws',
  'bufferutil',
  'utf-8-validate',
  'tar',
  // 原生模块（sharp + 平台二进制）必须保持 external，避免 Rollup 打包破坏 require 路径
  'sharp',
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-linux-x64',
  '@img/sharp-linux-arm64',
  '@img/sharp-win32-x64',
  '@img/sharp-win32-ia32',
  '@img/sharp-win32-arm64',
  '@img/sharp-wasm32',
  '@img/sharp-libvips-darwin-arm64',
  '@img/sharp-libvips-darwin-x64',
  '@img/sharp-libvips-linux-x64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-libvips-win32-x64',
  '@img/sharp-libvips-win32-ia32',
  '@img/sharp-libvips-win32-arm64',
  // BLE 原生模块（s8-01，@abandonware/noble 懒加载 require，保持 external 避免 Rollup 打包）
  '@abandonware/noble',
  '@abandonware/bluetooth-hci-socket',
  'noble',
  'bluetooth-hci-socket',
  // MQTT 协议模块（s9-10，mqtt 懒加载 require，保持 external 避免 Rollup 打包）
  'mqtt',
  // 原生输入监听模块（uiohook-napi，供 ai-macro-recorder 录制鼠标/键盘事件）
  // 必须保持 external：该模块内部使用 node-gyp-build 加载 .node 二进制，
  // 若被 Rollup 打包进 chunk，__dirname 路径错误导致 node-gyp-build 找不到 prebuild 二进制
  'uiohook-napi',
  'node-gyp-build',
]

// 路径别名配置
const aliases = {
  '@': path.resolve(__dirname, './src'),
  '@main': path.resolve(__dirname, './src/main'),
  '@renderer': path.resolve(__dirname, './src/renderer'),
  '@shared': path.resolve(__dirname, './src/shared'),
  '@components': path.resolve(__dirname, './src/renderer/components'),
  '@features': path.resolve(__dirname, './src/renderer/features'),
  '@services': path.resolve(__dirname, './src/renderer/adapters'),
  '@store': path.resolve(__dirname, './src/renderer/state'),
  '@hooks': path.resolve(__dirname, './src/renderer/composables'),
  '@utils': path.resolve(__dirname, './src/renderer/toolkit'),
  '@app-types': path.resolve(__dirname, './src/renderer/types'),
  '@intelligence': path.resolve(__dirname, './src/renderer/intelligence'),
  '@bridge': path.resolve(__dirname, './src/main/bridge'),
  '@guard': path.resolve(__dirname, './src/main/guard'),
  '@modules': path.resolve(__dirname, './src/main/modules'),
  '@search-engine': path.resolve(__dirname, './src/main/search-engine'),
  '@toolkit': path.resolve(__dirname, './src/shared/toolkit'),
  '@protocols': path.resolve(__dirname, './src/shared/protocols'),
  '@configuration': path.resolve(__dirname, './src/shared/configuration'),
  '@scenario-system': path.resolve(__dirname, './src/scenario-system'),
  '@scenarios': path.resolve(__dirname, './src/scenarios'),
  'vscode-nls': path.resolve(__dirname, './node_modules/monaco-editor-nls')
}

export default defineConfig({
  plugins: [
    // 构建前清理 dist 目录（跨平台，替代 rimraf dist）
    {
      name: 'clean-dist',
      buildStart() {
        const distDir = path.resolve(__dirname, 'dist')
        if (fs.existsSync(distDir)) {
          fs.rmSync(distDir, { recursive: true, force: true })
        }
      },
    },
    react(),
    // 场景模块安全解析：场景目录可能被卸载/删除，动态 import 失败时返回空模块
    {
      name: 'scenario-safe-resolve',
      resolveId(source, importer) {
        // 仅处理 @scenarios 开头的模块，且仅在有 importer 的动态调用中
        if (source.startsWith('@scenarios/') && importer) {
          // 检查源文件是否来自 scenarios 目录
          const scenarioMatch = source.match(/^@scenarios\/([^/]+)/)
          if (scenarioMatch) {
            const scenarioDir = path.resolve(__dirname, `src/scenarios/${scenarioMatch[1]}`)
            if (!fs.existsSync(scenarioDir)) {
              // 场景目录不存在 → 返回空模块代理
              return `\0scenario-stub:${source}`
            }
          }
        }
        return null
      },
      load(id) {
        if (id.startsWith('\0scenario-stub:')) {
          const source = id.slice('\0scenario-stub:'.length)
          const namedMatch = source.match(/@scenarios\/[^/]+\/(.+)/)
          const info = namedMatch ? ` (${namedMatch[1]})` : ''
          console.warn(`[scenario-safe-resolve] Missing scenario module: ${source}${info} → using stub`)
          // 返回一个导出空对象的模块（兼容 default + named exports）
          return 'const stub = () => null; export default stub; export { stub };'
        }
        return null
      }
    },
    electron([
      {
        entry: 'src/main/appBootstrap.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: EXTERNAL_DEPS,
              onwarn(warning, warn) {
                if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        entry: 'src/main/search-engine/indexWorker.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/search-engine/indexWorker.ts',
              formats: ['cjs'],
              fileName: () => 'indexer.worker.js'
            },
            commonjsOptions: {
              ignoreDynamicRequires: true
            },
            rollupOptions: {
              external: ['electron', '@lancedb/lancedb', 'apache-arrow', 'web-tree-sitter', '@xenova/transformers', 'onnxruntime-node', 'onnxruntime-web'],
              onwarn(warning, warn) {
                if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        entry: 'src/main/preloadBridge.ts',
        onstart(options) { options.reload() },
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/preload',
            lib: {
              entry: 'src/main/preloadBridge.ts',
              formats: ['cjs'],
              fileName: () => 'preload.js'
            },
            rollupOptions: {
              output: {
                entryFileNames: 'preload.js'
              }
            }
          }
        }
      }
    ])
  ],
  resolve: { alias: aliases },
  base: './',
  build: {
    outDir: 'dist/renderer',
    rollupOptions: {
      // 多入口：主窗口 index.html + 悬浮头像窗口 avatar.html + 截图覆盖窗口 screenshot-overlay.html + 会议纪要窗口 meeting-notes.html + PPT 预览窗口 ppt-preview.html
      input: {
        main: path.resolve(__dirname, 'index.html'),
        avatar: path.resolve(__dirname, 'avatar.html'),
        'screenshot-overlay': path.resolve(__dirname, 'screenshot-overlay.html'),
        'meeting-notes': path.resolve(__dirname, 'meeting-notes.html'),
        'ppt-preview': path.resolve(__dirname, 'ppt-preview.html'),
      },
      // 忽略 web-tree-sitter 的 eval 警告（这是库内部使用，无法避免）
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) {
          return
        }
        warn(warning)
      },
      output: {
        manualChunks(id) {
          // Monaco Editor
          if (id.includes('monaco-editor') || id.includes('@monaco-editor/react')) {
            return 'monaco-editor'
          }
          // React 核心
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor'
          }
          // 状态管理 + 图标
          if (id.includes('node_modules/zustand') || id.includes('node_modules/lucide-react')) {
            return 'ui-core'
          }
          // 终端
          if (id.includes('@xterm/')) {
            return 'terminal'
          }
          // Markdown
          if (id.includes('react-markdown')) {
            return 'markdown-core'
          }
          // Syntax Highlighter（单独分包，按需加载）
          if (id.includes('react-syntax-highlighter')) {
            return 'syntax-highlighter'
          }
          // 动画
          if (id.includes('framer-motion')) {
            return 'animation'
          }
          // Agent 模块
          if (id.includes('/renderer/intelligence/')) {
            return 'agent'
          }
          if (id.includes('/renderer/components/explorer/')) {
            return 'sidebar'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500,
    minify: 'esbuild',
    target: 'esnext',
    cssCodeSplit: true,
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['monaco-editor']
  }
})
