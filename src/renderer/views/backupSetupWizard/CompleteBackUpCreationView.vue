<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col items-center justify-center text-center w-full h-full py-2">
      <!-- Complete Section -->
      <div class="complete-section flex flex-col items-center justify-center text-center">

        <div class="flex flex-col space-y-4 mt-[2rem]">
          <div class="overflow-y-auto max-h-[40vh] p-2 space-y-4">
            <div v-for="completedStep in completedSteps" class="w-full max-w-xl text-left">
              <div class="smallcheckmark ">Done - {{ completedStep.message }}</div>
            </div>
          </div>
        </div>
        
        <div v-if="error" class="text-red-500">
          {{ error }}
        </div>

        <div v-if="setupComplete === 'yes' && !error"
          class="flex flex-col items-center mt-1 px-4 py-4 max-w-6xl">
          <div class="checkmark text-3xl mb-3">Complete - DONE!</div>
          <p class="text-2xl mb-2 text-center">
            Your Backup Plan is Now Active.
          </p>
          <p class="text-lg mb-2 text-center leading-relaxed">
            All backup tasks have been successfully configured. Your data will now be protected automatically through
            scheduled backups.
          </p>
          <p class="text-lg mb-2 text-center leading-relaxed">
            You can now monitor and manage your backups through the <strong>Backup Manager</strong>, or configure
            additional storage servers as needed.
          </p>
          <p class="text-lg mb-2 text-center leading-relaxed">
            Backups require this computer and the backup server to be powered on at scheduled times.
          </p>
        </div>

      </div>
    </div>

    <!-- Go to Home Button (visible once complete) -->
    <template #footer>

      <div class="button-group-row justify-end">

        <button :disabled="setupComplete !== 'yes'" class="btn btn-primary h-fit" @click="goToBackupWizard">
          Go To Backup Manager
        </button>

        <button :disabled="setupComplete !== 'yes'" class="btn btn-secondary h-fit" @click="goToSetupWizard">
          Setup More Storage Servers
        </button>

      </div>
    </template>

  </CardContainer>

</template>

<script setup lang="ts">
import { CardContainer, useEnterToAdvance } from "@45drives/houston-common-ui";
import { ref, watch, inject, onActivated, onBeforeUnmount } from "vue";
import { useWizardSteps} from "@45drives/houston-common-ui";
import { EasySetupProgress, IPCRouter } from "@45drives/houston-common-lib";
import { backUpSetupConfigKey, closeWizardModalKey } from "../../keys/injection-keys";
import type { BackUpSetupConfig } from "@45drives/houston-common-lib";
import { useHeader } from '../../composables/useHeader'
import { useRouter } from 'vue-router'
const router = useRouter()

useHeader('Congratulations')
// const { setStep } = useWizardSteps('backup-new');

const setupComplete = ref<string>("no");
const error = ref<string>();
const completedSteps = ref<EasySetupProgress[]>([]);
const backUpSetupConfig = inject(backUpSetupConfigKey);
const closeWizardModal = inject(closeWizardModalKey, () => router.push({ name: 'backup-manage' }));

watch(setupComplete, (value) => {
  if (value === "yes" && backUpSetupConfig) {
    backUpSetupConfig.backUpTasks = [];
  }
});

function goToBackupWizard(): void {

  if (backUpSetupConfig) {
    backUpSetupConfig.backUpTasks = [];
    backUpSetupConfig.username = '';
    backUpSetupConfig.password = '';
  }

  // setStep(0);

  closeWizardModal();
}

function goToSetupWizard(): void {
  IPCRouter.getInstance().send('renderer', 'action', JSON.stringify({
    type: 'show_wizard',
    wizard: 'storage'
  }));
}


function handleActionEvent(data: string) {
  try {
    const { type, status } = JSON.parse(data);
    if (type !== "backUpSetupStatus") return;

    if (status.message.startsWith("Error")) {
      error.value = status.message;
    }

    // Avoid duplicates
    if (!completedSteps.value.some(step => step.message === status.message)) {
      completedSteps.value.push(status);
    }

    if (error.value || status.step === status.total) {
      setupComplete.value = "yes";
    }
  } catch (err) {
    console.error("Failed to parse event data:", err);
  }
}

let listenerRegistered = false;

onActivated(() => {
  completedSteps.value = [];
  error.value = undefined;
  setupComplete.value = "no";

  if (!listenerRegistered) {
    IPCRouter.getInstance().addEventListener("action", handleActionEvent);
    listenerRegistered = true;
  }

  IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    type: "configureBackUp",
    config: backUpSetupConfig
  }));
});

onBeforeUnmount(() => {
  if (listenerRegistered) {
    IPCRouter.getInstance().removeEventListener("action", handleActionEvent);
    listenerRegistered = false;
  }
});


useEnterToAdvance(
  () => {
    if (setupComplete.value === "yes") {
      goToBackupWizard(); // Press Enter
    }
  },
  300,
  () => {
    if (setupComplete.value === "yes") {
      goToBackupWizard(); // ArrowRight = Finish
    }
  },
  undefined // no need to handle ArrowLeft on this screen
);
</script>

<style scoped>
.setup-container {
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
}

/* Step Progress */
.steps {
  margin-top: 2rem;
}

.progress {
  width: 100%;
  @apply bg-accent;
  border-radius: 4px;
  overflow: hidden;
  height: 20px;
  margin: 1rem 0;
}

.progress-bar {
  height: 100%;
  background: var(--btn-success-bg, #22C55E);
  transition: width 0.4s ease;
}

/* Complete Section */
.complete-section {
  border-radius: 1rem;
}

.checkmark {
  font-size: 3rem;
  color: var(--btn-success-bg, #22C55E);
  margin: 1rem 0;
}

.smallcheckmark {
  color: var(--btn-success-bg, #22C55E);
}

/* Network Storage Section */
.network-section {
  margin-top: 2rem;
  text-align: left;
  @apply border-t border-default;
  padding-top: 1rem;
}

/* Automatic Install Subsection */
.auto-install {
  margin-bottom: 1.5rem;
}

.auto-install h3 {
  margin-bottom: 0.5rem;
}

/* Manual Options */
.manual-options {
  margin-bottom: 1.5rem;
}

.manual-buttons button {
  margin: 0.2rem;
}

/* Home Button */
.home-button {
  margin-top: 1rem;
}

/* Small info text */
.small-info {
  font-size: 0.9rem;
  @apply text-muted;
  margin-top: 0.5rem;
}
</style>
