<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="(data: any) => props.onComplete(data)" :hideHeader="true" :hideProgress="true"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard } from '@45drives/houston-common-ui';
import WelcomeView from './WelcomeView.vue';
import DiscoveryNonSetupServersView from './DiscoveryNonSetupServersView.vue';
import UnboxingView from './UnboxingView.vue';
import PluginInEthernetView from './PluginInEthernetView.vue';
import PluginInPowerView from './PluginInPowerView.vue';
import PowerOnView from './PowerOnView.vue';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

const steps = [
  { label: "Welcome", component: WelcomeView },
  { label: "Unboxing", component: UnboxingView },
  { label: "Plug-In Power", component: PluginInPowerView },
  { label: "Plug-In Ethernet", component: PluginInEthernetView },
  { label: "Power On", component: PowerOnView },
  { label: "Server Discovery", component: DiscoveryNonSetupServersView },
];

</script>

<style scoped></style>
