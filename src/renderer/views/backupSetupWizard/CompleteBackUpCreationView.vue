<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col items-center w-full h-full px-6 py-4 overflow-y-auto">

      <!-- Progress Steps -->
      <div v-if="completedSteps.length" class="w-full max-w-lg mb-4 space-y-1">
        <div v-for="completedStep in completedSteps" :key="completedStep.message" class="text-left">
          <div class="smallcheckmark">Done - {{ completedStep.message }}</div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="text-red-500 mb-4">
        {{ error }}
      </div>

      <!-- Success Content -->
      <div v-if="setupComplete === 'yes' && !error"
        class="flex flex-col items-center flex-1 justify-center max-w-xl text-left">
        <div class="checkmark text-3xl mb-2">Complete!</div>
        <p class="text-xl font-semibold mb-4">
          Your Backup Plan is Now Active.
        </p>
        <div class="space-y-3 text-base leading-relaxed text-muted">
          <p>
            All backup tasks have been successfully configured. Your data will now be protected automatically through
            scheduled backups.
          </p>
          <p>
            You can now monitor and manage your backups through the <strong class="text-default">Backup Manager</strong>, or configure
            additional storage servers as needed.
          </p>
          <p>
            Backups require this computer and the backup server to be powered on at scheduled times.
          </p>
        </div>

        <div v-if="needsFullDiskAccess" class="mt-4 w-full p-3 text-sm bg-yellow-500/40 rounded-md space-y-2">
          <p>
            <strong>One more step — turn on Full Disk Access.</strong>
            You're backing up a folder macOS protects, so the background backup service needs
            Full Disk Access or your scheduled backups will fail. macOS gives no way to ask for
            this automatically, so it has to be switched on by hand. It only takes a moment and
            you only do it once.
          </p>
          <button type="button" class="btn btn-secondary h-fit" @click="openFdaSettings">
            Open Full Disk Access settings
          </button>
          <p class="text-xs opacity-80">
            <strong>StorageWizardBackup</strong> is already in the list with its switch turned
            <strong>off</strong> — turn it on. If it isn't listed, drag it in from the Finder window
            that opens, or use the + button and press ⌘⇧G to paste:
            <code>{{ fdaDaemonPath }}</code>
          </p>
        </div>
      </div>

    </div>

    <template #footer>

      <div class="button-group-row justify-end">

        <!-- <button :disabled="setupComplete !== 'yes'" class="btn btn-secondary h-fit" @click="goToSetupWizard">
          Setup More Storage Servers
        </button> -->
        <button :disabled="setupComplete !== 'yes'" class="btn btn-secondary h-fit" @click="goToSetupWizard">
          Go to Dashboard
        </button>
        <button :disabled="setupComplete !== 'yes'" class="btn btn-primary h-fit" @click="goToBackupWizard">
          Go To Backup Manager
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
import { backUpSetupConfigKey, closeWizardModalKey, thisOsInjectionKey } from "../../keys/injection-keys";
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
const thisOs = inject(thisOsInjectionKey);

const needsFullDiskAccess = ref(false);
const fdaDaemonPath = ref('');

const openFdaSettings = () => window.electron.macOpenFdaSettings();

watch(setupComplete, async (value) => {
  if (value === "yes" && backUpSetupConfig) {
    // Read before the task list is cleared below.
    if (thisOs === 'mac') await checkFullDiskAccess(backUpSetupConfig.backUpTasks.map(t => t.source));
    backUpSetupConfig.backUpTasks = [];
  }
});

/**
 * Scheduling has already primed the app's own TCC prompts, so by now the daemon has been
 * installed and has reported whether it holds Full Disk Access. Only warn when a source
 * actually sits in a protected location.
 */
async function checkFullDiskAccess(sources: string[]): Promise<void> {
  for (const source of sources) {
    const fda = await window.electron.macFdaStatus(source);
    if (fda?.supported && fda.sourceNeedsAccess && fda.status !== 'granted') {
      fdaDaemonPath.value = fda.daemonPath;
      needsFullDiskAccess.value = true;
      return;
    }
  }
}

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
  if (backUpSetupConfig) {
    backUpSetupConfig.backUpTasks = [];
    backUpSetupConfig.username = '';
    backUpSetupConfig.password = '';
  }
  closeWizardModal();
  router.push({ name: 'dashboard' });
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
.checkmark {
  font-size: 3rem;
  color: var(--btn-success-bg, #22C55E);
  margin: 1rem 0;
}

.smallcheckmark {
  color: var(--btn-success-bg, #22C55E);
}
</style>
