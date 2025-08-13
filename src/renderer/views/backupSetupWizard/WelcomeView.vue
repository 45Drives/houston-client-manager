<template>
  <CardContainer v-if="!hasTargetStep" class="overflow-y-auto min-h-0">

    <div class="flex flex-col h-full justify-center items-center">

      <p class="w-9/12 text-left text-2xl">
        Your data is precious—protect it with the power of backups! A backup ensures your files are safe from accidents,
        failures, and digital mischief. Set up your protection now and keep your data secure, always.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        We will set up automated backups with your chosen folders and schedule when they should happen. Back up tasks
        will be added to your system so you don’t have to worry.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        This setup wizard will guide you through the steps to get your backups setup quickly.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        Anywhere you see this icon: &nbsp;
        <CommanderToolTip :message="`Welcome to the 45Drives Setup Wizard! \n I'm the Houston Commander, and I'm here to show you some tips, tricks and information. 
          Click anywhere outside of these popups (or the X in the top-right corner) to close them.`" />
        &nbsp; it means that your new friend Houston Commander has something to say!
        Simply hover your mouse cursor over the icon and you will see him pop up.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        To get started, simply click <b>NEXT</b>
      </p>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button type="button" @click="goBackStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>
        <button type="button" @click="proceedToNextStep" class="btn btn-primary w-40 h-20">
          Next
        </button>
      </div>
    </template>

  </CardContainer>
  <div v-else style="height: 1px;" />
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import { useWizardSteps, useEnterToAdvance } from '@45drives/houston-common-ui';
import { useRoute, useRouter } from 'vue-router'
import { useHeader } from '../../composables/useHeader'
import { computed, onBeforeMount, onMounted, watch } from 'vue';
useHeader('Welcome to the 45Drives Backup Manager!')
const route = useRoute();
const router = useRouter()

const { setStep, steps, completeCurrentStep } = useWizardSteps("backup-root");
const hasTargetStep = computed(() => route.query.step != null)
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

onBeforeMount(() => {
  const raw = route.query.step
  if (raw == null) return
  const s = Number(raw)
  if (Number.isNaN(s)) return

  const max = steps.value.length - 1
  // Jump to the requested step BEFORE this component mounts,
  // so Welcome is never actually inserted into the DOM.
  setStep(clamp(s, 0, max))
});


const proceedToNextStep = async () => {
  completeCurrentStep();
};

useEnterToAdvance(
  () => {
    proceedToNextStep(); // Enter
  },
  200, // debounce time for Enter
  () => {
    proceedToNextStep(); // ArrowRight
  }
);

const goBackStep = () => {
  router.push({ name: 'dashboard' }) // or use a path: router.push('/dashboard')
}
</script>

<style scoped></style>
