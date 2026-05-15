import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/**/*.{test,spec,property}.{ts,tsx}',
      'tests/**/*.{test,spec,property}.{ts,tsx}'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*']
    },
    server: {
      deps: {
        inline: ['monaco-editor'],
      },
    },
    deps: {
      optimizer: {
        web: {
          enabled: false,
        },
      },
      interopDefault: true,
    },
  },
  resolve: {
    alias: {
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
    }
  }
})
