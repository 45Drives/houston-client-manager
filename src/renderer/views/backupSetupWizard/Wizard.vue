<template>

  <Wizard :id="props.id" :steps="steps" :onComplete="data => props.onComplete(data)"
    class="h-full flex-1 text-default bg-default" />

</template>

<script setup lang="ts">
import { Wizard, WizardStep } from '../../components/wizard';
import ChooseManageView from './ChooseManageView.vue';
import ChooseDifficultyView from './ChooseDifficultyView.vue';
import AccessYourBackUpView from './AccessYourBackUpView.vue';
import WelcomeView from './WelcomeView.vue';

const props = defineProps<{
  id: string,
  onComplete: (data: any) => void;
}>();

const steps: WizardStep[] = [
  { label: "Welcome", component: WelcomeView },
  { label: "Manage Backups", component: ChooseManageView, nextStep: (data) => (data.choice === "createBackup" ? 2 : 3) },
  { label: "BackUp Setup Option", component: ChooseDifficultyView, nextStep: () => 4 },
  { label: "Access Backups", component: AccessYourBackUpView, nextStep: () => 4 },
];

</script>

<style scoped></style>
