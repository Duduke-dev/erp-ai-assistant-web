import { http, postForm } from '@/api/http'
import type {
  DocumentParseDeadLetterVO,
  KnowledgeBaseSaveDTO,
  KnowledgeBaseVO,
  KnowledgeDocumentVO,
  RagSearchResult,
} from '@/types/api'

const BASE = '/api/biz/knowledge_bases'

/** 死信接口**不在**知识库路径下：它是跨知识库的运维视图 */
const DEAD_LETTER_BASE = '/api/biz/document_parse_dead_letters'

/** ---- 知识库 ---- */

export function listKnowledgeBases(): Promise<KnowledgeBaseVO[]> {
  return http.get<KnowledgeBaseVO[]>(BASE)
}

export function createKnowledgeBase(payload: KnowledgeBaseSaveDTO): Promise<number> {
  return http.post<number>(BASE, payload)
}

export function updateKnowledgeBase(id: number, payload: KnowledgeBaseSaveDTO): Promise<void> {
  return http.put<void>(`${BASE}/${id}`, payload)
}

export function removeKnowledgeBase(id: number): Promise<void> {
  return http.delete<void>(`${BASE}/${id}`)
}

/** ---- 文档 ---- */

export function listDocuments(knowledgeBaseId: number): Promise<KnowledgeDocumentVO[]> {
  return http.get<KnowledgeDocumentVO[]>(`${BASE}/${knowledgeBaseId}/documents`)
}

/** 单文档最新版本。解析进度轮询用它，比反复拉整个列表轻 */
export function getDocument(knowledgeBaseId: number, documentId: string): Promise<KnowledgeDocumentVO> {
  return http.get<KnowledgeDocumentVO>(
    `${BASE}/${knowledgeBaseId}/documents/${encodeURIComponent(documentId)}`,
  )
}

/**
 * 上传文档。
 * <p>
 * 后端返回 void：异步模式下接口只代表"已受理"。上传成功后要**重新拉列表**
 * 才能拿到新的 documentId（以及它当前的处理状态），再去轮询进度。
 *
 * @param documentId 传入表示替换该文档内容（生成新版本）；不传则按来源名归并
 */
export function uploadDocument(
  knowledgeBaseId: number,
  file: File,
  documentId?: string,
): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  if (documentId) {
    form.append('documentId', documentId)
  }
  return postForm<void>(`${BASE}/${knowledgeBaseId}/documents`, form)
}

export function deleteDocument(knowledgeBaseId: number, documentId: string): Promise<void> {
  return http.delete<void>(
    `${BASE}/${knowledgeBaseId}/documents/${encodeURIComponent(documentId)}`,
  )
}

/** 纯向量检索：不调模型、不计费，用于验证入库效果与排查召回质量 */
export function searchKnowledgeBase(
  knowledgeBaseId: number,
  query: string,
  topK?: number,
): Promise<RagSearchResult[]> {
  const params = new URLSearchParams({ query })
  if (topK != null) {
    params.append('topK', String(topK))
  }
  return http.get<RagSearchResult[]>(`${BASE}/${knowledgeBaseId}/search?${params.toString()}`)
}

/** ---- 死信 ---- */

export function listDeadLetters(): Promise<DocumentParseDeadLetterVO[]> {
  return http.get<DocumentParseDeadLetterVO[]>(DEAD_LETTER_BASE)
}

/**
 * 重投：后端会把文档版本重置为 processing 后原样发回队列。
 * 重投后需要重新拉文档列表——那条文档会重新变成"处理中"。
 */
export function retryDeadLetter(id: number): Promise<void> {
  return http.post<void>(`${DEAD_LETTER_BASE}/${id}/retry`)
}

/** 丢弃：不再处理，记录保留（死信是故障证据，不做物理删除） */
export function discardDeadLetter(id: number): Promise<void> {
  return http.post<void>(`${DEAD_LETTER_BASE}/${id}/discard`)
}
