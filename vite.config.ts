import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 后端开发地址。仅影响本地开发：生产部署时 /api 由网关或反代转发，
 * 前端产物本身只是一堆静态文件。
 *
 * 可用环境变量覆盖，便于「后端不在默认端口」的场景——
 * 例如临时起一个 8081 实例做联调或自动化验证，不必去占用别人的 8080：
 * <pre>VITE_BACKEND_ORIGIN=http://localhost:8081 bun run dev</pre>
 */
const BACKEND_ORIGIN = process.env.VITE_BACKEND_ORIGIN ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 与后端 8080 错开。改动这里不需要同步后端任何配置。
    port: 5173,
    proxy: {
      /**
       * 走 dev server 代理而不是让浏览器直连后端：
       * ① 同源，省掉一套 CORS 配置；
       * ② SSE 经同源连接，不受浏览器对跨域流式响应的额外限制。
       */
      '/api': {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 关掉中间层缓冲：否则流式回答要等整段生成完才一次性到达前端，
            // 表现为"按钮点了半天没反应，然后整段蹦出来"
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
      },
    },
  },
})
