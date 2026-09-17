<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NLoadingBarProvider,
  NMessageProvider,
  dateZhCN,
  zhCN,
} from 'naive-ui'
</script>

<template>
  <!--
    Provider 链的顺序是有讲究的：
    ConfigProvider 在最外层（提供 locale 与主题），Message/Dialog/LoadingBar 在内层——
    这三个 API（useMessage / useDialog）都要求调用方位于对应 Provider 的子树中，
    放在 RouterView 外层才能被所有页面使用。
  -->
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN">
    <NMessageProvider>
      <NDialogProvider>
        <NLoadingBarProvider>
          <RouterView />
        </NLoadingBarProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
