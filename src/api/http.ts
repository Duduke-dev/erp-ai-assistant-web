import type { Result } from '@/types/api'

/**
 * 统一请求封装。
 *
 * 用原生 `fetch` 而不是 axios：流式接口必须用 fetch（EventSource 只能 GET、且不能带
 * 自定义头，而本项目的流式提问是 POST + `satoken` 头）。既然流式已经要写，
 * 普通请求再引入一套拦截器就是两份认证与错误处理逻辑——不如只有一份。
 */

const TOKEN_KEY = 'erp.assistant.token'
const PROFILE_KEY = 'erp.assistant.profile'

/** header 名与后端 `sa-token.token-name` 一致。改后端配置时这里必须同步 */
const TOKEN_HEADER = 'satoken'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

/** 登录用户信息缓存：刷新页面时先用它渲染，避免闪一下"未登录" */
export function getCachedProfile<T>(): T | null {
  const raw = localStorage.getItem(PROFILE_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    // 缓存损坏时按未登录处理，而不是让整个应用起不来
    localStorage.removeItem(PROFILE_KEY)
    return null
  }
}

export function setCachedProfile(profile: unknown | null): void {
  if (profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } else {
    localStorage.removeItem(PROFILE_KEY)
  }
}

/** 认证与请求头：流式接口也要用，所以单独导出 */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { [TOKEN_HEADER]: token } : {}
}

/**
 * 业务/协议错误。`code` 为 HTTP 状态码；业务失败时沿用响应信封里的 code。
 *
 * 字段显式声明而不是用构造器参数属性（`constructor(readonly code: number)`）：
 * 后者在运行时需要生成赋值代码，与 `erasableSyntaxOnly` 编译选项冲突——
 * 该选项要求 TS 语法能整体擦除，便于用 Node 直接跑 TS 源码。
 */
export class ApiError extends Error {
  readonly code: number

  constructor(message: string, code: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * 401 的处理回调，由启动时注册（跳登录页）。
 * 这里不直接 import router：api 层依赖路由会让循环依赖变得很容易发生。
 */
let unauthorizedHandler: (() => void) | null = null

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

function notifyUnauthorized(): void {
  setToken(null)
  setCachedProfile(null)
  unauthorizedHandler?.()
}

/**
 * 发起请求并把信封拆开。
 *
 * @throws ApiError 网络失败、HTTP 非 2xx、或信封 `code !== 200`
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // FormData 的 Content-Type 必须留给浏览器生成（要带 boundary），手写会让后端解析不出文件
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }
  if (!(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch (error) {
    // fetch 只在网络层失败时 reject；业务错误都在下面的分支里
    throw new ApiError(`网络请求失败：${(error as Error).message}`, 0)
  }

  if (response.status === 401) {
    notifyUnauthorized()
    throw new ApiError('登录已失效，请重新登录', 401)
  }

  const text = await response.text()
  // 204 或空响应体：接口语义是"成功且无返回"
  if (!text) {
    if (!response.ok) {
      throw new ApiError(`请求失败（HTTP ${response.status}）`, response.status)
    }
    return undefined as T
  }

  let envelope: Result<T>
  try {
    envelope = JSON.parse(text) as Result<T>
  } catch {
    // 非 JSON 响应说明打到的不是本后端（例如被代理吞掉的 502 页面）
    throw new ApiError(`响应不是合法 JSON（HTTP ${response.status}）`, response.status)
  }

  if (envelope.code !== 200) {
    throw new ApiError(envelope.message || `请求失败（code ${envelope.code}）`, envelope.code)
  }
  return envelope.data
}

/**
 * 上传文件（multipart/form-data）。
 *
 * **刻意不复用 `request`**：那里硬编码了 `Content-Type: application/json`。
 * multipart 的 Content-Type 必须由浏览器自己生成（要带 boundary），
 * 手写或沿用 JSON 头会让后端解析不出文件——症状是"文件字段为 null"，且不报格式错。
 */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: 'POST', body: form })
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
