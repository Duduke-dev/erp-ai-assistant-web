import { http } from '@/api/http'
import type { TenantSaveDTO, TenantUserVO, TenantVO, UserSaveDTO } from '@/types/api'

/**
 * 平台管理接口：跨租户的租户管理 + 本租户的用户管理。
 * <p>
 * 两者权限码完全不同，也刻意不做成"一个平台模块"：
 * 租户是**跨租户**的平台视角（`platform:tenant:*`），
 * 用户是**本租户**范围（`user:*`，由租户插件自动限定），
 * 后者在任意租户下都能用，前者仅平台管理员。
 */

/** ---- 租户（平台视角）---- */

export function listTenants(): Promise<TenantVO[]> {
  return http.get<TenantVO[]>('/api/platform/tenants')
}

export function createTenant(payload: TenantSaveDTO): Promise<number> {
  return http.post<number>('/api/platform/tenants', payload)
}

/**
 * 更新租户：`entCode` 不生效（它是隔离键，改编码等于换租户）。
 * 停用/启用通过 `status` 表达——**没有删除接口**，物理删除会留下无法审计的孤儿数据。
 */
export function updateTenant(id: number, payload: TenantSaveDTO): Promise<void> {
  return http.put<void>(`/api/platform/tenants/${id}`, payload)
}

/** ---- 本租户用户 ---- */

export function listUsers(): Promise<TenantUserVO[]> {
  return http.get<TenantUserVO[]>('/api/users')
}

export function createUser(payload: UserSaveDTO): Promise<number> {
  return http.post<number>('/api/users', payload)
}

/** 更新用户：用户名不可改；`password` 为空表示不改密码 */
export function updateUser(id: number, payload: UserSaveDTO): Promise<void> {
  return http.put<void>(`/api/users/${id}`, payload)
}

export function removeUser(id: number): Promise<void> {
  return http.delete<void>(`/api/users/${id}`)
}
