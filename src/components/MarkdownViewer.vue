<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed } from 'vue'

/**
 * Markdown 渲染器。
 *
 * <h3>为什么必须净化</h3>
 * 渲染的是**模型输出**，而模型输出的内容里混着**知识库文档的原文**
 * （RAG 会把检索到的片段喂给模型）。也就是说这段 HTML 的来源链路上有"用户可间接影响的内容"，
 * 一旦文档里被塞进 `<script>` 或 `<img onerror=...>`，直接 innerHTML 就等于执行任意脚本。
 * 所以 marked 产出后**必须过一遍 DOMPurify**，这不是可选项。
 *
 * <h3>不做的事</h3>
 * 不启用原始 HTML 透传（`marked` 默认就不解析 html 块之外的裸标签，这里也不放开）、
 * 不渲染代码高亮（ERP 问答里代码块极少，为此再引一个高亮库不划算）。
 */
const props = defineProps<{ content: string }>()

marked.setOptions({
  // 换行按 Markdown 规范处理：单个换行不产生 <br>，避免模型偶尔断行把段落切碎
  breaks: false,
  gfm: true,
})

const renderedHtml = computed(() => {
  const raw = marked.parse(props.content ?? '', { async: false }) as string
  return DOMPurify.sanitize(raw, {
    // 只放行常规文档标签，明确排除 script/style/iframe/form 等
    ALLOWED_TAGS: [
      'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'a',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  })
})
</script>

<template>
  <div class="markdown-body" v-html="renderedHtml" />
</template>

<style scoped>
/*
 * 排版直接用元素选择器写，而不是在每个 Markdown 节点上挂 class：
 * 内容是 marked 生成的，管不到它的 class；scoped 会作用到本组件内的元素上，够用。
 */
.markdown-body {
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.markdown-body :deep(p) {
  margin: 0.4em 0;
}

.markdown-body :deep(p:first-child) {
  margin-top: 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-body :deep(h1) {
  font-size: 16px;
}

.markdown-body :deep(h2) {
  font-size: 15px;
}

.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-size: 14px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}

.markdown-body :deep(ul) {
  list-style: disc;
}

.markdown-body :deep(ol) {
  list-style: decimal;
}

.markdown-body :deep(li) {
  margin: 0.15em 0;
}

.markdown-body :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: 3px;
  background-color: rgba(0, 0, 0, 0.05);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.markdown-body :deep(pre) {
  margin: 0.5em 0;
  padding: 0.7em 0.9em;
  overflow-x: auto;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.05);
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown-body :deep(blockquote) {
  margin: 0.5em 0;
  padding-left: 0.8em;
  border-left: 3px solid #d1d5db;
  color: #4b5563;
}

.markdown-body :deep(table) {
  margin: 0.5em 0;
  border-collapse: collapse;
  font-size: 12px;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 0.35em 0.6em;
  border: 1px solid #e5e7eb;
  text-align: left;
}

.markdown-body :deep(th) {
  background-color: #f9fafb;
  font-weight: 600;
}

.markdown-body :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.markdown-body :deep(hr) {
  margin: 0.8em 0;
  border: none;
  border-top: 1px solid #e5e7eb;
}
</style>
