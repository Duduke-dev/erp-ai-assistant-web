/**
 * 后端接口契约。
 *
 * 这里**手写**而不是从后端生成：接口数量有限，手写能让「字段是谁在用」保持可见；
 * 自动生成的类型往往一次导出全部、没人知道哪些是死字段。
 * 每个类型都对应后端的一个 DTO/VO，改动后端时需同步这里。
 */

/** 统一响应信封：由后端 `GlobalResponseAdvice` 包装，成功 code = 200 */
export interface Result<T> {
  code: number
  message: string
  data: T
}

/** 登录请求。`entCode` 必填——用户名只在租户内唯一 */
export interface LoginPayload {
  entCode: string
  username: string
  password: string
}

/** 登录结果：`LoginVO` */
export interface LoginVO {
  token: string
  userId: number
  entCode: string
  username: string
  realName: string | null
  roles: string[]
  permissions: string[]
}

/** 当前登录用户：`UserVO`。与 `LoginVO` 的区别是**不含 token** */
export interface UserVO {
  userId: number
  entCode: string
  username: string
  realName: string | null
  roles: string[]
  permissions: string[]
}

/** 提问模式：auto（业务+知识）/ data（强约束取业务数据）/ knowledge（纯知识库） */
export type ChatMode = 'auto' | 'data' | 'knowledge'

/** 提问请求：`AskDTO` */
export interface AskPayload {
  conversationId?: string | null
  question: string
  mode: ChatMode
  knowledgeBaseId?: number | null
}

/** 引用证据：`RagCitation`。`index` 与回答正文里的 `[n]` 编号对应 */
export interface RagCitation {
  index: number
  source: string
  excerpt: string
}

/** 图表类型：与后端 `ChartType` 的 code 一一对应（共 8 种） */
export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'heatmap' | 'funnel' | 'gauge'

/** 一条数据系列 */
export interface ChartSeries {
  name: string
  values: number[]
}

/**
 * 图表协议：`ChartSpec`。
 *
 * **纯数据**——前端只按 `type` 选择渲染方式，绝不执行其中任何内容。
 * 这是后端刻意设计的约束：即使模型输出被污染，最坏也只是画出一张奇怪的图。
 */
export interface ChartSpec {
  type: ChartType
  title: string
  categories: string[]
  series: ChartSeries[]
}

/** 非流式提问结果：`AskVO` */
export interface AskVO {
  conversationId: string
  messageId: number
  answer: string
  mode: ChatMode
  citations: RagCitation[]
  ragDocCount: number
  chart: ChartSpec | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  elapsedMs: number
}

/** 会话：`ConversationVO` */
export interface ConversationVO {
  conversationId: string
  title: string
  modelId: string | null
  messageCount: number
  totalTokens: number
  createdAt: string
  updatedAt: string
}

/** 历史消息：`ChatMessageVO`。历史里不含图表——图表只在本轮流式返回中出现 */
export interface ChatMessageVO {
  id: number
  role: 'user' | 'assistant'
  content: string
  mode: ChatMode | null
  status: string | null
  errorMessage: string | null
  citations: RagCitation[]
  ragDocCount: number | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  elapsedMs: number | null
  createdAt: string
}

/** ---- SSE 事件负载（事件名见后端 `StreamEventType`）---- */

export interface StreamMeta {
  conversationId: string
  mode: ChatMode
}

export interface StreamDelta {
  text: string
}

export interface StreamCitations {
  knowledgeBaseId: number
  ragDocCount: number
  citations: RagCitation[]
}

export interface StreamError {
  code: string
  message: string
}

export interface StreamDone {
  conversationId: string
  messageId: number
  status: string
  elapsedMs: number
  totalTokens: number
}

/** ---- 知识库 ---- */

/** 知识库：`KnowledgeBaseVO`。`documentCount` 只统计 ready 版本，与检索可命中范围一致 */
export interface KnowledgeBaseVO {
  id: number
  name: string
  description: string | null
  isDefault: boolean | null
  status: string
  documentCount: number | null
  createdAt: string
  updatedAt: string
}

/** 知识库新增/更新入参：`KnowledgeBaseSaveDTO` */
export interface KnowledgeBaseSaveDTO {
  name: string
  description?: string | null
  isDefault?: boolean | null
}

/**
 * 解析阶段：processing 状态下的细分。
 * <p>
 * 与后端 `KnowledgeDocumentService.STAGE_*` 一一对应；历史行可能为 null
 * （它们没有经历过阶段流转），此时展示上回退到 `status`。
 */
export type DocumentStage = 'queued' | 'parsing' | 'embedding' | 'ready' | 'failed' | null

/** 知识文档：`KnowledgeDocumentVO` */
export interface KnowledgeDocumentVO {
  id: number
  knowledgeBaseId: number
  documentId: string
  title: string
  version: number
  status: string
  stage: DocumentStage
  fileSize: number | null
  contentType: string | null
  chunkCount: number | null
  embeddingModel: string | null
  requiresReindex: boolean | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** 解析死信：`DocumentParseDeadLetterVO` */
export interface DocumentParseDeadLetterVO {
  id: number
  documentId: string | null
  knowledgeBaseId: number | null
  version: number | null
  fileName: string | null
  objectKey: string | null
  errorMessage: string | null
  status: string
  createdAt: string
  updatedAt: string
}

/** 纯向量检索结果：`RagSearchResult`。不调模型、不计费，用于验证入库效果 */
export interface RagSearchResult {
  content: string
  source: string
  documentId: string
  chunkIndex: number | null
  score: number | null
}

/** ---- 工具管理 ---- */

/**
 * MyBatis-Plus 的分页对象。
 * <p>
 * 后端返回的字段比这里多（`orders` / `optimizeCountSql` 等），
 * 只声明前端真正用到的部分——多声明等于给自己维护没人读的字段。
 */
export interface PageResult<T> {
  records: T[]
  total: number
  size: number
  current: number
  pages: number
}

/**
 * 动态 Tool 定义：`LlmToolVO`。
 * <p>
 * 这张表是**全局配置**（无 ent_code）：所有租户共用同一份 Tool 定义，
 * 隔离发生在执行时注入 ent_code。
 */
export interface LlmToolVO {
  id: number
  toolName: string
  toolDesc: string | null
  inputSchema: string | null
  sqlTemplate: string | null
  tableAlias: string | null
  resultLimit: number | null
  status: string
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 动态 Tool 新增/更新入参：`LlmToolSaveDTO`。主键来自 URL，故不含 id */
export interface LlmToolSaveDTO {
  toolName: string
  toolDesc?: string | null
  inputSchema?: string | null
  sqlTemplate?: string | null
  tableAlias?: string | null
  resultLimit?: number | null
  status?: string | null
  remark?: string | null
}

/** 动态 Tool 分页查询条件：`LlmToolQueryDTO` */
export interface LlmToolQuery {
  keyword?: string
  status?: string
  pageNo?: number
  pageSize?: number
}

/** Tool 调用流水：`ToolCallLogVO`。`arguments` 是模型实际入参，排查"模型为什么这么调"的关键证据 */
export interface ToolCallLogVO {
  id: number
  conversationId: string | null
  traceId: string | null
  toolName: string
  toolSource: string | null
  modelName: string | null
  mode: string | null
  arguments: string | null
  status: string | null
  elapsedMs: number | null
  resultCount: number | null
  errorSummary: string | null
  createdAt: string
}

/** Tool 调用流水查询条件：`ToolCallLogQueryDTO` */
export interface ToolCallLogQuery {
  toolName?: string
  status?: string
  toolSource?: string
  traceId?: string
  pageNo?: number
  pageSize?: number
}
