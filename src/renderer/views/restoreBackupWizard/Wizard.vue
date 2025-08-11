<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)" :hideHeader="true" :hideProgress="true"
    class="h-full flex-1 text-default bg-default" />
  <!-- Page curl corner effect -->
  <!-- <div class="page-corner-effect pointer-events-none"></div> -->

  <!-- Double arrows -->
  <!-- <div class="double-arrow absolute bottom-4 right-4 z-10 text-gray-400 text-xl animate-pulse pointer-events-none">
    &raquo;
  </div> -->
</template>

<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui';

import WelcomeView from './WelcomeView.vue';
import EnterCredentialsView from './EnterCredentialsView.vue';
import RestoreBackupsView from './RestoreBackupsView.vue';

import { provide, reactive } from 'vue';
import { restoreBackUpSetupDataKey } from '../../keys/injection-keys';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

provide(restoreBackUpSetupDataKey, reactive({
  server: null,
  username: "",
  password: "",
}))

const steps: WizardStep[] = [
  { label: "Welcome To Restore", component: WelcomeView }, //0
  { label: "Login", component: EnterCredentialsView }, //0
  { label: "Restore", component: RestoreBackupsView }, //0
];

</script>

<style scoped>
.page-corner-effect {
  position: fixed;
  bottom: 0;
  right: 0;
  width: 10%;
  height: 40%;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.1) 100%);
  clip-path: polygon(100% 100%, 0% 100%, 100% 0%);
  z-index: 1;
  transform: rotate(0deg);
  opacity: 0.8;
  pointer-events: none;
}

.double-arrow {
  bottom: 10%;
  font-size: 5rem;
  animation: doubleArrowPulse 1.6s infinite ease-in-out;
}

@keyframes doubleArrowPulse {

  0%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }

  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
</style>