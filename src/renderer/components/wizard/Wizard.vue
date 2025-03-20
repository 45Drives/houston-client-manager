<script setup lang="ts">
import { createWizardInjectionKey, defineWizardSteps, type WizardStep } from "./index";
import WizardStepView from "./WizardStepView.vue";
import StepsHeader from "./StepsHeader.vue";
import { defineProps, watch } from "vue";

const props = defineProps<{
  id: string,
  steps: WizardStep[];
  onComplete: (data: any) => void;
  hideHeader?: boolean;
}>();

console.log(props.id);

const state = defineWizardSteps(props.steps, createWizardInjectionKey(props.id));
console.log("defined")

watch(
  () => state.completedSteps,  // Watch only completedSteps
  (newCompletedSteps) => {
    console.log(newCompletedSteps);

    if (newCompletedSteps.value.filter(completed => completed === true).length === props.steps.length) {
      props.onComplete(state.data);
    }
  },
  { deep: true } // Ensure it tracks changes inside the array
);
</script>

<template>
  <div class="flex flex-col">
    <StepsHeader v-if="!hideHeader" v-bind="state" />
    <WizardStepView v-bind="state" class="grow" />
  </div>
</template>
