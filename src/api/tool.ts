import { http } from '@/api/http'
import type {
  LlmToolQuery,
  LlmToolSaveDTO,
  LlmToolVO,
  PageResult,
  ToolCallLogQuery,
  ToolCallLogVO,
} from '@/types/api'

const BASE = '/api/tool'

/**
 * 把查询条件拼成 query string，**跳过空值**。
 * <p>
 * 空串必须跳过而不是传过去：后端的模糊匹配会把 `keyword=` 当成"匹配空字符串"，
 * 传空值等于给查询加了个无意义的条件。
 */
function toQueryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    params.append(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** ---- 动态 Tool 定义 ---- */

export function listLlmTools(query: LlmToolQuery): Promise<PageResult<LlmToolVO>> {
  return http.get<PageResult<LlmToolVO>>(`${BASE}/llm_tools${toQueryString(query)}`)
}

export function getLlmTool(id: number): Promise<LlmToolVO> {
  return http.get<LlmToolVO>(`${BASE}/llm_tools/${id}`)
}

export function createLlmTool(payload: LlmToolSaveDTO): Promise<number> {
  return http.post<number>(`${BASE}/llm_tools`, payload)
}

export function updateLlmTool(id: number, payload: LlmToolSaveDTO): Promise<void> {
  return http.put<void>(`${BASE}/llm_tools/${id}`, payload)
}

export function removeLlmTool(id: number): Promise<void> {
  return http.delete<void>(`${BASE}/llm_tools/${id}`)
}

/**
 * 手动重建注册表快照，返回刷新后注册表中的 Tool 总数。
 * <p>
 * 保存接口本身已自动刷新，这个入口是"直接改库后的人工兜底"。
 */
export function refreshToolRegistry(): Promise<number> {
  return http.post<number>(`${BASE}/registry/refresh`)
}

/** ---- 调用流水 ---- */

export function listToolCallLogs(query: ToolCallLogQuery): Promise<PageResult<ToolCallLogVO>> {
  return http.get<PageResult<ToolCallLogVO>>(`${BASE}/call_logs${toQueryString(query)}`)
}
