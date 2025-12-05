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
import CreateSimpleBackUpView from './CreateSimpleBackupView.vue';
import WelcomeView from './WelcomeView.vue';
import SummaryView from './SummaryView.vue';
import CustomizeBackupView from './CustomizeBackupView.vue';
import CompleteBackUpCreationView from './CompleteBackUpCreationView.vue';
import EnterSmbCredBackUpSetupView from './EnterSmbCredBackUpSetupView.vue';

import { provide, reactive } from 'vue';
import { backUpSetupConfigKey, reviewBackUpSetupKey } from '../../keys/injection-keys';

const props = defineProps<{
  id: string;
  onComplete: (data: any) => void;
}>();

// Shared backup setup state (extend it with mode + planType)
const setup = reactive({
  mode: null as 'createBackup' | 'accessBackups' | null,
  planType: null as 'simple' | 'custom' | null,
  backUpTasks: [] as any[],
  username: '',
  password: '',
});

provide(backUpSetupConfigKey, setup);
provide(reviewBackUpSetupKey, reactive({ tasks: [] }));

const steps: WizardStep[] = [
  // 0
  {
    label: 'Welcome',
    component: WelcomeView,
  },
  // 1
  {
    label: 'Manage Backups',
    component: ChooseManageView,
    prevStep: () => 0, // back -> Welcome
    nextStep: (data) => {
      // data.choice: "createBackup" | "accessBackups"
      setup.mode = data.choice;
      return data.choice === 'createBackup' ? 2 : 3;
    },
  },
  // 2
  {
    label: 'Backup Setup Option',
    component: ChooseDifficultyView,
    prevStep: () => 1, // back -> Manage Backups
    nextStep: (data) => {
      // data.planType: "simple" | "custom"
      setup.planType = data.planType;
      return data.planType === 'simple' ? 5 : 6;
    },
  },
  // 3
  {
    label: 'Access Backups',
    component: AccessYourBackUpsView,
    prevStep: () => 1, // back -> Manage Backups
    // if you want a "Next" here, go to the AccessBackup step
    // nextStep: () => 4,
  },
  // 4
  {
    label: 'Access Backup',
    component: AccessBackUpView,
    prevStep: () => 3, // back -> Access Backups
    nextStep: () => 7, // into Credentials
  },
  // 5
  {
    label: 'Create Simple Backup',
    component: CreateSimpleBackUpView,
    prevStep: () => 2, // back -> Backup Setup Option
    nextStep: () => 7, // into Credentials
  },
  // 6
  {
    label: 'Create Custom BackUp',
    component: CustomizeBackupView,
    prevStep: () => 2, // back -> Backup Setup Option
    nextStep: () => 7, // into Credentials
  },
  // 7
  {
    label: 'Credentials',
    component: EnterSmbCredBackUpSetupView,
    // you explicitly said: 7 prev should be 4
    // (even if you came from simple/custom, you can tweak this if you want to go back to 5/6 instead)
    prevStep: () => (setup.planType === 'simple' ? 5 : 6),
    nextStep: () => 8,
  },
  // 8
  {
    label: 'Summary',
    component: SummaryView,
    // “prev should be 5 or 6 (whichever user navigated from)”
    // use shared setup.planType instead of overloaded data.choice
    prevStep: () => (setup.planType === 'simple' ? 5 : 6),
    nextStep: () => 9,
  },
  // 9
  {
    label: 'Complete',
    component: CompleteBackUpCreationView,
    prevStep: () => 8, // back -> Summary
  },
];
</script>
