import { ApiError, authHeaders, getToken, http } from '@/api/http'
import type {
  AskPayload,
  AskVO,
  ChatMessageVO,
  ConversationVO,
  StreamCitations,
  StreamDelta,
  StreamDone,
  StreamError,
  StreamMeta,
  StreamWarning,
} from '@/types/api'

const STREAM_PATH = '/api/chat/ask/stream'

/** 流式回调。按事件名分发，新增事件类型不会影响已有回调 */
export interface StreamHandlers {
  onMeta?: (payload: StreamMeta) => void
  onDelta?: (text: string) => void
  onCitations?: (payload: StreamCitations) => void
  onWarning?: (payload: StreamWarning) => void
  onDone?: (payload: StreamDone) => void
  onError?: (payload: StreamError) => void
}

/**
 * 非流式提问。
 * <p>
 * 只有流式接口需要自己发请求（要读 ReadableStream），其余一律走 {@link http}——
 * 认证与错误处理只留一份实现，避免两处各自演化出不同的行为。
 */
export function ask(payload: AskPayload): Promise<AskVO> {
  return http.post<AskVO>('/api/chat/ask', payload)
}

export function listConversations(): Promise<ConversationVO[]> {
  return http.get<ConversationVO[]>('/api/chat/conversations')
}

export function listMessages(conversationId: string): Promise<ChatMessageVO[]> {
  return http.get<ChatMessageVO[]>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`)
}

export function deleteConversation(conversationId: string): Promise<void> {
  return http.delete<void>(`/api/chat/conversations/${encodeURIComponent(conversationId)}`)
}

/**
 * 流式提问。
 *
 * <h3>为什么不用 `EventSource`</h3>
 * `EventSource` 只能发 GET、且不允许自定义请求头。本接口是 **POST + JSON body +
 * `satoken` 头**，三样它都做不到。所以用 `fetch` + `ReadableStream` 自己解析 SSE——
 * 协议本身很小：`event:` / `data:` 两种行，空行分帧，`:` 开头的是心跳注释帧。
 *
 * @param signal 用于「停止生成」：中断 fetch 会让浏览器关闭连接，
 *               后端的 `onCompletion` 随即 dispose 上游模型调用（否则会继续计费）
 */
export async function askStream(
  payload: AskPayload,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken()
  let response: Response
  try {
    response = await fetch(STREAM_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? authHeaders() : {}),
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    // 主动中断不算错误：调用方（停止生成按钮）自己知道是它断的
    if (isAbortError(error)) {
      return
    }
    throw new ApiError(`网络请求失败：${(error as Error).message}`, 0)
  }

  if (!response.ok || !response.body) {
    // 准备阶段的失败（参数非法、配额不足）以普通 JSON 返回——
    // 那时 SSE 还没开始，后端还能给出正确的 HTTP 状态码
    const message = await readErrorMessage(response)
    if (response.status === 401) {
      throw new ApiError('登录已失效，请重新登录', 401)
    }
    throw new ApiError(message, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frameSeparator = /\r?\n\r?\n/
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })

      // 一次 read 可能拿到多帧、也可能只有半帧——按分隔符切，剩下的留在 buffer 里
      let match = frameSeparator.exec(buffer)
      while (match) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        dispatch(frame, handlers)
        match = frameSeparator.exec(buffer)
      }
    }
    // 流结束时若还有未以空行结尾的残留帧，也要处理掉
    if (buffer.trim()) {
      dispatch(buffer, handlers)
    }
  } catch (error) {
    if (!isAbortError(error)) {
      throw error
    }
  } finally {
    reader.releaseLock()
  }
}

/** 解析单个 SSE 帧并分发 */
function dispatch(frame: string, handlers: StreamHandlers): void {
  let eventName = 'message'
  const dataLines: string[] = []

  for (const rawLine of frame.split(/\r?\n/)) {
    if (rawLine.startsWith(':')) {
      // 心跳/注释帧
      continue
    }
    if (rawLine.startsWith('event:')) {
      eventName = rawLine.slice('event:'.length).trim()
      continue
    }
    if (rawLine.startsWith('data:')) {
      // 规范允许 `data: 值` 与 `data:值`，去掉至多一个前导空格
      dataLines.push(rawLine.slice('data:'.length).replace(/^ /, ''))
    }
  }

  if (dataLines.length === 0) {
    return
  }

  const raw = dataLines.join('\n')
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    // 解析不了就丢弃这一帧，不让它把整轮对话打断
    console.warn('[chat] 无法解析的 SSE 数据帧', raw)
    return
  }

  switch (eventName) {
    case 'meta':
      handlers.onMeta?.(payload as StreamMeta)
      break
    case 'delta':
      // 空帧是上游偶发行为，直接忽略
      if ((payload as StreamDelta).text) {
        handlers.onDelta?.((payload as StreamDelta).text)
      }
      break
    case 'citations':
      handlers.onCitations?.(payload as StreamCitations)
      break
    case 'warning':
      handlers.onWarning?.(payload as StreamWarning)
      break
    case 'done':
      handlers.onDone?.(payload as StreamDone)
      break
    case 'error':
      handlers.onError?.(payload as StreamError)
      break
    default:
      // 未知事件类型先忽略而不是报错：后端加事件时旧前端仍能工作
      break
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text) {
      return `请求失败（HTTP ${response.status}）`
    }
    const parsed = JSON.parse(text) as { message?: string }
    return parsed.message || `请求失败（HTTP ${response.status}）`
  } catch {
    return `请求失败（HTTP ${response.status}）`
  }
}

