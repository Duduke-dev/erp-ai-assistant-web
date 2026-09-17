import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from '@/App.vue'
import router from '@/router'

// 样式入口：Tailwind 工具类 + 少量自定基线（不含 preflight，见该文件注释）
import '@/styles/tailwind.css'

createApp(App).use(createPinia()).use(router).mount('#app')
