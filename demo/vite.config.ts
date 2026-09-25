import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  server: {
    // 开发态把 /api 代理到本地 apps/api；验收态由浏览器 harness 同源挂载，不经此代理。
    proxy: {
      '/api': {
        target: process.env.RISKFLOW_API_ORIGIN ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
})
