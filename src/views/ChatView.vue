<script setup lang="ts">
import { NButton, NEmpty, NInput, NPopconfirm, NSelect, NSpin, useMessage } from 'naive-ui'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import * as chatApi from '@/api/chat'
import { ApiError } from '@/api/http'
import ChartPanel from '@/components/ChartPanel.vue'
import CitationList from '@/components/CitationList.vue'
import type { ChatMessageVO, ChartSpec, ConversationVO, RagCitation, StreamDone } from '@/types/api'
import { formatRelativeTime } from '@/utils/time'

/** 界面上的消息。与后端 `ChatMessageVO` 的区别：多了流式状态与耗时摘要 */
interface UiMessage {
  key: string
  role: 'user' | 'assistant'
  content: string
  citations: RagCitation[]
  chart: ChartSpec | null
  status: 'streaming' | 'completed' | 'cancelled' | 'failed'
  summary: string | null
}

const message = useMessage()

const MODE_OPTIONS = [
  { label: 'auto · 业务 + 知识', value: 'auto' },
  { label: 'data · 仅业务数据', value: 'data' },
  { label: 'knowledge · 仅知识库', value: 'knowledge' },
]

const mode = ref<'auto' | 'data' | 'knowledge'>('auto')
const conversations = ref<ConversationVO[]>([])
const currentConversationId = ref<string | null>(null)
const messages = ref<UiMessage[]>([])
const question = ref('')
const sending = ref(false)
const loadingHistory = ref(false)
const scrollArea = ref<HTMLDivElement | null>(null)

/**
 * 相对时间的刷新基准。
 * <p>
 * 必须定时更新：不刷新的话「刚刚」会一直停在"刚刚"，看不出对话是什么时候的。
 * 30 秒一次足够（分钟级粒度），也不至于让组件频繁重渲染。
 */
const now = ref(new Date())

let clockTimer: number | null = null

/** 消息 key 只需在本次会话内唯一，用自增序号比 UUID 便宜且便于调试 */
let keySeed = 0

/** 「停止生成」用：中断 fetch 会让浏览器断开连接，后端随即 dispose 上游模型调用 */
let controller: AbortController | null = null

function nextKey(prefix: string): string {
  keySeed += 1
  return `${prefix}-${keySeed}`
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const element = scrollArea.value
  if (element) {
    element.scrollTop = element.scrollHeight
  }
}

async function loadConversations(): Promise<void> {
  try {
    conversations.value = await chatApi.listConversations()
    // 列表刚变化过，顺手把时间基准推到当下：新会话/刚发完消息能立刻显示「刚刚」
    now.value = new Date()
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 401)) {
      message.error(error instanceof ApiError ? error.message : '加载会话列表失败')
    }
  }
}

async function selectConversation(conversationId: string): Promise<void> {
  if (sending.value) {
    message.warning('当前回答仍在生成，请先点击停止')
    return
  }
  if (conversationId === currentConversationId.value) {
    return
  }
  currentConversationId.value = conversationId
  loadingHistory.value = true
  try {
    const history = await chatApi.listMessages(conversationId)
    messages.value = history.map(toUiMessage)
    await scrollToBottom()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载历史消息失败')
  } finally {
    loadingHistory.value = false
  }
}

function startNewConversation(): void {
  if (sending.value) {
    message.warning('当前回答仍在生成，请先点击停止')
    return
  }
  currentConversationId.value = null
  messages.value = []
}

async function removeConversation(conversationId: string): Promise<void> {
  try {
    await chatApi.deleteConversation(conversationId)
    if (currentConversationId.value === conversationId) {
      startNewConversation()
    }
    await loadConversations()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除会话失败')
  }
}

async function send(): Promise<void> {
  const text = question.value.trim()
  if (!text || sending.value) {
    return
  }

  const assistantKey = nextKey('assistant')
  messages.value.push({
    key: nextKey('user'),
    role: 'user',
    content: text,
    citations: [],
    chart: null,
    status: 'completed',
    summary: null,
  })
  messages.value.push({
    key: assistantKey,
    role: 'assistant',
    content: '',
    citations: [],
    chart: null,
    status: 'streaming',
    summary: null,
  })

  question.value = ''
  sending.value = true
  controller = new AbortController()
  await scrollToBottom()

  const current = (): UiMessage | undefined => messages.value.find((item) => item.key === assistantKey)

  try {
    await chatApi.askStream(
      { conversationId: currentConversationId.value, question: text, mode: mode.value },
      {
        onMeta: (meta) => {
          // 新建会话时后端在首个事件里回传标识，立刻记下以免后续追问又建新会话
          currentConversationId.value = meta.conversationId
        },
        onDelta: (delta) => {
          const target = current()
          if (target) {
            target.content += delta
            void scrollToBottom()
          }
        },
        onCitations: (payload) => {
          const target = current()
          if (target) {
            target.citations = payload.citations
          }
        },
        onChart: (chart) => {
          const target = current()
          if (target) {
            target.chart = chart
          }
        },
        onDone: (done) => finish(current(), done),
        onError: (payload) => {
          const target = current()
          if (target) {
            target.status = 'failed'
            target.content = target.content || payload.message
          }
          message.error(payload.message)
        },
      },
      controller.signal,
    )
    // 走到这里说明流已结束；若还没被 done/error 收口，说明是用户点了停止
    const target = current()
    if (target && target.status === 'streaming') {
      target.status = 'cancelled'
      target.summary = '已停止'
    }
  } catch (error) {
    const target = current()
    const text = error instanceof ApiError ? error.message : '请求失败，请稍后重试'
    if (target) {
      target.status = 'failed'
      target.content = target.content || text
    }
    message.error(text)
  } finally {
    sending.value = false
    controller = null
    await loadConversations()
    await scrollToBottom()
  }
}

function finish(target: UiMessage | undefined, done: StreamDone): void {
  if (!target) {
    return
  }
  target.status = done.status === 'completed' ? 'completed' : done.status === 'cancelled' ? 'cancelled' : 'failed'
  target.summary = `${done.elapsedMs} ms · ${done.totalTokens ?? 0} tokens`
  if (done.conversationId) {
    currentConversationId.value = done.conversationId
  }
}

function stop(): void {
  controller?.abort()
}

/** 历史消息 → 界面消息。历史里没有图表（图表只在本轮流式返回中出现），故置空 */
function toUiMessage(message: ChatMessageVO): UiMessage {
  return {
    key: nextKey('history'),
    role: message.role,
    content: message.content ?? '',
    citations: message.citations ?? [],
    chart: null,
    status: 'completed',
    summary: message.elapsedMs != null ? `${message.elapsedMs} ms · ${message.totalTokens ?? 0} tokens` : null,
  }
}

onMounted(async () => {
  await loadConversations()
  clockTimer = window.setInterval(() => {
    now.value = new Date()
  }, 30_000)
})

onBeforeUnmount(() => {
  // 离开页面必须清掉：定时器持有组件引用，不清会一直跑下去
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
    clockTimer = null
  }
})
</script>

<template>
  <!--
    高度由外层 AppLayout 的内容区提供（那里锁了 h-dvh），这里用 h-full 承接。
    三层收口照旧：本层 min-h-0 + overflow-hidden，内部的 aside/section 也各自 min-h-0——
    flex 子项的 min-height 默认是 auto，漏一层就会被内容撑高、溢出转交 body，
    表现为"左右两栏一起滚"。
  -->
  <div class="flex h-full min-h-0 overflow-hidden bg-gray-50">
    <!-- 会话栏 -->
    <aside class="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-gray-200 bg-white">
      <div class="shrink-0 p-3">
        <NButton block secondary :disabled="sending" @click="startNewConversation">新建对话</NButton>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <NEmpty v-if="conversations.length === 0" size="small" description="还没有会话" class="mt-8" />
        <div
          v-for="conversation in conversations"
          :key="conversation.conversationId"
          class="group mb-1 flex cursor-pointer items-center gap-1 rounded-md px-2 py-2 text-[13px] hover:bg-gray-50"
          :class="conversation.conversationId === currentConversationId ? 'bg-gray-100' : ''"
          @click="selectConversation(conversation.conversationId)"
        >
          <span class="min-w-0 flex-1 truncate text-gray-700">{{ conversation.title || '未命名对话' }}</span>
          <!--
            相对时间常显；鼠标悬停时让位给删除按钮——
            这一栏只有 240px，时间和操作按钮并排放不下，且删除本来就该是次要动作。
          -->
          <span class="shrink-0 text-[11px] text-gray-400 group-hover:hidden">
            {{ formatRelativeTime(conversation.updatedAt, now) }}
          </span>
          <NPopconfirm @positive-click="removeConversation(conversation.conversationId)">
            <template #trigger>
              <button
                class="hidden shrink-0 rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 group-hover:block"
                title="删除会话"
                @click.stop
              >
                ×
              </button>
            </template>
            删除该会话？（消息仍保留在库中供审计）
          </NPopconfirm>
        </div>
      </div>
    </aside>

    <!-- 对话区 -->
    <section class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div class="flex items-center gap-3">
          <NSelect v-model:value="mode" :options="MODE_OPTIONS" size="small" class="w-[190px]" />
          <span class="text-[12px] text-gray-400">auto 挂业务工具；knowledge 只查知识库</span>
        </div>
      </header>

      <div ref="scrollArea" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div v-if="messages.length === 0" class="flex h-full items-center justify-center">
          <NEmpty description="问点什么吧，例如「上个月的销售额是多少」" />
        </div>

        <div v-else class="mx-auto max-w-[820px] space-y-4">
          <div v-for="item in messages" :key="item.key" class="flex" :class="item.role === 'user' ? 'justify-end' : 'justify-start'">
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-6"
              :class="item.role === 'user' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-800'"
            >
              <div class="whitespace-pre-wrap break-words">{{ item.content }}</div>

              <div v-if="item.role === 'assistant' && item.status === 'streaming'" class="mt-1 text-[12px] text-gray-400">
                正在生成…
              </div>
              <div v-if="item.summary" class="mt-1 text-[12px] text-gray-400">{{ item.summary }}</div>
              <div v-if="item.status === 'failed'" class="mt-1 text-[12px] text-red-500">生成失败</div>

              <ChartPanel v-if="item.chart" :chart="item.chart" class="mt-3" />
              <CitationList :citations="item.citations" />
            </div>
          </div>

          <div v-if="loadingHistory" class="flex justify-center py-4">
            <NSpin size="small" />
          </div>
        </div>
      </div>

      <footer class="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        <div class="mx-auto flex max-w-[820px] items-end gap-2">
          <NInput
            v-model:value="question"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 4 }"
            placeholder="输入问题，Enter 发送 / Shift + Enter 换行"
            :disabled="sending"
            @keydown.enter.exact.prevent="send"
          />
          <NButton v-if="sending" type="warning" @click="stop">停止</NButton>
          <NButton v-else type="primary" :disabled="!question.trim()" @click="send">发送</NButton>
        </div>
      </footer>
    </section>
  </div>
</template>
