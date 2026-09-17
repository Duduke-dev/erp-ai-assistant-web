<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const auth = useAuthStore()

/**
 * 租户编码放在表单里而不是写死：用户名只在租户内唯一，
 * 登录必须同时给出"哪个租户的哪个用户"。演示环境预填 DEMO 省去手输。
 */
const form = reactive({
  entCode: 'DEMO',
  username: '',
  password: '',
})

const submitting = ref(false)

async function submit(): Promise<void> {
  if (!form.entCode.trim() || !form.username.trim() || !form.password) {
    message.warning('请填写租户编码、用户名与密码')
    return
  }
  submitting.value = true
  try {
    await auth.login({ entCode: form.entCode.trim(), username: form.username.trim(), password: form.password })
    message.success('登录成功')
    const redirect = route.query.redirect
    await router.replace(typeof redirect === 'string' && redirect ? redirect : { name: 'chat' })
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : '登录失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- 与对话页同样锁视口高度；小屏（表单高于视口）时允许这里自己滚，而不是撑开 body -->
  <div class="flex h-dvh items-center justify-center overflow-y-auto bg-gray-50 px-4">
    <div class="w-full max-w-[380px]">
      <div class="mb-6 text-center">
        <h1 class="text-[20px] font-medium text-gray-900">ERP 智能助手</h1>
        <p class="mt-1 text-[13px] text-gray-500">业务问答 · 知识库检索 · 数据图表</p>
      </div>

      <NCard :bordered="false" class="shadow-sm">
        <NForm @keyup.enter="submit">
          <NFormItem label="租户编码">
            <NInput v-model:value="form.entCode" placeholder="如 DEMO" />
          </NFormItem>
          <NFormItem label="用户名">
            <NInput v-model:value="form.username" placeholder="请输入用户名" />
          </NFormItem>
          <NFormItem label="密码">
            <NInput v-model:value="form.password" type="password" show-password-on="click" placeholder="请输入密码" />
          </NFormItem>
          <NButton type="primary" block :loading="submitting" @click="submit">登录</NButton>
        </NForm>

        <p class="mt-4 text-center text-[12px] leading-5 text-gray-400">
          演示账号：租户 <span class="text-gray-600">DEMO</span>，用户名
          <span class="text-gray-600">admin</span>，密码 <span class="text-gray-600">123456</span>
        </p>
      </NCard>
    </div>
  </div>
</template>
