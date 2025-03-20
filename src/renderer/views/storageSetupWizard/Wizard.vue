<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)" :hideHeader="true"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard } from '../../components/wizard';
import WelcomeView from './WelcomeView.vue';
import SettingUpHardwareView from './SettingUpHardwareView.vue';
import DiscoveryNonSetupServersView from './DiscoveryNonSetupServersView.vue';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

const steps = [
  { label: "Welcome", component: WelcomeView },
  { label: "Hardware Setup", component: SettingUpHardwareView },
  { label: "Server Discovery", component: DiscoveryNonSetupServersView },
];

</script>

<style scoped></style>
