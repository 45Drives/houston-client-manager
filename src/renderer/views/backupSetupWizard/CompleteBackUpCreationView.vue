<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col items-center justify-center text-center w-full h-full py-2">
      <!-- Complete Section -->
      <div class="complete-section flex flex-col items-center justify-center text-center">

        <div class="flex flex-col space-y-4 mt-[2rem]">
          <div class="overflow-y-auto max-h-[40vh] p-2 space-y-4">
            <div v-for="completedStep in completedSteps" class="w-full max-w-xl text-left">
              <div class="smallcheckmark ">✔ - {{ completedStep.message }}</div>
            </div>
          </div>
        </div>
        
        <div v-if="error" class="text-red-500">
          🔴 {{ error }}
        </div>

        <div v-if="setupComplete === 'yes' && !error"
          class="flex flex-col items-center mt-1 px-4 py-4 max-w-6xl">
          <div class="checkmark text-3xl mb-3">✔ - DONE!</div>
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

        <button :disabled="setupComplete !== 'yes'" class="btn btn-primary w-40 h-20" @click="goToBackupWizard">{{
          "Go To Backup Manager" }}</button>

        <button :disabled="setupComplete !== 'yes'" class="btn btn-secondary w-40 h-20" @click="goToSetupWizard">{{
          "Setup More Storage Servers" }}</button>

      </div>
    </template>

  </CardContainer>

</template>

<script setup lang="ts">
import { CardContainer, useEnterToAdvance } from "@45drives/houston-common-ui";
import { ref, watch, inject, onActivated, onBeforeUnmount } from "vue";
import { useWizardSteps} from "@45drives/houston-common-ui";
import { EasySetupProgress, IPCRouter } from "@45drives/houston-common-lib";
import { backUpSetupConfigKey } from "../../keys/injection-keys";
import { useHeader } from '../../composables/useHeader'
useHeader('Congratulations')
const { setStep } = useWizardSteps('backup');

const setupComplete = ref<string>("no");
const error = ref<string>();
const completedSteps = ref<EasySetupProgress[]>([]);
const backUpSetupConfig: any = inject(backUpSetupConfigKey);

watch(setupComplete, (value) => {
  if (value === "yes" && backUpSetupConfig) {
    backUpSetupConfig.backUpTasks = [];
  }
});

function goToBackupWizard(): void {
  // console.debug("before clearing: ", backUpSetupConfig)

  if (backUpSetupConfig) {
    for (const key in backUpSetupConfig) {
      if (Array.isArray(backUpSetupConfig[key])) {
        backUpSetupConfig[key] = [];
      } else if (typeof backUpSetupConfig[key] === 'object' && backUpSetupConfig[key] !== null) {
        backUpSetupConfig[key] = {};
      } else {
        backUpSetupConfig[key] = null;
      }
    }
  }

  // console.debug("after clearing: ", backUpSetupConfig);
  setStep(1);
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
  background: #ddd;
  border-radius: 4px;
  overflow: hidden;
  height: 20px;
  margin: 1rem 0;
}

.progress-bar {
  height: 100%;
  background: #4caf50;
  transition: width 0.4s ease;
}

/* Complete Section */
.complete-section {
  border-radius: 1rem;
}

.checkmark {
  font-size: 3rem;
  color: #4caf50;
  margin: 1rem 0;
}

.smallcheckmark {
  /* font-size: 5rem; */
  color: #4caf50;
  /* margin: 1rem 0; */
}

/* Network Storage Section */
.network-section {
  margin-top: 2rem;
  text-align: left;
  border-top: 1px solid #ccc;
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
  color: #555;
  margin-top: 0.5rem;
}
</style>
