<script setup lang="ts">
import {
  NButton,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NPopconfirm,
  NTag,
  NTabPane,
  NTabs,
  NUpload,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns, UploadCustomRequestOptions } from 'naive-ui'
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { ApiError } from '@/api/http'
import * as knowledgeApi from '@/api/knowledge'
import type {
  DocumentParseDeadLetterVO,
  KnowledgeBaseVO,
  KnowledgeDocumentVO,
  RagSearchResult,
} from '@/types/api'

/**
 * 知识库管理页。
 *
 * <h3>为什么上传后要"重新拉列表"而不是直接用返回值</h3>
 * 后端上传接口返回 void：异步模式下它只代表"已受理"。新文档的 documentId
 * 只能从列表里拿到——拉到之后才对「状态为 processing」的文档启动进度轮询。
 * 这也顺带覆盖了"进页面时已有文档正在解析"的情况。
 */
const message = useMessage()

const knowledgeBases = ref<KnowledgeBaseVO[]>([])
const currentId = ref<number | null>(null)
const documents = ref<KnowledgeDocumentVO[]>([])
const loadingDocuments = ref(false)
const uploading = ref(false)
const activeTab = ref('documents')

const currentKnowledgeBase = computed(
  () => knowledgeBases.value.find((item) => item.id === currentId.value) ?? null,
)

const searchQuery = ref('')
const searchResults = ref<RagSearchResult[]>([])
const searching = ref(false)

const deadLetters = ref<DocumentParseDeadLetterVO[]>([])
const loadingDeadLetters = ref(false)
/** 死信条数做红点提示：失败任务不该藏在二级页签里没人看见 */
const pendingDeadLetters = computed(
  () => deadLetters.value.filter((item) => item.status === 'pending').length,
)

const showKnowledgeBaseModal = ref(false)
const editingId = ref<number | null>(null)
const knowledgeBaseForm = reactive({ name: '', description: '' })

const MSG_NO_KNOWLEDGE_BASE = '请先选择或新建一个知识库'

/** 阶段文案。processing 之外的状态直接用自己的语义，不必绕 stage */
const STAGE_LABELS: Record<string, string> = {
  queued: '已入队',
  parsing: '解析中',
  embedding: '向量化中',
  ready: '就绪',
  failed: '失败',
}

function stageLabel(document: KnowledgeDocumentVO): string {
  if (document.status === 'ready') {
    return '就绪'
  }
  if (document.status === 'failed') {
    return document.errorMessage ? `失败：${document.errorMessage}` : '失败'
  }
  if (document.status === 'superseded') {
    return '已被新版本取代'
  }
  if (document.status === 'deleted') {
    return '已删除'
  }
  // 历史数据没有 stage（那时还没这个字段），回退到状态本身而不是编一个阶段出来
  return document.stage ? (STAGE_LABELS[document.stage] ?? document.stage) : '处理中'
}

function stageTagType(document: KnowledgeDocumentVO): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (document.status === 'ready') {
    return 'success'
  }
  if (document.status === 'failed') {
    return 'error'
  }
  if (document.status === 'superseded' || document.status === 'deleted') {
    return 'default'
  }
  return 'info'
}

/** ---- 进度轮询 ---- */

const pollTimers = new Map<string, number>()

function stopPolling(documentId: string): void {
  const timer = pollTimers.get(documentId)
  if (timer !== undefined) {
    window.clearInterval(timer)
    pollTimers.delete(documentId)
  }
}

function stopAllPolling(): void {
  for (const documentId of [...pollTimers.keys()]) {
    stopPolling(documentId)
  }
}

/**
 * 对处理中的文档开始轮询。
 * <p>
 * 只拉单个文档而不是整个列表：列表里有全部文档与向量无关字段，
 * 2 秒一次纯属浪费。终态（ready/failed/…）到达即停，不做无谓轮询。
 */
function ensurePolling(documentId: string): void {
  const knowledgeBaseId = currentId.value
  if (pollTimers.has(documentId) || knowledgeBaseId == null) {
    return
  }
  const timer = window.setInterval(async () => {
    try {
      const updated = await knowledgeApi.getDocument(knowledgeBaseId, documentId)
      const index = documents.value.findIndex((item) => item.documentId === documentId)
      if (index >= 0) {
        documents.value[index] = updated
      }
      if (updated.status !== 'processing') {
        stopPolling(documentId)
        // 库的 documentCount 只统计 ready，状态变了要同步刷新
        await loadKnowledgeBases()
      }
    } catch {
      // 轮询期间出错（例如库被别处删了）就停掉，避免持续刷错误
      stopPolling(documentId)
    }
  }, 2000)
  pollTimers.set(documentId, timer)
}

/** ---- 数据加载 ---- */

async function loadKnowledgeBases(): Promise<void> {
  try {
    const list = await knowledgeApi.listKnowledgeBases()
    knowledgeBases.value = list
    if (currentId.value == null || !list.some((item) => item.id === currentId.value)) {
      currentId.value = list.find((item) => item.isDefault)?.id ?? list[0]?.id ?? null
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 401)) {
      message.error(error instanceof ApiError ? error.message : '加载知识库失败')
    }
  }
}

async function loadDocuments(): Promise<void> {
  stopAllPolling()
  if (currentId.value == null) {
    documents.value = []
    return
  }
  loadingDocuments.value = true
  try {
    documents.value = await knowledgeApi.listDocuments(currentId.value)
    // 进页面时可能已有文档正在解析，一并接管轮询
    for (const document of documents.value) {
      if (document.status === 'processing') {
        ensurePolling(document.documentId)
      }
    }
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载文档失败')
  } finally {
    loadingDocuments.value = false
  }
}

async function loadDeadLetters(): Promise<void> {
  loadingDeadLetters.value = true
  try {
    deadLetters.value = await knowledgeApi.listDeadLetters()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载死信队列失败')
  } finally {
    loadingDeadLetters.value = false
  }
}

async function selectKnowledgeBase(id: number): Promise<void> {
  if (id === currentId.value) {
    return
  }
  currentId.value = id
  searchResults.value = []
  await loadDocuments()
}

/** ---- 知识库增改删 ---- */

function openCreateKnowledgeBase(): void {
  editingId.value = null
  knowledgeBaseForm.name = ''
  knowledgeBaseForm.description = ''
  showKnowledgeBaseModal.value = true
}

function openEditKnowledgeBase(item: KnowledgeBaseVO): void {
  editingId.value = item.id
  knowledgeBaseForm.name = item.name
  knowledgeBaseForm.description = item.description ?? ''
  showKnowledgeBaseModal.value = true
}

async function submitKnowledgeBase(): Promise<void> {
  const name = knowledgeBaseForm.name.trim()
  if (!name) {
    message.warning('知识库名称不能为空')
    return
  }
  try {
    if (editingId.value == null) {
      const created = await knowledgeApi.createKnowledgeBase({
        name,
        description: knowledgeBaseForm.description.trim() || null,
      })
      await loadKnowledgeBases()
      await selectKnowledgeBase(created)
      message.success('知识库已创建')
    } else {
      await knowledgeApi.updateKnowledgeBase(editingId.value, {
        name,
        description: knowledgeBaseForm.description.trim() || null,
      })
      await loadKnowledgeBases()
      message.success('知识库已更新')
    }
    showKnowledgeBaseModal.value = false
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败')
  }
}

async function removeKnowledgeBase(id: number): Promise<void> {
  try {
    await knowledgeApi.removeKnowledgeBase(id)
    if (currentId.value === id) {
      currentId.value = null
    }
    await loadKnowledgeBases()
    await loadDocuments()
    message.success('知识库已删除')
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

/** ---- 文档 ---- */

async function handleUpload(options: UploadCustomRequestOptions): Promise<void> {
  const knowledgeBaseId = currentId.value
  if (knowledgeBaseId == null) {
    message.warning(MSG_NO_KNOWLEDGE_BASE)
    options.onError()
    return
  }
  const file = options.file.file
  if (!file) {
    // NUpload 的 file 字段是可空的，直接断言会在运行时报出难以定位的错
    message.error('未取到文件内容，请重新选择')
    options.onError()
    return
  }
  uploading.value = true
  try {
    await knowledgeApi.uploadDocument(knowledgeBaseId, file)
    message.success('已提交，解析与向量化在后台进行')
    options.onFinish()
    // 关键：重新拉列表才能拿到新文档的 documentId，进而开始轮询进度
    await loadDocuments()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '上传失败')
    options.onError()
  } finally {
    uploading.value = false
  }
}

async function removeDocument(document: KnowledgeDocumentVO): Promise<void> {
  const knowledgeBaseId = currentId.value
  if (knowledgeBaseId == null) {
    return
  }
  try {
    stopPolling(document.documentId)
    await knowledgeApi.deleteDocument(knowledgeBaseId, document.documentId)
    message.success('文档已删除（原件与向量一并清理）')
    await loadDocuments()
    await loadKnowledgeBases()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

/** ---- 检索自测 ---- */

async function runSearch(): Promise<void> {
  const knowledgeBaseId = currentId.value
  if (knowledgeBaseId == null) {
    message.warning(MSG_NO_KNOWLEDGE_BASE)
    return
  }
  const query = searchQuery.value.trim()
  if (!query) {
    message.warning('请输入检索内容')
    return
  }
  searching.value = true
  try {
    searchResults.value = await knowledgeApi.searchKnowledgeBase(knowledgeBaseId, query, 5)
    if (searchResults.value.length === 0) {
      message.info('没有召回任何分片：可能是阈值偏高，或文档尚未 ready')
    }
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '检索失败')
  } finally {
    searching.value = false
  }
}

/** ---- 死信 ---- */

async function retryDeadLetter(item: DocumentParseDeadLetterVO): Promise<void> {
  try {
    await knowledgeApi.retryDeadLetter(item.id)
    message.success('已重投，文档会重新进入处理流程')
    await loadDeadLetters()
    // 重投会把文档状态重置为 processing，刷新列表以便接上进度轮询
    await loadDocuments()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '重投失败')
  }
}

async function discardDeadLetter(item: DocumentParseDeadLetterVO): Promise<void> {
  try {
    await knowledgeApi.discardDeadLetter(item.id)
    message.success('已丢弃（记录保留）')
    await loadDeadLetters()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '丢弃失败')
  }
}

/** ---- 表格列 ---- */

const documentColumns: DataTableColumns<KnowledgeDocumentVO> = [
  { title: '来源文件', key: 'title', ellipsis: { tooltip: true } },
  { title: '版本', key: 'version', width: 70 },
  {
    title: '状态',
    key: 'status',
    width: 200,
    render: (row) => h(NTag, { size: 'small', type: stageTagType(row) }, { default: () => stageLabel(row) }),
  },
  {
    title: '分片',
    key: 'chunkCount',
    width: 80,
    render: (row) => row.chunkCount ?? 0,
  },
  {
    title: '需重建索引',
    key: 'requiresReindex',
    width: 110,
    render: (row) =>
      row.requiresReindex
        ? h(NTag, { size: 'small', type: 'warning' }, { default: () => '换过模型' })
        : '',
  },
  {
    title: '操作',
    key: 'actions',
    width: 90,
    render: (row) =>
      h(
        NPopconfirm,
        { onPositiveClick: () => removeDocument(row) },
        {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => '删除' }),
          default: () => '删除该文档？原件与向量会一并清理',
        },
      ),
  },
]

const deadLetterColumns: DataTableColumns<DocumentParseDeadLetterVO> = [
  { title: '文件', key: 'fileName', ellipsis: { tooltip: true } },
  { title: '版本', key: 'version', width: 70 },
  {
    title: '失败原因',
    key: 'errorMessage',
    ellipsis: { tooltip: true },
    render: (row) => row.errorMessage ?? '—',
  },
  { title: '状态', key: 'status', width: 90 },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row) =>
      row.status !== 'pending'
        ? h('span', { class: 'text-[12px] text-gray-400' }, '已处置')
        : h('div', { class: 'flex gap-1' }, [
            h(
              NButton,
              { size: 'tiny', quaternary: true, type: 'primary', onClick: () => retryDeadLetter(row) },
              { default: () => '重投' },
            ),
            h(
              NButton,
              { size: 'tiny', quaternary: true, onClick: () => discardDeadLetter(row) },
              { default: () => '丢弃' },
            ),
          ]),
  },
]

onMounted(async () => {
  await loadKnowledgeBases()
  await loadDocuments()
  await loadDeadLetters()
})

onBeforeUnmount(() => {
  stopAllPolling()
})
</script>

<template>
  <div class="flex h-full min-h-0 overflow-hidden bg-gray-50">
    <!-- 知识库列表 -->
    <aside class="flex min-h-0 w-[220px] shrink-0 flex-col border-r border-gray-200 bg-white">
      <div class="shrink-0 p-3">
        <NButton block secondary @click="openCreateKnowledgeBase">新建知识库</NButton>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <NEmpty v-if="knowledgeBases.length === 0" size="small" description="还没有知识库" class="mt-8" />
        <div
          v-for="item in knowledgeBases"
          :key="item.id"
          class="group mb-1 flex cursor-pointer items-center gap-1 rounded-md px-2 py-2 text-[13px] hover:bg-gray-50"
          :class="item.id === currentId ? 'bg-gray-100' : ''"
          @click="selectKnowledgeBase(item.id)"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-gray-800">
              {{ item.name }}
              <span v-if="item.isDefault" class="ml-1 text-[11px] text-gray-400">默认</span>
            </div>
            <div class="text-[11px] text-gray-400">可检索文档 {{ item.documentCount ?? 0 }} 份</div>
          </div>
          <button
            class="hidden shrink-0 rounded px-1 text-gray-400 hover:bg-gray-200 group-hover:block"
            title="编辑"
            @click.stop="openEditKnowledgeBase(item)"
          >
            ✎
          </button>
          <NPopconfirm @positive-click="removeKnowledgeBase(item.id)">
            <template #trigger>
              <button
                class="hidden shrink-0 rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 group-hover:block"
                title="删除"
                @click.stop
              >
                ×
              </button>
            </template>
            删除该知识库？
          </NPopconfirm>
        </div>
      </div>
    </aside>

    <!-- 主区 -->
    <section class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div class="min-w-0">
          <div class="truncate text-[14px] font-medium text-gray-900">
            {{ currentKnowledgeBase?.name ?? '未选择知识库' }}
          </div>
          <div class="truncate text-[12px] text-gray-400">
            {{ currentKnowledgeBase?.description || '上传文档后系统会自动解析、分块并写入向量库' }}
          </div>
        </div>
        <NUpload
          :show-file-list="false"
          :custom-request="handleUpload"
          :disabled="currentId == null || uploading"
        >
          <NButton type="primary" :loading="uploading" :disabled="currentId == null">
            上传文档
          </NButton>
        </NUpload>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <NTabs v-model:value="activeTab" type="line" animated>
          <NTabPane name="documents" :tab="`文档（${documents.length}）`">
            <NDataTable
              :columns="documentColumns"
              :data="documents"
              :loading="loadingDocuments"
              :row-key="(row: KnowledgeDocumentVO) => row.documentId"
              :bordered="false"
              size="small"
            />
            <p class="mt-3 text-[12px] leading-5 text-gray-400">
              异步解析期间状态会依次经过「已入队 → 解析中 → 向量化中 → 就绪」，页面每 2 秒自动刷新；
              停在某一阶段不动，通常说明该步骤卡住了（向量化最慢）。
            </p>
          </NTabPane>

          <NTabPane name="search" tab="检索自测">
            <div class="flex items-end gap-2">
              <NInput
                v-model:value="searchQuery"
                placeholder="输入一个问题，看实际召回哪些分片与相似度"
                @keydown.enter.exact.prevent="runSearch"
              />
              <NButton type="primary" :loading="searching" @click="runSearch">检索</NButton>
            </div>
            <p class="mt-2 text-[12px] text-gray-400">
              纯向量检索：不调用大模型、不计费，用于判断阈值与分块是否合适。
            </p>

            <div v-if="searchResults.length > 0" class="mt-4 space-y-2">
              <div
                v-for="(item, index) in searchResults"
                :key="`${item.documentId}-${item.chunkIndex}-${index}`"
                class="rounded-lg border border-gray-200 bg-white p-3"
              >
                <div class="flex items-center justify-between text-[12px] text-gray-500">
                  <span class="truncate">
                    #{{ index + 1 }} · {{ item.source }}
                    <span v-if="item.chunkIndex != null" class="text-gray-400">（第 {{ item.chunkIndex }} 片）</span>
                  </span>
                  <span class="shrink-0 pl-2 text-gray-700">
                    相似度 {{ item.score != null ? item.score.toFixed(4) : '—' }}
                  </span>
                </div>
                <div class="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-gray-700">
                  {{ item.content }}
                </div>
              </div>
            </div>
          </NTabPane>

          <NTabPane name="deadLetters">
            <template #tab>
              <span>死信队列</span>
              <NTag v-if="pendingDeadLetters > 0" size="tiny" type="error" class="ml-1">
                {{ pendingDeadLetters }}
              </NTag>
            </template>
            <NButton size="small" secondary :loading="loadingDeadLetters" class="mb-3" @click="loadDeadLetters">
              刷新
            </NButton>
            <NDataTable
              :columns="deadLetterColumns"
              :data="deadLetters"
              :loading="loadingDeadLetters"
              :row-key="(row: DocumentParseDeadLetterVO) => row.id"
              :bordered="false"
              size="small"
            />
            <p class="mt-3 text-[12px] leading-5 text-gray-400">
              解析失败且不再重试的任务会进入这里。重投会把文档状态重置为处理中并重新入队；
              丢弃只是停止处理，记录会保留作为故障证据。
            </p>
          </NTabPane>
        </NTabs>
      </div>
    </section>

    <NModal
      v-model:show="showKnowledgeBaseModal"
      preset="card"
      :title="editingId == null ? '新建知识库' : '编辑知识库'"
      class="max-w-[420px]"
    >
      <NForm>
        <NFormItem label="名称">
          <NInput v-model:value="knowledgeBaseForm.name" placeholder="如：设备操作手册" />
        </NFormItem>
        <NFormItem label="描述">
          <NInput
            v-model:value="knowledgeBaseForm.description"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="选填"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showKnowledgeBaseModal = false">取消</NButton>
          <NButton type="primary" @click="submitKnowledgeBase">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
