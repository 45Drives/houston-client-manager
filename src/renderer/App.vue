<template>
  <DashboardView />
  <GlobalModalConfirm />
  <NotificationView />
</template>

<script setup lang="ts">
import DashboardView from './views/DashboardView.vue';
import { GlobalModalConfirm, NotificationView } from '@45drives/houston-common-ui';
</script>
