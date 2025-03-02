<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { IPCMessageRouter, IPCRouter, type BackUpSetupConfig, type BackUpTask } from '@45drives/houston-common-lib';
import { Wizard, WizardStep } from '../../components/wizard';
import ChooseManageView from './ChooseManageView.vue';
import ChooseDifficultyView from './ChooseDifficultyView.vue';
import AccessYourBackUpView from './AccessYourBackUpView.vue';
import WelcomeView from './WelcomeView.vue';
import CustomizeBackupView from './CustomizeBackupView.vue';
import { inject, onMounted, provide, reactive } from 'vue';
import { backUpSetupConfigKey } from '../../keys/injection-keys';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

const backupConfig = reactive<BackUpSetupConfig>({
  backUpTasks: []
});

onMounted(() => {

  IPCRouter.getInstance().addEventListener('sendBackupTasks', (data: BackUpTask[]) => {

    console.log("Sendbackuptaks", data);

    backupConfig.backUpTasks = data;
  });

  IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks');
 
});

const steps: WizardStep[] = [
  { label: "Welcome", component: WelcomeView },
  { label: "Manage Backups", component: ChooseManageView, nextStep: (data) => (data.choice === "createBackup" ? 2 : 3) },
  { label: "BackUp Setup Option", component: ChooseDifficultyView, nextStep: () => 4 },
  { label: "Access Backups", component: AccessYourBackUpView, nextStep: () => 4 },
];

provide(backupConfig, backUpSetupConfigKey);
</script>

<style scoped></style>
