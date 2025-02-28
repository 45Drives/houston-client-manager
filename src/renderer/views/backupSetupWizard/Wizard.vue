<template>

  <Wizard :steps="steps" :onComplete="data => props.onComplete(data)"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard } from '../../components/wizard';
import ChooseManageView from './ChooseManageView.vue';
import WelcomeView from './WelcomeView.vue';

const props = defineProps<{
  onComplete: (data: any) => void;
}>();

const steps = [
  { label: "Welcome", component: WelcomeView },
  { label: "Manage Backups", component: ChooseManageView },
];

</script>

<style scoped></style>
