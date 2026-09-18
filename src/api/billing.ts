import { http } from '@/api/http'
import type {
  BillingAccountSaveDTO,
  BillingAccountVO,
  BillingInvoiceVO,
  BillingPlanSaveDTO,
  BillingPlanVO,
  BillingPriceRuleSaveDTO,
  BillingPriceRuleVO,
  BillingRechargeDTO,
  BillingTransactionVO,
  TokenUsageVO,
} from '@/types/api'

const BASE = '/api/billing'

function toQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') {
      continue
    }
    params.append(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** ---- 账户（本租户）---- */

/** 本租户计费账户；未开户时返回 null */
export function getAccount(): Promise<BillingAccountVO | null> {
  return http.get<BillingAccountVO | null>(`${BASE}/account`)
}

export function createAccount(payload: BillingAccountSaveDTO): Promise<number> {
  return http.post<number>(`${BASE}/accounts`, payload)
}

export function updateAccount(id: number, payload: BillingAccountSaveDTO): Promise<void> {
  return http.put<void>(`${BASE}/accounts/${id}`, payload)
}

/** 充值。金额必须为正——扣费是系统内部行为，不走这个接口 */
export function rechargeAccount(id: number, payload: BillingRechargeDTO): Promise<void> {
  return http.post<void>(`${BASE}/accounts/${id}/recharges`, payload)
}

/** ---- 用量 ---- */

/** 日用量。`from`/`to` 为 `yyyy-MM-dd`，可省略 */
export function dailyUsage(from?: string, to?: string): Promise<TokenUsageVO[]> {
  return http.get<TokenUsageVO[]>(`${BASE}/usage/daily${toQueryString({ from, to })}`)
}

/** 月用量。`from`/`to` 为 `yyyy-MM`，可省略 */
export function monthlyUsage(from?: string, to?: string): Promise<TokenUsageVO[]> {
  return http.get<TokenUsageVO[]>(`${BASE}/usage/monthly${toQueryString({ from, to })}`)
}

/** ---- 套餐 ---- */

export function listPlans(): Promise<BillingPlanVO[]> {
  return http.get<BillingPlanVO[]>(`${BASE}/plans`)
}

export function createPlan(payload: BillingPlanSaveDTO): Promise<number> {
  return http.post<number>(`${BASE}/plans`, payload)
}

/** 更新时 `planCode` 不生效：账户用 plan_code 关联套餐，改编码会让既有账户指向不存在的套餐 */
export function updatePlan(id: number, payload: BillingPlanSaveDTO): Promise<void> {
  return http.put<void>(`${BASE}/plans/${id}`, payload)
}

export function removePlan(id: number): Promise<void> {
  return http.delete<void>(`${BASE}/plans/${id}`)
}

/** ---- 价格规则 ---- */

export function listPriceRules(modelName?: string): Promise<BillingPriceRuleVO[]> {
  return http.get<BillingPriceRuleVO[]>(`${BASE}/price_rules${toQueryString({ modelName })}`)
}

/** 只有新增与删除，**没有更新**：调价应新增一条生效日期更晚的记录，而不是改写历史 */
export function createPriceRule(payload: BillingPriceRuleSaveDTO): Promise<number> {
  return http.post<number>(`${BASE}/price_rules`, payload)
}

export function removePriceRule(id: number): Promise<void> {
  return http.delete<void>(`${BASE}/price_rules/${id}`)
}

/** ---- 交易流水与发票 ---- */

export function listTransactions(): Promise<BillingTransactionVO[]> {
  return http.get<BillingTransactionVO[]>(`${BASE}/transactions`)
}

export function listInvoices(): Promise<BillingInvoiceVO[]> {
  return http.get<BillingInvoiceVO[]>(`${BASE}/invoices`)
}

/** 按账期（`yyyy-MM`）开票 */
export function generateInvoice(period: string): Promise<BillingInvoiceVO> {
  return http.post<BillingInvoiceVO>(`${BASE}/invoices${toQueryString({ period })}`)
}
