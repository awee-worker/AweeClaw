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
  // undici：AI 请求的自定义 dispatcher（bodyTimeout / headersTimeout 关闭 + TCP keepalive）
  // 依赖其 Agent 类实现。内部存在动态 require 与运行时探测，且已作为生产依赖随 asar 分发，
  // 保持 external 交由运行时从 node_modules 解析，避免 Rollup 打包破坏其内部结构
  'undici',
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
  // ffmpeg-static：包含平台预编译二进制，内部用 __dirname 定位 .ffmpeg 文件
  // 必须保持 external，否则打包后 __dirname 指向 dist/main 导致找不到二进制
  'ffmpeg-static',
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
  '@renderer-configuration': path.resolve(__dirname, './src/renderer/configuration'),
  '@scenario-system': path.resolve(__dirname, './src/scenario-system'),
  '@scenarios': path.resolve(__dirname, './src/scenarios'),
   'vscode-nls': path.resolve(__dirname, './node_modules/monaco-editor-nls'),
   // x-data-spreadsheet 是 UMD 包，源码有 ESM 兼容性问题和 LESS 依赖，
   // 通过别名强制指向 dist 预构建 JS 文件（注意：alias value 不带 .js，Vite 会自动补全）
   'x-data-spreadsheet': path.resolve(__dirname, './node_modules/x-data-spreadsheet/dist/xspreadsheet'),
}

/**
 * 共享的 Rollup 警告过滤（主进程 / 搜索索引 worker / 渲染进程三处构建复用）
 *
 * 静音两类已知且不可消除的提示：
 * 1. EVAL —— web-tree-sitter / onnxruntime-web 内部使用 eval，属第三方库实现，无法改动。
 * 2. dynamic import will not move module into another chunk ——
 *    模块同时被 static import 与 dynamic import 引用时，动态导入无法为它单独分包。
 *    主进程是单入口单 bundle，本就不产生分包；渲染进程虽为多入口 + manualChunks，
 *    但触发该提示的前提恰恰是「该模块已被静态导入」，即它本就在主 chunk 中，
 *    动态导入只是保留了延迟求值的语义（多用于打断循环依赖，见 bootstrap/globalCleanup.ts），
 *    并非性能分包诉求。真正按需分包的模块（monaco-editor / syntax-highlighter 等）
 *    不会被静态导入，也就不会触发该提示。
 *    把动态导入统一改成静态导入会改变求值时机，有引入循环依赖或 TDZ 报错的风险，收益为负。
 */
function shouldSilenceWarning(warning: { code?: string; id?: string; message?: string }): boolean {
  if (warning.code === 'EVAL' && (warning.id?.includes('web-tree-sitter') || warning.id?.includes('onnxruntime-web'))) {
    return true
  }
  if (warning.message?.includes('dynamic import will not move module into another chunk')) {
    return true
  }
  return false
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
              // node: 前缀的内置模块一律留给运行时解析。
              // Vite 判定「什么是内置模块」依据的是**构建时**那个 Node 的
              // builtinModules；node:sqlite（Node 22.5+ 才有）在旧构建环境下
              // 不在列表里，会被当成浏览器模块替换成空 stub，运行时解构
              // DatabaseSync 得到 undefined，报「DatabaseSync is not a constructor」。
              external: [...EXTERNAL_DEPS, /^node:/],
              onwarn(warning, warn) {
                if (shouldSilenceWarning(warning)) return
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
                if (shouldSilenceWarning(warning)) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        // 文档解析子进程（utilityProcess）：exceljs/mammoth/pdf-parse/officeparser/word-extractor
        // 的重计算在该进程执行，主进程通过 docParserProxy 派发，崩溃时内联回退
        entry: 'src/main/guard/docParser.worker.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/guard/docParser.worker.ts',
              formats: ['cjs'],
              fileName: () => 'docparser.worker.js'
            },
            commonjsOptions: {
              ignoreDynamicRequires: true
            },
            rollupOptions: {
              external: ['electron', 'exceljs', 'mammoth', 'pdf-parse', 'officeparser', 'word-extractor', 'xlsx', /^node:/],
              onwarn(warning, warn) {
                if (shouldSilenceWarning(warning)) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        // 本地嵌入推理子进程（utilityProcess）：@xenova/transformers 模型加载与推理
        // 在该进程执行，主进程通过 embedderProxy 派发，空闲自动退出释放模型内存
        entry: 'src/main/modules/perception/embedder.worker.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/modules/perception/embedder.worker.ts',
              formats: ['cjs'],
              fileName: () => 'embedder.worker.js'
            },
            commonjsOptions: {
              ignoreDynamicRequires: true
            },
            rollupOptions: {
              external: ['electron', '@xenova/transformers', 'onnxruntime-node', 'onnxruntime-web', /^node:/],
              onwarn(warning, warn) {
                if (shouldSilenceWarning(warning)) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        // LanceDB 子进程（utilityProcess）：@lancedb/lancedb native 模块加载
        // 与执行在该进程完成，主进程通过 lancedbProxy 派发，崩溃时内联回退
        entry: 'src/main/storage/lancedb.worker.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/storage/lancedb.worker.ts',
              formats: ['cjs'],
              fileName: () => 'lancedb.worker.js'
            },
            commonjsOptions: {
              ignoreDynamicRequires: true
            },
            rollupOptions: {
              external: ['electron', '@lancedb/lancedb', 'apache-arrow', /^node:/],
              onwarn(warning, warn) {
                if (shouldSilenceWarning(warning)) return
                warn(warning)
              }
            }
          }
        }
      },
      {
        // 邮件子进程（utilityProcess）：imapflow / mailparser 的加载与执行
        // 在该进程完成（含 IDLE 常驻连接），主进程通过 mailProxy 派发
        entry: 'src/main/storage/mail.worker.ts',
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/storage/mail.worker.ts',
              formats: ['cjs'],
              fileName: () => 'mail.worker.js'
            },
            commonjsOptions: {
              ignoreDynamicRequires: true
            },
            rollupOptions: {
              external: ['electron', 'imapflow', 'mailparser', 'nodemailer', /^node:/],
              onwarn(warning, warn) {
                if (shouldSilenceWarning(warning)) return
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
      // 多入口：主窗口 index.html + 悬浮头像 avatar.html + 会议纪要 meeting-notes.html + PPT 预览 ppt-preview.html + 项目执行 execution.html + VRM 桌面伴侣 vrm-companion.html
      input: {
        main: path.resolve(__dirname, 'index.html'),
        avatar: path.resolve(__dirname, 'avatar.html'),
        // 截图覆盖窗口已改为原生 JS（public/screenshot-overlay.html + .js），
        // 不再作为 Vite 多入口构建：避免 React vendor chunk 与 agent/ui-core 共享 chunk
        // 循环依赖导致打包后覆盖窗口 React 无法挂载（forwardRef undefined，蒙版不渲染）
        'meeting-notes': path.resolve(__dirname, 'meeting-notes.html'),
        'mail-center': path.resolve(__dirname, 'mail-center.html'),
        'ppt-preview': path.resolve(__dirname, 'ppt-preview.html'),
        execution: path.resolve(__dirname, 'execution.html'),
        'vrm-companion': path.resolve(__dirname, 'vrm-companion.html'),
      },
      onwarn(warning, warn) {
        if (shouldSilenceWarning(warning)) return
        warn(warning)
      },
      output: {
        manualChunks(id) {
          // @rollup/plugin-commonjs 的共享 interop helper 虚拟模块。
          // 若不单独分包，Rollup 会把它塞进第一个使用它的 chunk（agent），导致
          // react-vendor 为取 helper 而静态导入 agent，形成 react-vendor ↔ agent
          // 循环依赖，入口按 DFS 求值时 agent 子树内的 chunk 会在 react-vendor
          // 完成前执行，顶层 React 调用（forwardRef/memo/模块绑定）全部崩溃。
          // 独立分包后 cjs-helpers 是"叶子"chunk（无任何依赖），react-vendor
          // 只从叶子取 helper，不再进入循环，从根上消除问题。
          if (id.includes('commonjsHelpers')) {
            return 'cjs-helpers'
          }
          // React 核心 + 状态管理 + 图标 + @monaco-editor/react
          // 注意：zustand / lucide-react / @monaco-editor/react 必须与 react 同 chunk。
          // 曾单独拆出 ui-core：react-vendor 需要从 agent chunk 导入 Rollup 的
          // interopDefault helper，而 agent 又反向导入 react-vendor（拿 React），
          // 形成 chunk 循环依赖，浏览器按 DFS 求值时 ui-core 在 react-vendor 完成前
          // 先执行，lucide-react 顶层 React.forwardRef 拿到 undefined React，启动崩溃。
          // 同理 @monaco-editor/react 顶层调用 React.memo，且被 app-core 静态引用
          // （位于 agent 子树内，同样在 react-vendor 完成前求值），也并入 react-vendor。
          // 合并后这些模块与 React 初始化同 chunk 顺序执行，不再跨 chunk。
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/lucide-react') ||
            id.includes('@monaco-editor/react')
          ) {
            return 'react-vendor'
          }
          // Monaco Editor 核心（无顶层 React 调用，可独立分包）
          if (id.includes('node_modules/monaco-editor')) {
            return 'monaco-editor'
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
          // ===== Vite 运行时 helper（叶子 chunk，必须独立） =====
          //
          // __vitePreload 由 Vite 注入，用于给动态 import 的 chunk 预加载依赖。
          // 若并入引擎层，每个懒加载 chunk 都会为取它而静态依赖整套引擎。
          if (id.includes('vite/preload-helper') || id.includes('\0vite/')) {
            return 'vite-helper'
          }
          // ===== 引擎核心层 =====
          //
          // 曾按依赖层级拆成 boot-core / shared-core / app-core / mode-core /
          // scene-tools / agent 六个 chunk，但实测这六层之间互相静态引用，
          // 构成稠密循环（shared-core ↔ app-core ↔ agent ↔ mode-core ↔
          // scene-tools ↔ boot-core）。ESM 对跨 chunk 循环按 DFS 求值时，
          // 后求值的 chunk 顶层一旦读取前一个 chunk 尚未初始化的绑定，
          // 立即抛 "Cannot access 'x' before initialization"（TDZ）。
          // 且入口经 shared-core → app-core → … 早已静态加载整套引擎，
          // 分层并未带来入口瘦身收益，只会让构建产物在启动期随机崩溃。
          //
          // 合并为单一 engine-core 后，chunk 内模块按 Rollup 依赖序执行，
          // 不再有跨 chunk 循环，启动期安全。
          if (
            // agent：智能体子系统
            id.includes('/renderer/intelligence/') ||
            // scene-tools：场景工具桥接与状态预热
            id.includes('/renderer/components/scene-tools/') ||
            // shared：共享基础层
            id.includes('/src/shared/') ||
            // app-core：状态 / 适配器 / 配置 / 设置 / 基础 UI 组件
            id.includes('/renderer/state/') ||
            id.includes('/renderer/adapters/') ||
            id.includes('/renderer/config/') ||
            id.includes('/renderer/settings/') ||
            id.includes('/renderer/components/foundation/') ||
            // mode-core：场景 / 工作模式状态
            id.includes('/renderer/modes/') ||
            // boot-core：入口自举依赖（日志、常量、可信路径登记、
            // 共享依赖注入器等，此前单独分出去避免入口拖引擎，现已并入引擎层）
            /\/src\/shared\/(toolkit\/LogEngine|toolkit\/bootMetrics|appConstants)\.ts$/.test(id) ||
            /\/renderer\/intelligence\/toolkit\/trustedPathRegistry\.ts$/.test(id) ||
            id.includes('/renderer/intelligence/diagnostics/') ||
            /\/scenario-system\/core\/SharedDependencyProvider\.ts$/.test(id)
          ) {
            return 'engine-core'
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
  server: {
    port: 5170,
  },
  optimizeDeps: {
    include: ['monaco-editor']
  }
})
