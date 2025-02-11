<script setup lang="ts">
import { defineWizardSteps, type WizardStep } from "./index";
import WizardStepView from "./WizardStepView.vue";
import StepsHeader from "./StepsHeader.vue";
import { defineProps, watch } from "vue";

const props = defineProps<{
  steps: WizardStep[];
  onComplete: Function
}>();

const state = defineWizardSteps(props.steps);

watch(state, () => {
  if (state.completedSteps.value.filter(completed => completed == true).length === props.steps.length) {
    props.onComplete();
  }
});

</script>

<template>
  <div class="flex flex-col">
    <StepsHeader v-bind="state" />
    <WizardStepView v-bind="state" class="grow" />
  </div>
</template>
