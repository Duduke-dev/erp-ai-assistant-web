import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import * as authApi from '@/api/auth'
import { getCachedProfile, setCachedProfile, setToken } from '@/api/http'
import type { LoginPayload, LoginVO } from '@/types/api'

/**
 * 登录状态。
 *
 * 用户信息同时写进 localStorage：刷新页面时先用缓存渲染，避免界面先闪一下"未登录"
 * 再跳回来。缓存的 token 是否仍有效由路由守卫调 `refresh()` 校验——
 * 缓存只负责"好看"，不负责"可信"。
 */
export const useAuthStore = defineStore('auth', () => {
  const profile = ref<LoginVO | null>(getCachedProfile<LoginVO>())

  const isAuthenticated = computed(() => profile.value !== null)

  const displayName = computed(() => profile.value?.realName || profile.value?.username || '')

  async function login(payload: LoginPayload): Promise<LoginVO> {
    const result = await authApi.login(payload)
    profile.value = result
    setToken(result.token)
    setCachedProfile(result)
    return result
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } catch {
      // 后端登出失败也必须清掉本地状态：否则用户会卡在"点登出没反应"的状态里
    } finally {
      clear()
    }
  }

  /** 用服务端信息校验当前会话，并同步最新的角色与权限 */
  async function refresh(): Promise<void> {
    const user = await authApi.currentUser()
    if (profile.value) {
      profile.value = { ...profile.value, ...user }
      setCachedProfile(profile.value)
    }
  }

  function clear(): void {
    profile.value = null
    setToken(null)
    setCachedProfile(null)
  }

  /** 权限判断：权限码由后端登录接口下发，前端只做显隐，真正的拦截在后端 */
  function hasPermission(code: string): boolean {
    return profile.value?.permissions?.includes(code) ?? false
  }

  return { profile, isAuthenticated, displayName, login, logout, refresh, clear, hasPermission }
})
