<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { IPCMessageRouter, IPCRouter, type BackUpSetupConfig, type BackUpTask } from '@45drives/houston-common-lib';
import { Wizard, WizardStep } from '../../components/wizard';
import ChooseManageView from './ChooseManageView.vue';
import ChooseDifficultyView from './ChooseDifficultyView.vue';
import AccessYourBackUpsView from './AccessYourBackUpsView.vue';
import AccessBackUpView from './AccessBackUpView.vue';
import CreateSimpleBackUpView from './CreateSimpleBackupView.vue'
import WelcomeView from './WelcomeView.vue';
import CustomizeBackupView from './CustomizeBackupView.vue';
import { inject, onBeforeMount, onMounted, provide, reactive } from 'vue';
import { BackUpSetupConfigGlobal } from './BackUpSetupConfigGlobal';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();



onMounted(() => {

  IPCRouter.getInstance().addEventListener('sendBackupTasks', (data: BackUpTask[]) => {
    console.log("setting backups: ", data)
    BackUpSetupConfigGlobal.getInstance().backUpTasks = data;
  });

  IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks');
 
});

const steps: WizardStep[] = [
   { label: "Welcome", component: WelcomeView },


  //{ label: "Manage Backups", component: ChooseManageView, nextStep: (data) => (data.choice === "createBackup" ? 2 : 3) },
 // { label: "BackUp Setup Option", component: ChooseDifficultyView, nextStep: () => 5 },
//{ label: "Access Backups", component: AccessYourBackUpsView, nextStep: () => 4 },
{ label: "Create SImple BackUp", component: CreateSimpleBackUpView },

//  { label: "Access Backup", component: AccessBackUpView, nextStep: () => 5 },
];

</script>

<style scoped></style>
