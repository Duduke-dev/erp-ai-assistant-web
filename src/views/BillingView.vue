<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NDescriptions,
  NDescriptionsItem,
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

import * as billingApi from '@/api/billing'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import type {
  BillingAccountVO,
  BillingInvoiceVO,
  BillingPlanVO,
  BillingPriceRuleVO,
  BillingTransactionVO,
  TokenUsageVO,
} from '@/types/api'

/**
 * 计费页。
 *
 * <h3>三组内容的划分</h3>
 * 「账户与用量」回答"我现在什么套餐、用了多少"；「套餐与价格」是平台级配置
 * （改一次影响所有租户，仅 admin 可写）；「流水与发票」是账目与对账。
 *
 * <h3>两处业务约束直接体现在界面上</h3>
 * ① **价格规则没有编辑入口**——价格是带生效日期的历史记录，调价应当新增一条更晚生效的
 * 记录，而不是改写历史；② **套餐编码在编辑时不可改**——账户用 plan_code 关联套餐，
 * 改编码会让既有账户指向一个不存在的套餐。
 */
const message = useMessage()
const auth = useAuthStore()

const canManage = computed(() => auth.hasPermission('billing:manage'))

const activeTab = ref('account')

/**
 * 金额格式化：保留真实精度，但去掉无意义的尾随 0。
 *
 * <p>固定 2 位不行——单次扣费常是 0.004 元这种量级，会被显示成 0.00；
 * 固定 6 位又太长（100.000000）。所以按 6 位渲染后去尾零，**至少保留 2 位**：
 * `0.004` → `0.004`、`100` → `100.00`、`1234.5678` → `1234.5678`。
 */
function formatAmount(value: number | null | undefined): string {
  const fixed = (value ?? 0).toFixed(6).replace(/0+$/, '')
  const [integerPart, decimalPart = ''] = (fixed.includes('.') ? fixed : `${fixed}.`).split('.')
  return `¥ ${integerPart}.${decimalPart.padEnd(2, '0')}`
}

function formatTokens(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('zh-CN')
}

const ACCOUNT_STATUS_OPTIONS = [
  { label: '正常', value: 'active' },
  { label: '已暂停', value: 'suspended' },
  { label: '欠费', value: 'arrears' },
]

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: '正常',
  suspended: '已暂停',
  arrears: '欠费',
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  recharge: '充值',
  deduction: '扣费',
  gift: '赠送',
}

/** ---- 账户与用量 ---- */

const account = ref<BillingAccountVO | null>(null)
const loadingAccount = ref(false)

/** 开户 / 改套餐弹窗。未开户时是"开户"，已开户时是"编辑"——同一套字段 */
const accountModalVisible = ref(false)
const savingAccount = ref(false)
const accountForm = reactive({ planCode: '', monthlyQuota: 1_000_000, status: 'active' })

/** 充值弹窗 */
const rechargeModalVisible = ref(false)
const savingRecharge = ref(false)
const rechargeForm = reactive({ amount: 100, remark: '' })

function openAccountModal(): void {
  Object.assign(accountForm, {
    planCode: account.value?.planCode ?? '',
    monthlyQuota: account.value?.monthlyQuota ?? 1_000_000,
    status: account.value?.status ?? 'active',
  })
  accountModalVisible.value = true
}

function openRechargeModal(): void {
  Object.assign(rechargeForm, { amount: 100, remark: '' })
  rechargeModalVisible.value = true
}

async function submitAccount(): Promise<void> {
  if (!accountForm.planCode.trim()) {
    message.warning('套餐编码不能为空')
    return
  }
  savingAccount.value = true
  try {
    const payload = {
      planCode: accountForm.planCode.trim(),
      monthlyQuota: accountForm.monthlyQuota,
      status: accountForm.status,
    }
    if (account.value) {
      await billingApi.updateAccount(account.value.id, payload)
      message.success('账户已更新')
    } else {
      await billingApi.createAccount(payload)
      message.success('账户已开通')
    }
    accountModalVisible.value = false
    await loadAccount()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingAccount.value = false
  }
}

async function submitRecharge(): Promise<void> {
  if (!account.value) {
    return
  }
  if (!(rechargeForm.amount > 0)) {
    // 后端只接受正数：扣费是系统内部行为，不让一个入参同时承担加钱与扣钱
    message.warning('充值金额必须大于 0')
    return
  }
  savingRecharge.value = true
  try {
    await billingApi.rechargeAccount(account.value.id, {
      amount: rechargeForm.amount,
      remark: rechargeForm.remark.trim() || null,
    })
    message.success('充值成功')
    rechargeModalVisible.value = false
    await loadAccount()
    await loadLedger()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '充值失败')
  } finally {
    savingRecharge.value = false
  }
}

const usageMode = ref<'daily' | 'monthly'>('daily')
const usageRows = ref<TokenUsageVO[]>([])
const loadingUsage = ref(false)
const dailyRange = ref<[number, number] | null>(null)
const monthlyRange = ref<[number, number] | null>(null)

function toDateString(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function toPeriodString(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

async function loadAccount(): Promise<void> {
  loadingAccount.value = true
  try {
    account.value = await billingApi.getAccount()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载计费账户失败')
  } finally {
    loadingAccount.value = false
  }
}

async function loadUsage(): Promise<void> {
  loadingUsage.value = true
  try {
    if (usageMode.value === 'daily') {
      const range = dailyRange.value
      usageRows.value = await billingApi.dailyUsage(
        range ? toDateString(range[0]) : undefined,
        range ? toDateString(range[1]) : undefined,
      )
    } else {
      const range = monthlyRange.value
      usageRows.value = await billingApi.monthlyUsage(
        range ? toPeriodString(range[0]) : undefined,
        range ? toPeriodString(range[1]) : undefined,
      )
    }
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载用量失败')
  } finally {
    loadingUsage.value = false
  }
}

const usageColumns: DataTableColumns<TokenUsageVO> = [
  {
    title: '时间',
    key: 'bucket',
    width: 140,
    render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.bucket),
  },
  {
    title: '模型',
    key: 'modelName',
    render: (row) => row.modelName || '（全部模型汇总）',
  },
  { title: '请求次数', key: 'requestCount', width: 110, render: (row) => formatTokens(row.requestCount) },
  {
    title: '合计 token',
    key: 'totalTokens',
    width: 130,
    render: (row) => h('span', { class: 'font-mono text-[12px]' }, formatTokens(row.totalTokens)),
  },
]

/** ---- 套餐 ---- */

const plans = ref<BillingPlanVO[]>([])
const loadingPlans = ref(false)
const planModalVisible = ref(false)
const editingPlanId = ref<number | null>(null)
const savingPlan = ref(false)
const planForm = reactive({ planCode: '', planName: '', monthlyQuota: 1_000_000, price: 0 })

async function loadPlans(): Promise<void> {
  loadingPlans.value = true
  try {
    plans.value = await billingApi.listPlans()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载套餐失败')
  } finally {
    loadingPlans.value = false
  }
}

function openCreatePlan(): void {
  editingPlanId.value = null
  Object.assign(planForm, { planCode: '', planName: '', monthlyQuota: 1_000_000, price: 0 })
  planModalVisible.value = true
}

function openEditPlan(row: BillingPlanVO): void {
  editingPlanId.value = row.id
  Object.assign(planForm, {
    planCode: row.planCode,
    planName: row.planName,
    monthlyQuota: row.monthlyQuota ?? 0,
    price: row.price ?? 0,
  })
  planModalVisible.value = true
}

async function submitPlan(): Promise<void> {
  if (editingPlanId.value == null && !planForm.planCode.trim()) {
    message.warning('套餐编码不能为空')
    return
  }
  if (!planForm.planName.trim()) {
    message.warning('套餐名称不能为空')
    return
  }
  savingPlan.value = true
  try {
    if (editingPlanId.value == null) {
      await billingApi.createPlan({ ...planForm, planCode: planForm.planCode.trim() })
      message.success('套餐已创建')
    } else {
      // 编辑时不传 planCode：后端也会忽略它，这里干脆不发，避免让人误以为它能改
      await billingApi.updatePlan(editingPlanId.value, {
        planName: planForm.planName,
        monthlyQuota: planForm.monthlyQuota,
        price: planForm.price,
      })
      message.success('套餐已更新')
    }
    planModalVisible.value = false
    await loadPlans()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingPlan.value = false
  }
}

async function removePlan(row: BillingPlanVO): Promise<void> {
  try {
    await billingApi.removePlan(row.id)
    message.success('套餐已删除')
    await loadPlans()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

const planColumns = computed<DataTableColumns<BillingPlanVO>>(() => [
  { title: '编码', key: 'planCode', width: 140, render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.planCode) },
  { title: '名称', key: 'planName' },
  { title: '月配额(token)', key: 'monthlyQuota', width: 140, render: (row) => formatTokens(row.monthlyQuota) },
  { title: '价格', key: 'price', width: 130, render: (row) => formatAmount(row.price) },
  {
    title: '操作',
    key: 'actions',
    width: canManage.value ? 130 : 0,
    render: (row) =>
      canManage.value
        ? h('div', { class: 'flex gap-1' }, [
            h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEditPlan(row) }, { default: () => '编辑' }),
            h(
              NPopconfirm,
              { onPositiveClick: () => removePlan(row) },
              {
                trigger: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => '删除' }),
                default: () => '删除该套餐？已有账户仍保留其配额快照',
              },
            ),
          ])
        : [],
  },
])

/** ---- 价格规则 ---- */

const priceRules = ref<BillingPriceRuleVO[]>([])
const loadingPriceRules = ref(false)
const priceRuleModelFilter = ref('')
const priceRuleModalVisible = ref(false)
const savingPriceRule = ref(false)
const priceRuleForm = reactive({ modelName: '', inputPrice: 0, outputPrice: 0, effectiveDate: Date.now() })

async function loadPriceRules(): Promise<void> {
  loadingPriceRules.value = true
  try {
    priceRules.value = await billingApi.listPriceRules(priceRuleModelFilter.value.trim() || undefined)
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载价格规则失败')
  } finally {
    loadingPriceRules.value = false
  }
}

function openCreatePriceRule(): void {
  Object.assign(priceRuleForm, { modelName: '', inputPrice: 0, outputPrice: 0, effectiveDate: Date.now() })
  priceRuleModalVisible.value = true
}

async function submitPriceRule(): Promise<void> {
  if (!priceRuleForm.modelName.trim()) {
    message.warning('模型名不能为空')
    return
  }
  savingPriceRule.value = true
  try {
    await billingApi.createPriceRule({
      modelName: priceRuleForm.modelName.trim(),
      inputPrice: priceRuleForm.inputPrice,
      outputPrice: priceRuleForm.outputPrice,
      effectiveDate: toDateString(priceRuleForm.effectiveDate),
    })
    message.success('价格规则已新增；调价请新增更晚生效的一条，不要改历史')
    priceRuleModalVisible.value = false
    await loadPriceRules()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingPriceRule.value = false
  }
}

async function removePriceRule(row: BillingPriceRuleVO): Promise<void> {
  try {
    await billingApi.removePriceRule(row.id)
    message.success('价格规则已删除')
    await loadPriceRules()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

/** 没有"编辑"列：价格是历史记录，改历史没有正确语义 */
const priceRuleColumns = computed<DataTableColumns<BillingPriceRuleVO>>(() => [
  { title: '模型', key: 'modelName', render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.modelName) },
  { title: '输入单价', key: 'inputPrice', width: 130, render: (row) => formatAmount(row.inputPrice) },
  { title: '输出单价', key: 'outputPrice', width: 130, render: (row) => formatAmount(row.outputPrice) },
  { title: '生效日期', key: 'effectiveDate', width: 130 },
  {
    title: '操作',
    key: 'actions',
    width: canManage.value ? 90 : 0,
    render: (row) =>
      canManage.value
        ? h(
            NPopconfirm,
            { onPositiveClick: () => removePriceRule(row) },
            {
              trigger: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => '删除' }),
              default: () => '删除这条价格记录？',
            },
          )
        : [],
  },
])

/** ---- 流水与发票 ---- */

const transactions = ref<BillingTransactionVO[]>([])
const invoices = ref<BillingInvoiceVO[]>([])
const loadingLedger = ref(false)
const invoicePeriod = ref('')
const generatingInvoice = ref(false)

async function loadLedger(): Promise<void> {
  loadingLedger.value = true
  try {
    const [tx, inv] = await Promise.all([billingApi.listTransactions(), billingApi.listInvoices()])
    transactions.value = tx
    invoices.value = inv
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载流水失败')
  } finally {
    loadingLedger.value = false
  }
}

async function submitInvoice(): Promise<void> {
  const period = invoicePeriod.value.trim()
  if (!/^\d{4}-\d{2}$/.test(period)) {
    message.warning('账期格式应为 yyyy-MM，例如 2026-09')
    return
  }
  generatingInvoice.value = true
  try {
    const invoice = await billingApi.generateInvoice(period)
    message.success(`已生成 ${invoice.period} 账单：${formatAmount(invoice.totalAmount)}`)
    await loadLedger()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '开票失败')
  } finally {
    generatingInvoice.value = false
  }
}

const transactionColumns: DataTableColumns<BillingTransactionVO> = [
  { title: '流水号', key: 'transactionNo', width: 200, ellipsis: { tooltip: true } },
  {
    title: '类型',
    key: 'type',
    width: 90,
    render: (row) => TRANSACTION_TYPE_LABELS[row.type] ?? row.type,
  },
  {
    title: '金额',
    key: 'amount',
    width: 130,
    render: (row) =>
      h(
        'span',
        { class: (row.amount ?? 0) < 0 ? 'text-red-500' : 'text-emerald-600' },
        formatAmount(row.amount),
      ),
  },
  { title: '变动后余额', key: 'balanceAfter', width: 140, render: (row) => formatAmount(row.balanceAfter) },
  { title: '关联 token', key: 'tokens', width: 120, render: (row) => (row.tokens != null ? formatTokens(row.tokens) : '—') },
  { title: '备注', key: 'remark', ellipsis: { tooltip: true }, render: (row) => row.remark || '—' },
  { title: '时间', key: 'createdAt', width: 170, render: (row) => row.createdAt.replace('T', ' ').slice(0, 19) },
]

const invoiceColumns: DataTableColumns<BillingInvoiceVO> = [
  { title: '账期', key: 'period', width: 120 },
  { title: '合计 token', key: 'totalTokens', width: 150, render: (row) => formatTokens(row.totalTokens) },
  { title: '合计金额', key: 'totalAmount', width: 140, render: (row) => formatAmount(row.totalAmount) },
  { title: '生成时间', key: 'createdAt', render: (row) => row.createdAt.replace('T', ' ').slice(0, 19) },
]

onMounted(async () => {
  await loadAccount()
  await loadUsage()
  await loadPlans()
  await loadPriceRules()
  await loadLedger()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
    <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
      <div>
        <div class="text-[14px] font-medium text-gray-900">计费</div>
        <div class="text-[12px] text-gray-400">
          套餐与价格规则是<b>平台级配置</b>（改一次影响所有租户），流水与用量按租户隔离
        </div>
      </div>
      <NTag v-if="!canManage" size="small">只读</NTag>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <NTabs v-model:value="activeTab" type="line" animated>
        <!-- 账户与用量 -->
        <NTabPane name="account" tab="账户与用量">
          <NCard size="small" :bordered="false" class="mb-4">
            <template #header>
              <div class="flex items-center justify-between">
                <span class="text-[13px] font-medium">{{ account ? '计费账户' : '尚未开通计费账户' }}</span>
                <div v-if="canManage" class="flex gap-2">
                  <NButton size="small" secondary @click="openAccountModal">
                    {{ account ? '修改套餐' : '开通账户' }}
                  </NButton>
                  <NButton v-if="account" size="small" type="primary" @click="openRechargeModal">充值</NButton>
                </div>
              </div>
            </template>

            <NDescriptions v-if="account" :column="3" label-placement="top" size="small">
              <NDescriptionsItem label="当前套餐">
                <span class="font-mono">{{ account.planCode || '—' }}</span>
              </NDescriptionsItem>
              <NDescriptionsItem label="账户余额">{{ formatAmount(account.balance) }}</NDescriptionsItem>
              <NDescriptionsItem label="状态">
                <NTag size="small" :type="account.status === 'active' ? 'success' : 'warning'">
                  {{ ACCOUNT_STATUS_LABELS[account.status ?? ''] ?? account.status ?? '—' }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem label="本周期配额">{{ formatTokens(account.monthlyQuota) }}</NDescriptionsItem>
              <NDescriptionsItem label="本周期已用">{{ formatTokens(account.usedTokens) }}</NDescriptionsItem>
              <NDescriptionsItem label="剩余配额">
                <span
                  :class="(account.remainingQuota ?? 0) <= 0 ? 'text-red-500' : 'text-gray-900'"
                >
                  {{ formatTokens(account.remainingQuota) }}
                </span>
              </NDescriptionsItem>
            </NDescriptions>
            <p v-else class="py-3 text-center text-[13px] leading-6 text-gray-500">
              开通后可查看余额、配额与用量。<br />
              <span class="text-gray-400">开户前需要先有可选的套餐（见「套餐与价格」页签）——账户必须挂在已存在的套餐上。</span>
              <span v-if="!canManage" class="block">当前账号没有开通权限（需要 billing:manage）。</span>
            </p>
          </NCard>

          <p v-if="account" class="mb-4 text-[12px] leading-5 text-gray-400">
            配额与余额由服务端计算下发（剩余 = 配额 − 已用，负数处理由后端统一）。
            账户持有的是套餐的<b>快照</b>——改套餐不追溯影响历史账目。
          </p>

          <div class="mb-3 flex items-center gap-2">
            <NSelect
              v-model:value="usageMode"
              :options="[
                { label: '按天', value: 'daily' },
                { label: '按账期', value: 'monthly' },
              ]"
              class="w-[130px]"
            />
            <NDatePicker
              v-if="usageMode === 'daily'"
              v-model:value="dailyRange"
              type="daterange"
              clearable
              class="max-w-[320px]"
            />
            <NDatePicker v-else v-model:value="monthlyRange" type="monthrange" clearable class="max-w-[280px]" />
            <NButton @click="loadUsage">查询</NButton>
          </div>

          <NDataTable
            :columns="usageColumns"
            :data="usageRows"
            :loading="loadingUsage"
            :row-key="(row: TokenUsageVO) => `${row.bucket}-${row.modelName ?? 'all'}`"
            :bordered="false"
            size="small"
          />
          <p class="mt-3 text-[12px] leading-5 text-gray-400">
            不选日期则查询全部。「全部模型汇总」行的模型列为空——它统计的是该时间桶内所有模型之和。
          </p>
        </NTabPane>

        <!-- 套餐与价格 -->
        <NTabPane name="pricing" tab="套餐与价格">
          <div class="mb-2 flex items-center justify-between">
            <div class="text-[13px] font-medium text-gray-800">套餐</div>
            <NButton v-if="canManage" type="primary" size="small" @click="openCreatePlan">新建套餐</NButton>
          </div>
          <NDataTable
            :columns="planColumns"
            :data="plans"
            :loading="loadingPlans"
            :row-key="(row: BillingPlanVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-2 text-[12px] leading-5 text-gray-400">
            账户持有套餐的<b>快照</b>：这里调整配额或价格，<b>不会</b>追溯影响已签约账户。
          </p>

          <div class="mb-2 mt-6 flex items-center justify-between">
            <div class="text-[13px] font-medium text-gray-800">价格规则</div>
            <div class="flex items-center gap-2">
              <NInput
                v-model:value="priceRuleModelFilter"
                placeholder="按模型名筛选"
                size="small"
                class="max-w-[200px]"
                clearable
                @keydown.enter.exact.prevent="loadPriceRules"
              />
              <NButton size="small" @click="loadPriceRules">查询</NButton>
              <NButton v-if="canManage" type="primary" size="small" @click="openCreatePriceRule">新增价格</NButton>
            </div>
          </div>
          <NDataTable
            :columns="priceRuleColumns"
            :data="priceRules"
            :loading="loadingPriceRules"
            :row-key="(row: BillingPriceRuleVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-2 text-[12px] leading-5 text-gray-400">
            价格是<b>带生效日期的历史记录</b>，因此没有编辑入口——调价请新增一条生效日期更晚的记录。
            误录的记录可以删除。
          </p>
        </NTabPane>

        <!-- 流水与发票 -->
        <NTabPane name="ledger" tab="流水与发票">
          <div class="mb-2 flex items-center justify-between">
            <div class="text-[13px] font-medium text-gray-800">交易流水</div>
            <NButton size="small" secondary :loading="loadingLedger" @click="loadLedger">刷新</NButton>
          </div>
          <NDataTable
            :columns="transactionColumns"
            :data="transactions"
            :loading="loadingLedger"
            :row-key="(row: BillingTransactionVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-2 text-[12px] leading-5 text-gray-400">
            扣费金额为负。「变动后余额」按笔记录，用于逐笔还原对账。
          </p>

          <div class="mb-2 mt-6 flex items-center justify-between">
            <div class="text-[13px] font-medium text-gray-800">发票 / 账单</div>
            <div class="flex items-center gap-2">
              <NInput
                v-model:value="invoicePeriod"
                placeholder="账期，如 2026-09"
                size="small"
                class="max-w-[160px]"
              />
              <NButton
                v-if="canManage"
                type="primary"
                size="small"
                :loading="generatingInvoice"
                @click="submitInvoice"
              >
                生成账单
              </NButton>
            </div>
          </div>
          <NDataTable
            :columns="invoiceColumns"
            :data="invoices"
            :loading="loadingLedger"
            :row-key="(row: BillingInvoiceVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-2 text-[12px] leading-5 text-gray-400">
            按账期汇总该期间的 token 与金额。重复生成同一账期会覆盖既有账单。
          </p>
        </NTabPane>
      </NTabs>
    </div>

    <!-- 套餐弹窗 -->
    <NModal v-model:show="planModalVisible" preset="card" :title="editingPlanId == null ? '新建套餐' : '编辑套餐'" class="max-w-[460px]">
      <NForm label-placement="top">
        <NFormItem label="套餐编码">
          <NInput
            v-model:value="planForm.planCode"
            :disabled="editingPlanId != null"
            placeholder="如 standard"
          />
        </NFormItem>
        <p v-if="editingPlanId != null" class="-mt-2 mb-3 text-[12px] text-amber-600">
          编码不可修改：账户通过它关联套餐，改了会让既有账户指向不存在的套餐。
        </p>
        <NFormItem label="套餐名称">
          <NInput v-model:value="planForm.planName" placeholder="如 标准版" />
        </NFormItem>
        <NFormItem label="月配额（token）">
          <NInputNumber v-model:value="planForm.monthlyQuota" :min="0" class="w-full" />
        </NFormItem>
        <NFormItem label="价格（元）">
          <NInputNumber v-model:value="planForm.price" :min="0" :precision="2" class="w-full" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="planModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingPlan" @click="submitPlan">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 开户 / 修改套餐弹窗 -->
    <NModal
      v-model:show="accountModalVisible"
      preset="card"
      :title="account ? '修改账户套餐' : '开通计费账户'"
      class="max-w-[460px]"
    >
      <NForm label-placement="top">
        <NFormItem label="套餐编码">
          <NInput v-model:value="accountForm.planCode" placeholder="对应套餐表中的编码" />
        </NFormItem>
        <NFormItem label="月配额（token）">
          <NInputNumber v-model:value="accountForm.monthlyQuota" :min="0" class="w-full" />
        </NFormItem>
        <NFormItem label="状态">
          <NSelect v-model:value="accountForm.status" :options="ACCOUNT_STATUS_OPTIONS" />
        </NFormItem>
      </NForm>
      <p class="text-[12px] leading-5 text-amber-600">
        配额直接落在账户上（而非每次现查套餐）：这样后续调整套餐价格与额度，
        不会追溯影响已签约账户的历史账目。
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="accountModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingAccount" @click="submitAccount">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 充值弹窗 -->
    <NModal v-model:show="rechargeModalVisible" preset="card" title="账户充值" class="max-w-[420px]">
      <NForm label-placement="top">
        <NFormItem label="充值金额（元）">
          <NInputNumber v-model:value="rechargeForm.amount" :min="0.01" :precision="2" class="w-full" />
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="rechargeForm.remark" placeholder="选填，如「2026Q4 预付款」" />
        </NFormItem>
      </NForm>
      <p class="text-[12px] leading-5 text-gray-400">
        充值金额必须为正。扣费由系统在调用模型时自动从余额扣除，不通过本入口。
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="rechargeModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingRecharge" @click="submitRecharge">确认充值</NButton>
        </div>
      </template>
    </NModal>

    <!-- 价格规则弹窗 -->
    <NModal v-model:show="priceRuleModalVisible" preset="card" title="新增价格规则" class="max-w-[460px]">
      <NForm label-placement="top">
        <NFormItem label="模型名">
          <NInput v-model:value="priceRuleForm.modelName" placeholder="如 qwen-plus" />
        </NFormItem>
        <NFormItem label="输入单价（每千 token）">
          <NInputNumber v-model:value="priceRuleForm.inputPrice" :min="0" :precision="6" class="w-full" />
        </NFormItem>
        <NFormItem label="输出单价（每千 token）">
          <NInputNumber v-model:value="priceRuleForm.outputPrice" :min="0" :precision="6" class="w-full" />
        </NFormItem>
        <NFormItem label="生效日期">
          <NDatePicker v-model:value="priceRuleForm.effectiveDate" type="date" class="w-full" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="priceRuleModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingPriceRule" @click="submitPriceRule">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
