/**
 * 临时调试用 Vite 配置：只跑渲染进程，用于在浏览器里验证 VRM 渲染/待机动作。
 * 不含 electron 插件，避免干扰正在运行的应用实例。
 */
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

/**
 * 把 resources/vrm 目录暴露为 /__vrm__/，供调试页加载内置 VRM 模型与 .vrma 动作。
 *
 * 单纯用 publicDir 不够：resources/vrm 同时被 electron-builder 作为 extraResources
 * 打包，挪到 public 会改变产物路径；这里用中间件旁路挂载，不动原有目录布局。
 */
function vrmDebugAssets(): Plugin {
  const root = path.resolve(__dirname, 'resources/vrm')
  return {
    name: 'vrm-debug-assets',
    configureServer(server) {
      server.middlewares.use('/__vrm__', (req, res, next) => {
        const url = (req.url || '').split('?')[0]
        const rel = decodeURIComponent(url).replace(/^\/+/, '')
        const target = path.join(root, rel)

        // 目录（带 ?list 请求）返回文件名列表，便于调试页自动发现动作
        if (req.url?.includes('list=')) {
          try {
            const files = fs.readdirSync(target).filter((f) => f.endsWith('.vrma'))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(files))
          } catch {
            res.statusCode = 404
            res.end('[]')
          }
          return
        }

        try {
          if (!fs.statSync(target).isFile()) return next()
        } catch {
          return next()
        }
        res.setHeader('Content-Type', 'application/octet-stream')
        fs.createReadStream(target).pipe(res)
      })
    },
  }
}

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
  '@toolkit': path.resolve(__dirname, './src/shared/toolkit'),
}

export default defineConfig({
  plugins: [react(), vrmDebugAssets()],
  resolve: { alias: aliases },
  server: { port: 5199, strictPort: true },
})
