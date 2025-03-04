<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard, WizardStep } from '../../components/wizard';
import ChooseManageView from './ChooseManageView.vue';
import ChooseDifficultyView from './ChooseDifficultyView.vue';
import AccessYourBackUpsView from './AccessYourBackUpsView.vue';
import AccessBackUpView from './AccessBackUpView.vue';
import CreateSimpleBackUpView from './CreateSimpleBackupView.vue'
import WelcomeView from './WelcomeView.vue';

import SummaryView from './SummaryView.vue';
import CustomizeBackupView from './CustomizeBackupView.vue';
import CompleteBackUpCreationView from './CompleteBackUpCreationView.vue';
import { provide, reactive } from 'vue';
import { backUpSetupConfigKey } from '../../keys/injection-keys';
import ChooseOnPremOrCloadView from './ChooseOnPremOrCloadView.vue';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

provide(backUpSetupConfigKey, reactive({
  backUpTasks: []
}))

const steps: WizardStep[] = [
  { label: "Welcome", component: WelcomeView },
  { label: "Manage Backups", component: ChooseManageView, nextStep: (data) => (data.choice === "createBackup" ? 2 : 3) },
  { label: "BackUp Setup Option", component: ChooseDifficultyView, nextStep: (data) => (data.choice === "simple" ? 5 : 6) },
  { label: "Access Backups", component: AccessYourBackUpsView },
  { label: "Access Backup", component: AccessBackUpView, nextStep: () => 7 },
  { label: "Where To Store Backup", component: ChooseOnPremOrCloadView, nextStep: (data) => (data.choice === "onprem" ? 6 : 7) },
  { label: "Create Simple Backup", component: CreateSimpleBackUpView },
  //{ label: "Create Custom BackUp", component: CustomizeBackupView },

  { label: "Summary", component: SummaryView },
  { label: "Complete", component: CompleteBackUpCreationView },
];

</script>

<style scoped></style>
