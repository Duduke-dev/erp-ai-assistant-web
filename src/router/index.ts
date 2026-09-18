import { createRouter, createWebHistory } from 'vue-router'

import { onUnauthorized } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

/**
 * 路由表。
 *
 * 页面用动态 import：首屏只加载登录页与对话页外壳，知识库/计费等页面
 * 后续加进来时不会拖慢首屏。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      // 业务页统一挂在应用外壳下：导航栏只实现一次，页面本身只管自己的内容区
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: { name: 'chat' } },
        { path: 'chat', name: 'chat', component: () => import('@/views/ChatView.vue') },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('@/views/KnowledgeView.vue'),
        },
        {
          path: 'tools',
          name: 'tools',
          component: () => import('@/views/ToolView.vue'),
        },
        {
          path: 'billing',
          name: 'billing',
          component: () => import('@/views/BillingView.vue'),
        },
        {
          path: 'platform',
          name: 'platform',
          component: () => import('@/views/PlatformView.vue'),
        },
      ],
    },
    // 未匹配路径回对话页：这是本项目的主入口，比停在 404 更有用
    { path: '/:pathMatch(.*)*', redirect: { name: 'chat' } },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) {
    return auth.isAuthenticated ? { name: 'chat' } : true
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

/**
 * 服务端会话失效（401）时统一跳登录页。
 *
 * 注册在路由之后、回调里才取 store：模块加载顺序不确定，
 * 在回调外取 store 可能在 pinia 初始化之前执行。
 */
onUnauthorized(() => {
  const auth = useAuthStore()
  auth.clear()
  const current = router.currentRoute.value
  if (current.name !== 'login') {
    router.replace({ name: 'login', query: { redirect: current.fullPath } })
  }
})

export default router
