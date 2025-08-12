<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)" :hideHeader="true" :hideProgress="true"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard, WizardStep } from '@45drives/houston-common-ui';
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
import { backUpSetupConfigKey, reviewBackUpSetupKey } from '../../keys/injection-keys';
import EnterSmbCredBackUpSetupView from './EnterSmbCredBackUpSetupView.vue';
import BackupsHome from './BackupsHome.vue';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

provide(backUpSetupConfigKey, reactive({
  backUpTasks: [],
  username: "",
  password: "",
}))

provide(reviewBackUpSetupKey, reactive({ tasks: [] }))


const steps: WizardStep[] = [
  { label: "Backup Manager", component: BackupsHome}
  // { label: "Welcome", component: WelcomeView }, //0
  // { label: "Manage Backups", component: ChooseManageView, nextStep: (data) => (data.choice === "createBackup" ? 2 : 3) }, //1
  // { label: "Backup Setup Option", component: ChooseDifficultyView, nextStep: (data) => (data.choice === "simple" ? 5 : 6)},//2
  // { label: "Access Backups", component: AccessYourBackUpsView, previousStepIndex: 2},//3
  // { label: "Access Backup", component: AccessBackUpView, nextStep: () => 7, previousStepIndex: 3},//4
  // { label: "Create Simple Backup", component: CreateSimpleBackUpView, nextStep: () => 7 },//5
  // { label: "Create Custom BackUp", component: CustomizeBackupView },//6
  // { label: "Credentials", component: EnterSmbCredBackUpSetupView },//7
  // { label: "Summary", component: SummaryView },//8
  // { label: "Complete", component: CompleteBackUpCreationView },//9
];

</script>

<style scoped></style>
