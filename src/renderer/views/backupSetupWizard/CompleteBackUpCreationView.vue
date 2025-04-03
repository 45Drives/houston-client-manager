<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="flex justify-center text-3xl">Congratulations</div>
    </template>

    <!-- Complete Section -->
    <div class="complete-section text-center">

      <div v-for="completedStep in completedSteps">
        <div class="smallcheckmark ">✔ - {{ completedStep.message }}</div>
      </div>

      <div v-if="error" class="text-red-500">
        🔴 {{ error }}
      </div>

      <div v-if="setupComplete === 'yes' && !error">
        <div class="checkmark">✔ - DONE! </div>
        <p class="mb-6 text-center text-2xl">🎉 Congratulations! Your Backup Plan is Set! 🚀</p>
        <p class="mb-6 text-center text-2xl">Great job! Your data is now protected with an automatic backup plan. No
          more
          worries—your files are safe and secure. Sit back, relax, and let the backups run!</p>
        <p class="mb-6 text-center text-2xl">🔄 Your backups will run as scheduled—keeping your important files safe!
        </p>
        <p class="mb-6 text-center text-2xl">Just click FINISH!</p>
      </div>
    </div>

    <!-- Go to Home Button (visible once complete) -->
    <template #footer>
      <div class="button-group-row justify-end">
        <button :disabled="setupComplete !== 'yes'" class="btn btn-secondary w-40 h-20" @click="goHome">{{ "Finish!"
          }}</button>
      </div>
    </template>

  </CardContainer>

</template>

<script setup lang="ts">
import { CardContainer } from "@45drives/houston-common-ui";
import { ref, watch, inject, onActivated } from "vue";
import { useWizardSteps } from "@45drives/houston-common-ui";
import { EasySetupProgress, IPCRouter } from "@45drives/houston-common-lib";
import { backUpSetupConfigKey } from "../../keys/injection-keys";

const { reset } = useWizardSteps('backup');

const setupComplete = ref<string>("no");
const error = ref<string>();
const completedSteps = ref<EasySetupProgress[]>([]);
const backUpSetupConfig = inject(backUpSetupConfigKey);

watch(setupComplete, (value) => {
  if (value === "yes" && backUpSetupConfig) {
    backUpSetupConfig.backUpTasks = []
  }
})

function goHome(): void {
  reset();
}

onActivated(() => {
  completedSteps.value = [];
  error.value = undefined;
  setupComplete.value = 'no';
  
  try {
    IPCRouter.getInstance().addEventListener('action', (data) => {

      try {
        const backUpSetupStatus = JSON.parse(data);

        if (backUpSetupStatus.type === "backUpSetupStatus") {
          const status: EasySetupProgress = backUpSetupStatus.status;
          const newCompletedSteps = [...completedSteps.value];

          if (status.message.startsWith("Error")) {

            error.value = status.message;
          } else {

            newCompletedSteps.push(status);
          }

          completedSteps.value = newCompletedSteps;

          if (error.value) {
            setupComplete.value = "yes";
          } else if (status.step === status.total) {
            setupComplete.value = "yes";
          }
        }
      } catch (error) {
      }
    })

    IPCRouter.getInstance().send('backend', 'action',
      JSON.stringify(
        {
          type: 'configureBackUp',
          config: backUpSetupConfig
        })
    );

  } catch (error) {
    console.error("45D Caught error:", error);
  }
});


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
  font-size: 5rem;
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
