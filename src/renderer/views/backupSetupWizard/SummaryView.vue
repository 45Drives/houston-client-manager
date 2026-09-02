<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col gap-4 w-full">
      <!-- Intro -->
      <p class="text-sm text-center text-muted">
        Review your backup configuration below. Click <span class="font-semibold">Next</span> to proceed
        or <span class="font-semibold">Back</span> to make changes.
      </p>

      <!-- OS-specific warnings -->
      <p v-if="(thisOs === 'rocky' || thisOs === 'debian') && isFirstBackupRun"
        class="p-2 text-sm bg-red-500/50 font-bold rounded-md text-center">
        Note: On Linux, if this is your first backup, you will be prompted for your admin password
        to set up the server connection.
      </p>
      <p v-if="thisOs === 'mac' && isFirstBackupRun"
        class="p-2 text-sm bg-red-500/50 font-bold rounded-md text-center">
        Note: On macOS, the first backup installs a background service so your backups keep running
        when you're signed out. You'll be asked for your admin password once.
      </p>

      <div v-if="thisOs === 'mac' && needsFullDiskAccess"
        class="p-2 text-sm bg-yellow-500/40 rounded-md space-y-2">
        <p>
          <strong>Full Disk Access required.</strong>
          {{ fdaProtectedSource
            ? 'This backup reads from a folder macOS protects (Desktop, Documents, Downloads, iCloud Drive or an external volume).'
            : 'Scheduled backups may not be able to read protected folders.' }}
          Scheduled runs will fail until the backup service is granted access. macOS gives no way to
          ask for this automatically, so it has to be granted once by hand.
        </p>
        <button type="button" class="btn btn-secondary h-fit" @click="openFdaSettings">
          Open Full Disk Access settings
        </button>
        <p class="text-xs opacity-80">
          The service will be revealed in Finder — drag it into the list, or use the + button and
          press ⌘⇧G to paste: <code>{{ fdaDaemonPath }}</code>
        </p>
      </div>

      <!-- Backup Location -->
      <div class="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/5 border border-default">
        <span class="text-sm font-semibold whitespace-nowrap">Backup Location</span>
        <CommanderToolTip :message="'This is the designated backup storage location you configured earlier.'" />
        <span class="text-sm break-all">{{ `${actualHost}:${actualShare}` }}</span>
      </div>

      <!-- Backup Tasks -->
      <div v-if="backUpSetupConfig?.backUpTasks && backUpSetupConfig.backUpTasks.length > 0"
        class="overflow-y-auto max-h-[40vh] space-y-3 pr-1">
        <div v-for="(task, index) in backUpSetupConfig.backUpTasks" :key="index"
          class="rounded-md border border-default p-3 space-y-1.5">
          <div class="flex items-baseline gap-2">
            <span class="text-xs font-semibold uppercase tracking-wide text-muted">Task</span>
            <span class="text-sm font-semibold">{{ task.name || 'Folder' }}</span>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="font-medium text-muted">Source</dt>
            <dd class="break-all">{{ task.source }}</dd>
            <dt class="font-medium text-muted">Frequency</dt>
            <dd class="capitalize">{{ formatFrequency(task.schedule.repeatFrequency) }}</dd>
            <dt class="font-medium text-muted">Starts</dt>
            <dd>{{ task.schedule.startDate.toDateString() }} at {{ task.schedule.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</dd>
          </dl>
        </div>
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row justify-between">
        <button @click="proceedToPreviousStep" class="btn btn-secondary h-fit">Back</button>
        <button @click="handleNextClick" class="btn btn-primary h-fit">Next</button>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, confirm, useEnterToAdvance } from "@45drives/houston-common-ui";
import { inject, onMounted, ref } from "vue";
import { useWizardSteps} from '@45drives/houston-common-ui';
import { backUpSetupConfigKey, thisOsInjectionKey } from "../../keys/injection-keys";
import { formatFrequency } from "./utils";
import { useHeader } from '../../composables/useHeader'
useHeader('Summary')

const thisOs = inject(thisOsInjectionKey);

const isFirstBackupRun = ref(false);

const { completeCurrentStep, prevStep } = useWizardSteps("backup-new");

const backUpSetupConfig = inject(backUpSetupConfigKey);

const actualHost = ref('');
const actualShare = ref('');

const needsFullDiskAccess = ref(false);
const fdaProtectedSource = ref(false);
const fdaDaemonPath = ref('');

const openFdaSettings = () => window.electron.macOpenFdaSettings();

onMounted(async () => {

  const target = backUpSetupConfig?.backUpTasks?.[0]?.target;
  if (!target) return;

  const [host, path] = target.split(":");
  const share = path.split("/")[0];
  // display prefers the name the user picked; the probe below needs the real host
  actualHost.value = (backUpSetupConfig as any)?.serverDisplayHost || host;
  actualShare.value = share;
  const result = await window.electron.isFirstRunNeeded(host, share, backUpSetupConfig.username);

  isFirstBackupRun.value = result;

  if (thisOs === 'mac') {
    const source = backUpSetupConfig?.backUpTasks?.[0]?.source;
    const fda = await window.electron.macFdaStatus(source);
    if (fda?.supported) {
      fdaDaemonPath.value = fda.daemonPath;
      fdaProtectedSource.value = fda.sourceNeedsAccess;
      // "unknown" means the daemon has not reported yet, so don't cry wolf on a fresh install.
      needsFullDiskAccess.value = fda.status === 'denied' && (fda.sourceNeedsAccess || fda.daemonInstalled);
    }
  }
});


const proceedToNextStep = async () => {
  completeCurrentStep();
};

const proceedToPreviousStep = () => {
  prevStep();
};

const handleNextClick = async () => {
  proceedToNextStep();

};

useEnterToAdvance(
  async () => {
    await handleNextClick(); // Enter
  },
  200, // debounce time for Enter
  async () => {
    await handleNextClick(); // ArrowRight
  },
  async () => {
    await proceedToPreviousStep(); // ArrowLeft
  }
);
</script>
