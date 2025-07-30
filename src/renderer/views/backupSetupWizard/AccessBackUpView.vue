<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Review Your Backups
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center text-default">
      <!-- Header with instructions -->
      <div>
        <p class="text-lg">
          Please provide your username and password to access the backup folders on the server:
        </p>
        <ul class="mt-2 list-disc list-inside text-blue-600">
          <li v-for="task in backupTasks" :key="task.uuid">
            {{ task.host }}:{{ task.share }}{{thisOs == 'win' ? '\\\\' : ''}}{{ task.target }}
          </li>
        </ul>
        <p class="text-lg mt-2">
          The share will be mounted once, and all relevant folders will be opened.
        </p>
      </div>

      <!-- Username and Password input fields -->
      <form @submit.prevent="handleOpen" class="flex flex-col gap-4 mt-4 text-default">
        <div class="grid relative grid-cols-[200px_1fr] items-center">
          <label for="username" class="font-semibold ">Username:</label>
          <input v-model="username" v-enter-next type="text" id="username"
            class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your username" />
        </div>
        <div class="grid relative grid-cols-[200px_1fr] items-center">
          <label for="password" class="font-semibold ">Password:</label>
          <input v-model="password" v-enter-next :type="showPassword ? 'text' : 'password'" id="password"
            class="bg-default p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your password" />
          <button type="button" @click="togglePassword"
            class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
            <EyeIcon v-if="!showPassword" class="w-5 h-5" />
            <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
          </button>
        </div>
        <button type="submit" class="hidden">Submit</button>
      </form>

      <!-- "Open" button -->
      <div class="mt-4 flex flex-row ">
        <button @click="handleOpen" :disabled="isButtonDisabled"
          class="w-full p-3 btn btn-secondary font-semibold rounded-md  disabled:cursor-not-allowed">
          Open
        </button>

        <LoadingSpinner v-if="openingBackup" />
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <div class="button-group-row w-full justify-between">
          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>
        </div>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { ref, computed, inject, watch } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance, useAutoFocus } from '@45drives/houston-common-ui';
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import { divisionCodeInjectionKey, reviewBackUpSetupKey, thisOsInjectionKey } from '../../keys/injection-keys';
useAutoFocus();
const division = inject(divisionCodeInjectionKey);
const { prevStep, wizardData } = useWizardSteps("backup");
const thisOs = inject(thisOsInjectionKey);

const reviewBackup = inject(reviewBackUpSetupKey);
const backupTasks = computed(() => reviewBackup?.tasks as BackUpTask[]);

const username = ref('');
const password = ref('');
const openingBackup = ref(false);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

// Check if the "Open" button should be disabled
// const isButtonDisabled = computed(() => openingBackup.value);
const isButtonDisabled = computed(() => !username.value || !password.value || openingBackup.value);

// Method to handle the "Open" button action
let smbMountListener: ((data: any) => void) | null = null;


// const handleOpen = () => {
//   if (!username.value || !password.value || backupTasks.value.length === 0) return;

//   openingBackup.value = true;

//   const sharesMounted: Set<string> = new Set();
//   let remainingShares = new Set(backupTasks.value.map(task => `${task.host}:${task.share}`));

//   smbMountListener = (data) => {
//     openingBackup.value = false;
//     try {
//       const response = JSON.parse(data);
//       if (response.action !== 'mountSmbResult') return;

//       let info: any = typeof response.result === 'string'
//         ? JSON.parse(response.result)
//         : response.result;

//       const mountPoint = info.MountPoint ?? (info.DriveLetter ? `${info.DriveLetter}:\\` : null);
//       if (!mountPoint) {
//         console.warn("No valid mount point found in result");
//         // Still mark this share as "processed" to prevent infinite wait
//         remainingShares.delete(`${info.smb_server}:${info.smb_share}`);
//         if (remainingShares.size === 0) {
//           openingBackup.value = false;
//           smbMountListener = null;
//         }
//         return;
//       }

//       const shareName = mountPoint.split(/[\\/]/).filter(Boolean).pop() ?? info.smb_share;
//       const mountedShare = `${info.smb_server}:${shareName}`;

//       sharesMounted.add(mountedShare);
//       remainingShares.delete(mountedShare);

//       if (remainingShares.size === 0) {
//         openingBackup.value = false;
//         smbMountListener = null;

//         for (const task of backupTasks.value) {
//           const normalizedTarget = task.target.startsWith('/') ? task.target : `/${task.target}`;

//           const mountPath =
//             thisOs?.value === 'win'
//               ? `${info.DriveLetter}:\\${task.target}`
//               : thisOs?.value === 'mac'
//                 ? `/Volumes/${task.share}${normalizedTarget}`
//                 : `/mnt/houston-mounts/${task.share}${normalizedTarget}`;

//           IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
//             type: 'openFolder',
//             path: mountPath
//           }));
//         }
//       }
//       if (smbMountListener) {
//         IPCRouter.getInstance().removeEventListener("action", smbMountListener);
//       }
//     } catch (e) {
//       console.error('Failed to parse SMB mount result:', e);
//       openingBackup.value = false;
//     }
//   };

//   IPCRouter.getInstance().addEventListener("action", smbMountListener);

//   // Initiate mount requests for each unique share
//   const uniqueShares = new Set(backupTasks.value.map(task => `${task.host}:${task.share}`));

//   for (const entry of uniqueShares) {
//     const [host, share] = entry.split(":");
//     IPCRouter.getInstance().send("backend", "mountSambaClient", {
//       smb_host: host,
//       smb_share: share,
//       smb_user: username.value,
//       smb_pass: password.value
//     });
//   }
// };

const handleOpen = () => {
  if (!username.value || !password.value || backupTasks.value.length === 0) return;

  openingBackup.value = true;

  // 1) Track which share‑keys we’re still waiting on
  //    Linux & macOS keys will be "host:share"
  //    Windows keys will be just "share"
  const remainingKeys = new Set<string>();
  for (const t of backupTasks.value) {
    if (thisOs!.value === 'win') {
      remainingKeys.add(t.share!);
    } else {
      remainingKeys.add(`${t.host}:${t.share}`);
    }
  }

  // 2) Store real mount points here
  const mountResults = new Map<string, string>();

  // 3) Listen for your mount scripts’ JSON replies
  smbMountListener = (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action !== 'mountSmbResult') return;

      // Extract the JSON payload
      const info = typeof msg.result === 'string'
        ? JSON.parse(msg.result)
        : msg.result;

      // What the script actually returned as mount point:
      const mountPoint = info.MountPoint
        ?? (info.DriveLetter ? `${info.DriveLetter}:\\` : null);

      // Figure out *which* key to assign this to…
      let key: string | undefined;

      if (thisOs!.value === 'win' && info.smb_share) {
        // Windows .bat echoes {"DriveLetter":..., "smb_share": "..."}
        key = info.smb_share;
      }
      else if (info.smb_server) {
        // Linux & mac both echo smb_server + either "share" or "smb_share"
        const serverHost = info.smb_server
          .replace(/^smb:\/\//, '')
          .split('/')[0];
        const shareName = info.smb_share
          ?? info.share
          ?? mountPoint.split(/[\\/]/).filter(Boolean).pop();
        key = `${serverHost}:${shareName}`;
      }

      if (key && mountPoint) {
        mountResults.set(key, mountPoint);
      } else {
        console.warn("Could not derive key or mountPoint from:", info);
      }

      // Mark that key as done
      if (key) remainingKeys.delete(key);

      // Once they’re all mounted, open the folders
      if (remainingKeys.size === 0) {
        finishOpening();
      }
    } catch (e) {
      console.error("Failed to parse mountSmbResult:", e);
      openingBackup.value = false;
    }
  };

  IPCRouter.getInstance().addEventListener("action", smbMountListener);

  // 4) Fire off mount requests
  for (const entry of new Set(backupTasks.value.map(t =>
    thisOs!.value === 'win' ? t.share : `${t.host}:${t.share}`
  ))) {
    const [host, share] = entry!.includes(":") ? entry!.split(":") : [undefined, entry];
    IPCRouter.getInstance().send("backend", "mountSambaClient", {
      smb_host: host!,
      smb_share: share!,
      smb_user: username.value,
      smb_pass: password.value
    });
  }

  // 5) Only called once all mounts are done
  function finishOpening() {
    openingBackup.value = false;
    IPCRouter.getInstance().removeEventListener("action", smbMountListener!);
    smbMountListener = null;

    for (const task of backupTasks.value) {
      const normalized = task.target.startsWith('/')
        ? task.target
        : `/${task.target}`;

      let finalPath: string;

      if (thisOs!.value === 'win') {
        // Windows: drive letter path + back‑slashes
        const mp = mountResults.get(task.share!)!;
        finalPath = `${mp}${normalized.replace(/\//g, "\\")}`;

      } else if (thisOs!.value === 'mac') {
        // macOS: real /Volumes/<share> + the target
        const mp = mountResults.get(`${task.host}:${task.share}`)!;
        finalPath = `${mp}${normalized}`;

      } else {
        // Linux: keep your working code intact
        finalPath = `/mnt/houston-mounts/${task.share}${normalized}`;
      }

      console.log("📂 Opening folder:", finalPath);
      IPCRouter.getInstance().send("backend", "action", JSON.stringify({
        type: "openFolder",
        path: finalPath
      }));
    }
  }
};


const proceedToPreviousStep = async () => {
  prevStep();
};

useEnterToAdvance(
  () => {
    if (!isButtonDisabled.value) {
      handleOpen(); // Enter triggers "Open"
    }
  },
  200,        // debounce
  () => { },   // Disable ArrowRight
  () => {
    proceedToPreviousStep(); // ← triggers Back
  }
);
</script>

<style scoped>

</style>
