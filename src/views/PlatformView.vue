<script setup lang="ts">
import {
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
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
import * as platformApi from '@/api/platform'
import { useAuthStore } from '@/stores/auth'
import type { TenantUserVO, TenantVO } from '@/types/api'

/**
 * 平台管理页：租户管理（平台视角）+ 本租户用户管理。
 *
 * <h3>为什么这两块权限码完全不同</h3>
 * 租户是**跨租户**的平台视角（`platform:tenant:*`，跨租户可见性不该随普通账号扩散）；
 * 用户是**本租户**范围（`user:*`，由租户插件自动限定），任意租户的管理员都能用。
 * 因此两块各自判断权限，不做成"一个平台模块"。
 *
 * <h3>三处业务约束直接体现在界面上</h3>
 * ① **租户没有删除入口**——租户下挂着业务数据与账目，物理删除会留下无法审计的孤儿数据，
 * 停用请改状态；② **租户编码编辑时不可改**——它是隔离键，改编码等于换了一个租户；
 * ③ **用户名不可改，密码留空表示不改**——避免管理端每次改姓名都要重设一遍密码。
 */
const message = useMessage()
const auth = useAuthStore()

const canManageTenant = computed(() => auth.hasPermission('platform:tenant:manage'))
const canListTenant = computed(() => auth.hasPermission('platform:tenant:list'))
const canSaveUser = computed(() => auth.hasPermission('user:save'))

const ENTITY_STATUS_OPTIONS = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
]

const STATUS_LABELS: Record<string, string> = { active: '启用', inactive: '停用', disabled: '停用' }

/** 现有角色；用 tag 模式允许选择也可手输新值 */
const ROLE_OPTIONS = [
  { label: 'admin', value: 'admin' },
  { label: 'viewer', value: 'viewer' },
]

const activeTab = ref('tenants')

/** ---- 租户 ---- */

const tenants = ref<TenantVO[]>([])
const loadingTenants = ref(false)
const tenantModalVisible = ref(false)
const editingTenantId = ref<number | null>(null)
const savingTenant = ref(false)
const tenantForm = reactive({ entCode: '', entName: '', status: 'active' })

async function loadTenants(): Promise<void> {
  if (!canListTenant.value) {
    return
  }
  loadingTenants.value = true
  try {
    tenants.value = await platformApi.listTenants()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载租户列表失败')
  } finally {
    loadingTenants.value = false
  }
}

function openCreateTenant(): void {
  editingTenantId.value = null
  Object.assign(tenantForm, { entCode: '', entName: '', status: 'active' })
  tenantModalVisible.value = true
}

function openEditTenant(row: TenantVO): void {
  editingTenantId.value = row.id
  Object.assign(tenantForm, { entCode: row.entCode, entName: row.entName, status: row.status })
  tenantModalVisible.value = true
}

async function submitTenant(): Promise<void> {
  if (editingTenantId.value == null && !tenantForm.entCode.trim()) {
    message.warning('租户编码不能为空')
    return
  }
  if (!tenantForm.entName.trim()) {
    message.warning('租户名称不能为空')
    return
  }
  savingTenant.value = true
  try {
    if (editingTenantId.value == null) {
      await platformApi.createTenant({
        entCode: tenantForm.entCode.trim(),
        entName: tenantForm.entName.trim(),
        status: tenantForm.status,
      })
      message.success('租户已创建')
    } else {
      // 编辑不发 entCode：后端会忽略它，这里也不发，避免让人误以为能改
      await platformApi.updateTenant(editingTenantId.value, {
        entName: tenantForm.entName.trim(),
        status: tenantForm.status,
      })
      message.success('租户已更新')
    }
    tenantModalVisible.value = false
    await loadTenants()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingTenant.value = false
  }
}

const tenantColumns = computed<DataTableColumns<TenantVO>>(() => [
  {
    title: '租户编码',
    key: 'entCode',
    width: 160,
    render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.entCode),
  },
  { title: '租户名称', key: 'entName' },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.status === 'active' ? 'success' : 'default' },
        { default: () => STATUS_LABELS[row.status] ?? row.status },
      ),
  },
  { title: '创建时间', key: 'createdAt', width: 180, render: (row) => row.createdAt.replace('T', ' ').slice(0, 19) },
  {
    title: '操作',
    key: 'actions',
    width: canManageTenant.value ? 90 : 0,
    render: (row) =>
      canManageTenant.value
        ? h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEditTenant(row) }, { default: () => '编辑' })
        : [],
  },
])

/** ---- 本租户用户 ---- */

const users = ref<TenantUserVO[]>([])
const loadingUsers = ref(false)
const userModalVisible = ref(false)
const editingUserId = ref<number | null>(null)
const savingUser = ref(false)
const userForm = reactive({ username: '', password: '', realName: '', phone: '', roleCode: '', status: 'active' })

async function loadUsers(): Promise<void> {
  loadingUsers.value = true
  try {
    users.value = await platformApi.listUsers()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '加载用户列表失败')
  } finally {
    loadingUsers.value = false
  }
}

function openCreateUser(): void {
  editingUserId.value = null
  Object.assign(userForm, { username: '', password: '', realName: '', phone: '', roleCode: '', status: 'active' })
  userModalVisible.value = true
}

function openEditUser(row: TenantUserVO): void {
  editingUserId.value = row.id
  Object.assign(userForm, {
    username: row.username,
    password: '',
    realName: row.realName ?? '',
    phone: row.phone ?? '',
    roleCode: row.roleCode ?? '',
    status: row.status,
  })
  userModalVisible.value = true
}

async function submitUser(): Promise<void> {
  if (editingUserId.value == null) {
    if (!userForm.username.trim()) {
      message.warning('用户名不能为空')
      return
    }
    if (!userForm.password) {
      message.warning('新建用户必须设置密码')
      return
    }
  }
  savingUser.value = true
  try {
    if (editingUserId.value == null) {
      await platformApi.createUser({
        username: userForm.username.trim(),
        password: userForm.password,
        realName: userForm.realName.trim() || null,
        phone: userForm.phone.trim() || null,
        roleCode: userForm.roleCode || null,
        status: userForm.status,
      })
      message.success('用户已创建')
    } else {
      // 密码留空 = 不改密码；用户名不发（不可改）
      await platformApi.updateUser(editingUserId.value, {
        password: userForm.password || null,
        realName: userForm.realName.trim() || null,
        phone: userForm.phone.trim() || null,
        roleCode: userForm.roleCode || null,
        status: userForm.status,
      })
      message.success('用户已更新')
    }
    userModalVisible.value = false
    await loadUsers()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '保存失败')
  } finally {
    savingUser.value = false
  }
}

async function removeUser(row: TenantUserVO): Promise<void> {
  try {
    await platformApi.removeUser(row.id)
    message.success('用户已删除')
    await loadUsers()
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '删除失败')
  }
}

const userColumns = computed<DataTableColumns<TenantUserVO>>(() => [
  {
    title: '用户名',
    key: 'username',
    width: 160,
    render: (row) => h('span', { class: 'font-mono text-[12px]' }, row.username),
  },
  { title: '姓名', key: 'realName', width: 130, render: (row) => row.realName || '—' },
  { title: '手机号', key: 'phone', width: 150, render: (row) => row.phone || '—' },
  {
    title: '角色',
    key: 'roleCode',
    width: 150,
    render: (row) => (row.roleCode ? `${row.roleName ?? ''}（${row.roleCode}）` : '未分配'),
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.status === 'active' ? 'success' : 'default' },
        { default: () => STATUS_LABELS[row.status] ?? row.status },
      ),
  },
  {
    title: '操作',
    key: 'actions',
    width: canSaveUser.value ? 130 : 0,
    render: (row) =>
      canSaveUser.value
        ? h('div', { class: 'flex gap-1' }, [
            h(NButton, { size: 'tiny', quaternary: true, onClick: () => openEditUser(row) }, { default: () => '编辑' }),
            h(
              NPopconfirm,
              { onPositiveClick: () => removeUser(row) },
              {
                trigger: () => h(NButton, { size: 'tiny', quaternary: true }, { default: () => '删除' }),
                default: () => '删除该用户？',
              },
            ),
          ])
        : [],
  },
])

onMounted(async () => {
  await loadTenants()
  await loadUsers()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
    <header class="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
      <div>
        <div class="text-[14px] font-medium text-gray-900">平台管理</div>
        <div class="text-[12px] text-gray-400">
          租户是跨租户的平台视角；用户管理限定在<b>本租户</b>内（由租户插件自动隔离）
        </div>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="tenants" tab="租户管理">
          <div v-if="!canListTenant" class="py-10">
            <p class="text-center text-[13px] text-gray-500">
              当前账号没有跨租户查看权限（`platform:tenant:list`）
            </p>
          </div>
          <template v-else>
            <div class="mb-3 flex items-center justify-between">
              <NButton size="small" secondary :loading="loadingTenants" @click="loadTenants">刷新</NButton>
              <NButton v-if="canManageTenant" type="primary" size="small" @click="openCreateTenant">新建租户</NButton>
            </div>
            <NDataTable
              :columns="tenantColumns"
              :data="tenants"
              :loading="loadingTenants"
              :row-key="(row: TenantVO) => row.id"
              :bordered="false"
              size="small"
            />
            <p class="mt-3 text-[12px] leading-5 text-gray-400">
              租户<b>没有删除入口</b>：租户下挂着业务数据与账目，物理删除会留下无法审计的孤儿数据。
              需要停止使用请把状态改为「停用」。租户编码是数据隔离键，创建后不可修改。
            </p>
          </template>
        </NTabPane>

        <NTabPane name="users" tab="本租户用户">
          <div class="mb-3 flex items-center justify-between">
            <NButton size="small" secondary :loading="loadingUsers" @click="loadUsers">刷新</NButton>
            <NButton v-if="canSaveUser" type="primary" size="small" @click="openCreateUser">新建用户</NButton>
          </div>
          <NDataTable
            :columns="userColumns"
            :data="users"
            :loading="loadingUsers"
            :row-key="(row: TenantUserVO) => row.id"
            :bordered="false"
            size="small"
          />
          <p class="mt-3 text-[12px] leading-5 text-gray-400">
            用户名创建后不可修改；编辑时密码留空表示不改密码。能新建用户与分配角色等于能授予权限，
            因此写操作仅限管理员。
          </p>
        </NTabPane>
      </NTabs>
    </div>

    <!-- 租户弹窗 -->
    <NModal
      v-model:show="tenantModalVisible"
      preset="card"
      :title="editingTenantId == null ? '新建租户' : '编辑租户'"
      class="max-w-[460px]"
    >
      <NForm label-placement="top">
        <NFormItem label="租户编码">
          <NInput v-model:value="tenantForm.entCode" :disabled="editingTenantId != null" placeholder="如 DEMO" />
        </NFormItem>
        <p v-if="editingTenantId != null" class="-mt-2 mb-3 text-[12px] text-amber-600">
          编码是数据隔离键，不可修改——改了等于换了一个租户，原有数据会全部找不到。
        </p>
        <NFormItem label="租户名称">
          <NInput v-model:value="tenantForm.entName" placeholder="如 演示租户" />
        </NFormItem>
        <NFormItem label="状态">
          <NSelect v-model:value="tenantForm.status" :options="ENTITY_STATUS_OPTIONS" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="tenantModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingTenant" @click="submitTenant">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 用户弹窗 -->
    <NModal
      v-model:show="userModalVisible"
      preset="card"
      :title="editingUserId == null ? '新建用户' : '编辑用户'"
      class="max-w-[460px]"
    >
      <NForm label-placement="top">
        <NFormItem label="用户名">
          <NInput v-model:value="userForm.username" :disabled="editingUserId != null" placeholder="登录名，创建后不可改" />
        </NFormItem>
        <NFormItem :label="editingUserId == null ? '密码' : '密码（留空表示不修改）'">
          <NInput
            v-model:value="userForm.password"
            type="password"
            show-password-on="click"
            :placeholder="editingUserId == null ? '必填' : '不填则保持原密码'"
          />
        </NFormItem>
        <NFormItem label="姓名">
          <NInput v-model:value="userForm.realName" placeholder="选填" />
        </NFormItem>
        <NFormItem label="手机号">
          <NInput v-model:value="userForm.phone" placeholder="选填" />
        </NFormItem>
        <NFormItem label="角色">
          <NSelect
            v-model:value="userForm.roleCode"
            :options="ROLE_OPTIONS"
            tag
            filterable
            clearable
            placeholder="选择或输入角色编码，留空为未分配"
          />
        </NFormItem>
        <NFormItem label="状态">
          <NSelect v-model:value="userForm.status" :options="ENTITY_STATUS_OPTIONS" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="userModalVisible = false">取消</NButton>
          <NButton type="primary" :loading="savingUser" @click="submitUser">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
