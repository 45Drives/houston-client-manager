<template>

  <Wizard :steps="steps" :onComplete="data => props.onComplete(data)"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard } from '../../components/wizard';
import WelcomeView from './WelcomeView.vue';
import SettingUpHardwareView from './SettingUpHardwareView.vue';
import DiscoveryNonSetupServersView from './DiscoveryNonSetupServersView.vue';

const props = defineProps<{
  onComplete: (data: any) => void;
}>();

const steps = [
  { label: "Welcome", component: WelcomeView },
  { label: "Hardware Setup", component: SettingUpHardwareView },
  { label: "Server Discovery", component: DiscoveryNonSetupServersView },
];

</script>

<style scoped></style>
