<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="relative flex items-center justify-center h-18  w-full">
 <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Congratulations
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col items-center justify-center text-center w-full h-full py-2">
      <!-- Complete Section -->
      <div class="complete-section flex flex-col items-center justify-center text-center">

        <div v-for="completedStep in completedSteps" class="w-full max-w-xl text-left">
          <div class="smallcheckmark ">✔ - {{ completedStep.message }}</div>
        </div>

        <div v-if="error" class="text-red-500">
          🔴 {{ error }}
        </div>

        <div v-if="setupComplete === 'yes' && !error" class="flex justify-center">
          <div class="text-left max-w-3xl">
            <div class="checkmark text-center">✔ - DONE!</div>
            <h2 class="text-2xl font-semibold mb-4">Backup Plan Configured</h2>
            <p class="mb-4 text-lg">Your backup plan has been successfully set up and is now protecting your data
              automatically.</p>
            <p class="mb-4 text-lg">There’s nothing more to worry about—your files are safe and secure. Sit back, relax,
              and let the scheduled backups do the work.</p>
            <p class="mb-4 text-lg">Backups will continue to run as scheduled to ensure your data stays protected.</p>

            <p class="mb-4 text-lg">NOTE: This computer and the server will have to turn on for backups to happen.</p>

            <p class="mb-4 text-lg font-medium">Click "Finish" to complete the setup.</p>
          </div>
        </div>

      </div>
    </div>

    <!-- Go to Home Button (visible once complete) -->
    <template #footer>
      <div class="button-group-row justify-end">
        <button :disabled="setupComplete !== 'yes'" class="btn btn-primary w-40 h-20" @click="goHome">{{ "Finish!"
          }}</button>
      </div>
    </template>

  </CardContainer>

</template>

<script setup lang="ts">
import { CardContainer, useEnterToAdvance } from "@45drives/houston-common-ui";
import { ref, watch, inject, onActivated, onBeforeUnmount } from "vue";
import { useWizardSteps, DynamicBrandingLogo } from "@45drives/houston-common-ui";
import { EasySetupProgress, IPCRouter } from "@45drives/houston-common-lib";
import { backUpSetupConfigKey, divisionCodeInjectionKey } from "../../keys/injection-keys";
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
const division = inject(divisionCodeInjectionKey);
const { reset } = useWizardSteps('backup');

const setupComplete = ref<string>("no");
const error = ref<string>();
const completedSteps = ref<EasySetupProgress[]>([]);
const backUpSetupConfig: any = inject(backUpSetupConfigKey);

watch(setupComplete, (value) => {
  if (value === "yes" && backUpSetupConfig) {
    backUpSetupConfig.backUpTasks = [];
  }
});

function goHome(): void {
  console.log("before clearing: ", backUpSetupConfig)

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

  console.log("after clearing: ", backUpSetupConfig);
  reset();  // Assuming this is the wizard reset
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
      goHome(); // Press Enter
    }
  },
  300,
  () => {
    if (setupComplete.value === "yes") {
      goHome(); // ArrowRight = Finish
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
