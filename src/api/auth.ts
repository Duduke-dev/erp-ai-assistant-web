import { http } from '@/api/http'
import type { LoginPayload, LoginVO, UserVO } from '@/types/api'

/** 登录：成功返回 token 与用户信息（含权限码） */
export function login(payload: LoginPayload): Promise<LoginVO> {
  return http.post<LoginVO>('/api/auth/login', payload)
}

/** 登出：服务端销毁会话 */
export function logout(): Promise<void> {
  return http.post<void>('/api/auth/logout')
}

/** 当前登录用户：用于刷新页面后校验 token 是否仍然有效 */
export function currentUser(): Promise<UserVO> {
  return http.get<UserVO>('/api/auth/current')
}
