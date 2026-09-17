<script setup lang="ts">
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

/**
 * 应用外壳：左侧主导航 + 右侧内容区。
 *
 * 高度同样按「三层收口」约定处理（根 `h-dvh` + 中间层 `min-h-0` + `overflow-hidden`）：
 * 漏掉中间层的 `min-h-0`，内容变长时会把整个外壳撑高、溢出转交 body，
 * 表现为导航栏跟着页面一起滚。
 */
const router = useRouter()
const auth = useAuthStore()

/** 后续页面（计费 / 租户）也挂在这里 */
const NAV_ITEMS = [
  { name: 'chat', label: '对话' },
  { name: 'knowledge', label: '知识库' },
  { name: 'tools', label: '工具管理' },
] as const

async function handleLogout(): Promise<void> {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="flex h-dvh min-h-0 overflow-hidden bg-gray-50">
    <aside class="flex min-h-0 w-[168px] shrink-0 flex-col border-r border-gray-200 bg-white">
      <div class="shrink-0 px-4 py-3 text-[14px] font-medium text-gray-900">ERP 智能助手</div>

      <nav class="shrink-0 space-y-1 px-2">
        <RouterLink
          v-for="item in NAV_ITEMS"
          :key="item.name"
          :to="{ name: item.name }"
          class="block rounded-md px-3 py-2 text-[13px] no-underline transition-colors"
          :class="
            $route.name === item.name
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          "
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="mt-auto shrink-0 border-t border-gray-100 px-3 py-3">
        <div class="truncate text-[13px] text-gray-700">{{ auth.displayName || '未登录' }}</div>
        <div class="mt-0.5 truncate text-[12px] text-gray-400">{{ auth.profile?.entCode }}</div>
        <button class="mt-2 text-[12px] text-gray-400 hover:text-gray-700" @click="handleLogout">
          登出
        </button>
      </div>
    </aside>

    <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <RouterView />
    </section>
  </div>
</template>
