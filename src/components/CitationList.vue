<script setup lang="ts">
import type { RagCitation } from '@/types/api'

/**
 * 引用证据列表。
 *
 * 这些引用是后端**校验过**的：只会出现回答里真实引用到的、且属于本轮召回范围的编号。
 * 所以这里直接展示即可，不需要前端再做一次过滤。
 */
defineProps<{
  citations: RagCitation[]
  ragDocCount?: number | null
}>()
</script>

<template>
  <div v-if="citations.length" class="mt-3 border-t border-gray-100 pt-2">
    <div class="mb-1 text-[12px] text-gray-400">
      引用来源
      <span v-if="ragDocCount != null">（本轮召回 {{ ragDocCount }} 个分片）</span>
    </div>
    <ol class="space-y-1">
      <li v-for="citation in citations" :key="citation.index" class="flex gap-2 text-[12px] leading-5">
        <span class="mt-[1px] shrink-0 rounded bg-gray-100 px-1 text-gray-600">[{{ citation.index }}]</span>
        <div class="min-w-0">
          <div class="truncate text-gray-700">{{ citation.source }}</div>
          <div class="text-gray-400">{{ citation.excerpt }}</div>
        </div>
      </li>
    </ol>
  </div>
</template>
