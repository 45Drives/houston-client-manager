<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)" :hideHeader="true"
    class="h-full flex-1 text-default bg-default" />

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
  // { label: "Restore Backups", component: RestoreBackupsView }, //0
  { label: "Welcome To Restore", component: WelcomeView }, //0
  { label: "Login", component: EnterCredentialsView }, //0
  { label: "Restore", component: RestoreBackupsView }, //0
];

</script>

<style scoped></style>
