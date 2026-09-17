<script setup lang="ts">
import {
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NSelect,
  NTabPane,
  NTabs,
  NTag,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { computed, h, onMounted, reactive, ref } from 'vue'

import { ApiError } from '@/api/http'
import * as toolApi from '@/api/tool'
import { useAuthStore } from '@/stores/auth'
import type { LlmToolSaveDTO, LlmToolVO, PageResult, ToolCallLogVO } from '@/types/api'
import { formatRelativeTime } from '@/utils/time'

/**
 * 工具管理页。
 *
 * <h3>两类资源放同一页</h3>
 * 「动态 Tool 定义」与「调用流水」是同一个运维动作的两面：改完定义自然要看它有没有被调、
 * 调得对不对。拆成两个菜单反而要来回切。
 *
 * <h3>写操作按权限码隐藏</h3>
 * 后端用 `tool:llm:save` 拦写操作，前端只做**显隐**——权限判定不能只靠前端。
 */
const message = useMessage()
const auth = useAuthStore()

const canSave = computed(() => auth.hasPermission('tool:llm:save'))

const activeTab = ref('tools')

/** ---- 动态 Tool 定义 ---- */

const toolQuery = reactive({ keyword: '', status: '', pageNo: 1, pageSize: 10 })
const toolPage = ref<PageResult<LlmToolVO>>({ records: [], total: 0, size: 10, current: 1, pages: 0 })
const loadingTools = ref(false)

const STATUS_OPTIONS = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
]

/** 只有 active 会被注册表加载 —— 停用等于"留着但不给模型看" */
function statusTagType(status: string): 'success' | 'default' {
  return status === 'active' ? 'success' : 'default'
}

async function loadTools(): Promise<void> {
  loadingTools.value = true
  try {
    toolPage.value = await toolApi.listLlmTools({ ...toolQuery })
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载 Tool 列表失败')
  } finally {
    loadingTools.value = false
  }
}

const toolPagination = computed(() => ({
  page: toolQuery.pageNo,
  pageSize: toolQuery.pageSize,
  itemCount: toolPage.value.total,
  showSizePicker: true,
  pageSizes: [10, 20, 50],
  // Naive 的 RenderPrefix 给的 itemCount 是可空类型，必须照着它的签名写
  prefix: ({ itemCount }: { itemCount: number | undefined }) => `共 ${itemCount ?? 0} 条`,
  onChange: (page: number) => {
    toolQuery.pageNo = page
    void loadTools()
  },
  onUpdatePageSize: (size: number) => {
    toolQuery.pageSize = size
    toolQuery.pageNo = 1
    void loadTools()
  },
}))

function search(): void {
  toolQuery.pageNo = 1
  void loadTools()
}

/** ---- 编辑弹窗 ---- */

const toolModalVisible = ref(false)
const editingToolId = ref<number | null>(null)
const savingTool = ref(false)

const EMPTY_FORM: Required<LlmToolSaveDTO> = {
  toolName: '',
  toolDesc: '',
  inputSchema: '',
  sqlTemplate: '',
  tableAlias: '',
  resultLimit: 100,
  status: 'active',
  remark: '',
}

const toolForm = reactive<Required<LlmToolSaveDTO>>({ ...EMPTY_FORM })

function openCreateTool(): void {
  editingToolId.value = null
  Object.assign(toolForm, EMPTY_FORM)
  toolModalVisible.value = true
}

function openEditTool(row: LlmToolVO): void {
  editingToolId.value = row.id
  Object.assign(toolForm, {
    toolName: row.toolName ?? '',
    toolDesc: row.toolDesc ?? '',
    inputSchema: row.inputSchema ?? '',
    sqlTemplate: row.sqlTemplate ?? '',
    tableAlias: row.tableAlias ?? '',
    resultLimit: row.resultLimit ?? 100,
    status: row.status ?? 'active',
    remark: row.remark ?? '',
  })
  toolModalVisible.value = true
}

async function submitTool(): Promise<void> {
  if (!toolForm.toolName.trim()) {
    message.warning('Tool 名称不能为空')
    return
  }
  savingTool.value = true
  try {
    const payload: LlmToolSaveDTO = { ...toolForm, toolName: toolForm.toolName.trim() }
    if (editingToolId.value == null) {
      await toolApi.createLlmTool(payload)
      message.success('已创建，注册表已自动刷新')
    } else {
      await toolApi.updateLlmTool(editingToolId.value, payload)
      message.success('已更新，注册表已自动刷新')
    }
    toolModalVisible.value = false
    await loadTools()
  } catch (error) {
    // 后端会把校验细节（SQL 模板、schema、别名规则）放在 message 里，直接透出
    message.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingTool.value = false
  }
}

async function removeTool(row: LlmToolVO): Promise<void> {
  try {
    await toolApi.removeLlmTool(row.id)
    message.success('已删除')
    await loadTools()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

async function refreshRegistry(): Promise<void> {
  try {
    const total = await toolApi.refreshToolRegistry()
    message.success(`注册表已刷新，当前共 ${total} 个 Tool`)
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '刷新失败')
  }
}

/** ---- 调用流水 ---- */

const logQuery = reactive({ toolName: '', status: '', toolSource: '', pageNo: 1, pageSize: 10 })
const logPage = ref<PageResult<ToolCallLogVO>>({ records: [], total: 0, size: 10, current: 1, pages: 0 })
const loadingLogs = ref(false)

const LOG_STATUS_OPTIONS = [
  { label: '成功', value: 'success' },
  { label: '失败', value: 'error' },
]

const TOOL_SOURCE_OPTIONS = [
  { label: '代码 Tool', value: 'code' },
  { label: '动态 Tool（SQL）', value: 'database' },
]

async function loadLogs(): Promise<void> {
  loadingLogs.value = true
  try {
    logPage.value = await toolApi.listToolCallLogs({ ...logQuery })
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载调用流水失败')
  } finally {
    loadingLogs.value = false
  }
}

const logPagination = computed(() => ({
  page: logQuery.pageNo,
  pageSize: logQuery.pageSize,
  itemCount: logPage.value.total,
  showSizePicker: true,
  pageSizes: [10, 20, 50],
  prefix: ({ itemCount }: { itemCount: number | undefined }) => `共 ${itemCount ?? 0} 条`,
  onChange: (page: number) => {
    logQuery.pageNo = page
    void loadLogs()
  },
  onUpdatePageSize: (size: number) => {
    logQuery.pageSize = size
    logQuery.pageNo = 1
    void loadLogs()
  },
}))

function searchLogs(): void {
  logQuery.pageNo = 1
  void loadLogs()
}

/** ---- 表格列 ---- */

const toolColumns = computed<DataTableColumns<LlmToolVO>>(() => [
  {
    title: 'Tool 名称',
    key: 'toolName',
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.toolName),
  },
  { title: '说明（模型据此判断何时调用）', key: 'toolDesc', ellipsis: { tooltip: true } },
  { title: '别名', key: 'tableAlias', width: 90, render: (row) => row.tableAlias || '—' },
  { title: '行数上限', key: 'resultLimit', width: 90 },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (row) => h(NTag, { size: 'small', type: statusTagType(row.status) }, { default: () => row.status }),
  },
  {
    title: '操作',
    key: 'actions',
    width: canSave.value ? 130 : 0,
    render: (row) =>
      canSave.value
        ? h('div', { class: 'flex gap-1' }, [
            h(
              NButton,
              { size: 'tiny', quaternary: true, onClick: () => openEditTool(row) },
              { default: () => '编辑' },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => removeTool(row) },
              {
                trigger: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => '删除' }),
                default: () => '删除该 Tool？删除后模型将不再能调用它',
              },
            ),
          ])
        : [],
  },
])

const logColumns: DataTableColumns<ToolCallLogVO> = [
  {
    title: '时间',
    key: 'createdAt',
    width: 100,
    render: (row) => formatRelativeTime(row.createdAt),
  },
  {
    title: 'Tool',
    key: 'toolName',
    width: 180,
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.toolName),
  },
  {
    title: '来源',
    key: 'toolSource',
    width: 110,
    render: (row) => (row.toolSource === 'database' ? '动态 SQL' : row.toolSource === 'code' ? '代码 Tool' : '—'),
  },
  { title: '模式', key: 'mode', width: 90, render: (row) => row.mode ?? '—' },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.status === 'success' ? 'success' : 'error' },
        { default: () => (row.status === 'success' ? '成功' : '失败') },
      ),
  },
  { title: '耗时', key: 'elapsedMs', width: 90, render: (row) => (row.elapsedMs != null ? `${row.elapsedMs} ms` : '—') },
  { title: '结果行数', key: 'resultCount', width: 90, render: (row) => row.resultCount ?? '—' },
  {
    title: '模型入参',
    key: 'arguments',
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'text-[12px] text-gray-600' }, row.arguments || '—'),
  },
  {
    title: '错误摘要',
    key: 'errorSummary',
    ellipsis: { tooltip: true },
    render: (row) => row.errorSummary || '—',
  },
]

onMounted(async () => {
  await loadTools()
  await loadLogs()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
    <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
      <div>
        <div class="text-[14px] font-medium text-gray-900">工具管理</div>
        <div class="text-[12px] text-gray-400">
          动态 Tool 定义与调用流水。定义是<b>全局配置</b>，所有租户共用同一份
        </div>
      </div>
      <NButton v-if="canSave" secondary size="small" @click="refreshRegistry">刷新注册表快照</NButton>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="tools" tab="动态 Tool 定义">
          <div class="mb-3 flex items-center gap-2">
            <NInput
              v-model:value="toolQuery.keyword"
              placeholder="按名称或说明搜索"
              class="max-w-[280px]"
              clearable
              @keydown.enter.exact.prevent="search"
            />
            <NSelect
              v-model:value="toolQuery.status"
              :options="STATUS_OPTIONS"
              placeholder="全部状态"
              clearable
              class="w-[140px]"
            />
            <NButton @click="search">查询</NButton>
            <div class="flex-1" />
            <NButton v-if="canSave" type="primary" @click="openCreateTool">新建 Tool</NButton>
          </div>

          <NDataTable
            remote
            :columns="toolColumns"
            :data="toolPage.records"
            :loading="loadingTools"
            :pagination="toolPagination"
            :row-key="(row: LlmToolVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-3 text-[12px] leading-5 text-gray-400">
            只有「启用」的 Tool 会进入注册表；SQL 模板、入参 schema 与别名规则由后端统一校验，
            保存失败时错误信息会直接说明是哪一项不合规。
          </p>
        </NTabPane>

        <NTabPane name="logs" tab="调用流水">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <NInput
              v-model:value="logQuery.toolName"
              placeholder="按 Tool 名精确匹配"
              class="max-w-[220px]"
              clearable
              @keydown.enter.exact.prevent="searchLogs"
            />
            <NSelect
              v-model:value="logQuery.status"
              :options="LOG_STATUS_OPTIONS"
              placeholder="全部结果"
              clearable
              class="w-[130px]"
            />
            <NSelect
              v-model:value="logQuery.toolSource"
              :options="TOOL_SOURCE_OPTIONS"
              placeholder="全部来源"
              clearable
              class="w-[150px]"
            />
            <NButton @click="searchLogs">查询</NButton>
          </div>

          <NDataTable
            remote
            :columns="logColumns"
            :data="logPage.records"
            :loading="loadingLogs"
            :pagination="logPagination"
            :row-key="(row: ToolCallLogVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-3 text-[12px] leading-5 text-gray-400">
            流水自动限定在本租户内。「模型入参」是模型实际传入的参数——排查"它为什么这么调"时看这里。
          </p>
        </NTabPane>
      </NTabs>
    </div>

    <NModal
      v-model:show="toolModalVisible"
      preset="card"
      :title="editingToolId == null ? '新建 Tool' : '编辑 Tool'"
      class="max-w-[640px]"
    >
      <NForm label-placement="top">
        <NFormItem label="Tool 名称（下发给模型，全局唯一）">
          <NInput v-model:value="toolForm.toolName" placeholder="如 query_inventory_by_warehouse" />
        </NFormItem>
        <NFormItem label="说明（模型据此判断何时调用）">
          <NInput
            v-model:value="toolForm.toolDesc"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 3 }"
            placeholder="用一句话说清这个 Tool 能回答什么问题"
          />
        </NFormItem>
        <NFormItem label="SQL 模板（使用 :name 命名参数）">
          <NInput
            v-model:value="toolForm.sqlTemplate"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder="select ... from inventory where warehouse = :warehouse"
          />
        </NFormItem>
        <NFormItem label="入参 JSON Schema（原样下发给模型）">
          <NInput
            v-model:value="toolForm.inputSchema"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder='{"type":"object","properties":{"warehouse":{"type":"string"}},"required":["warehouse"]}'
          />
        </NFormItem>
        <div class="flex gap-3">
          <NFormItem label="主表别名（可选）" class="flex-1">
            <NInput v-model:value="toolForm.tableAlias" placeholder="如 i，租户条件会拼成 i.ent_code" />
          </NFormItem>
          <NFormItem label="行数上限（1~500）" class="w-[160px]">
            <NInputNumber v-model:value="toolForm.resultLimit" :min="1" :max="500" class="w-full" />
          </NFormItem>
          <NFormItem label="状态" class="w-[130px]">
            <NSelect v-model:value="toolForm.status" :options="STATUS_OPTIONS" />
          </NFormItem>
        </div>
        <NFormItem label="备注（可选）">
          <NInput v-model:value="toolForm.remark" placeholder="内部说明，不下发给模型" />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="toolModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingTool" @click="submitTool">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
