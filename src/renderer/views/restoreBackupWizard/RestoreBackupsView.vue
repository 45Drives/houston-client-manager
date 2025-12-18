<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <template #header class="!text-center">
      <div class="relative flex items-center justify-center h-18 w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
         <DynamicBrandingLogo :division="division" :height="(division === 'studio' ? 16 : 12)"/>

        </div>
        <p class="text-3xl font-semibold text-center">
          Restore Backups
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
      <div v-if="loading">Loading... Please Wait</div>
    </template>

    <div class="w-full">
      <p class="text-1xl font-semibold text-center">
        If you were expected to see backups and see none go back and make sure you enter the correct server, username
        and
        password.
        <br>
        Search and select a backup on the left then you should see the files in that backup.
        <br>
        Select the files you want to restore and once you are ready click "Restore Selected Files" button.
      </p>

      <div class="flex justify-between mt-1">
        <div class="w-1/2 pr-2">
          <div class="mb-2">
            <input v-model="search" type="text" placeholder="Type To Search For backup"
              class="w-full p-2 border rounded input-textlike bg-default text-default" :disabled="isRestoring" />

          </div>
          <table v-if="!loading" class="max-h-96 overflow-y-auto w-full border text-left">
            <thead>
              <tr class="bg-primary">
                <th class="p-2">Folder</th>
                <th class="p-2">Client</th>
                <th class="p-2">Server</th>
                <th class="p-2">Last Backup</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="backup in filteredBackups" :key="backup.uuid" :class="[
                isRestoring ? 'cursor-default' : 'cursor-pointer',
                selectedBackup?.uuid === backup.uuid
                  ? (isRestoring ? 'bg-yellow-100 text-black' : 'bg-yellow-100 hover:bg-yellow-200 text-black')
                  : 'bg-default text-default'
              ]" @click="!isRestoring && selectBackup(backup)">

                <td class="p-2">{{ backup.folder }}</td>
                <td class="p-2">{{ backup.client }}</td>
                <td class="p-2">{{ backup.server }}</td>
                <td class="p-2">{{ backup.lastBackup }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else>
            <div class="w-full h-[300px] flex justify-center items-center">
              <div class="spinner"></div>
            </div>
          </div>
        </div>

        <div class="w-1/2 pl-2">
          <div class="text-center mb-2">
            <input class="bg-well w-full p-2 rounded text-default" disabled
              placeholder="Select a backup to see files">
            </input>
          </div>
          <div v-if="selectedBackup" class="flex items-center justify-end gap-2 mb-2">
            <label class="flex items-center gap-2 select-none">
              <input type="checkbox" v-model="showHiddenFiles" :disabled="isRestoring" />
              <span>Show hidden files</span>
            </label>
          </div>

          <div class="max-h-96 overflow-y-auto text-default" v-if="selectedBackup">

            <table v-if="!loading" class="w-full border text-left">
              <thead>
                <tr class="bg-secondary">
                  <th class="p-2">File</th>
                  <th class="p-2 text-center" :class="isRestoring || !selectedBackup || !selectedBackup.files.length
                    ? 'cursor-default opacity-60'
                    : 'cursor-pointer'" @click="!isRestoring && toggleHeaderSelect()">
                    <div class="flex items-center justify-center gap-1">
                      <input type="checkbox" :checked="allFilesSelected"
                        :disabled="isRestoring || !selectedBackup || !selectedBackup.files.length" />
                      <span>Select</span>
                    </div>
                  </th>


                </tr>
              </thead>

              <tbody>
                <tr v-for="(file, index) in selectedBackup.files" :key="index" :class="[
                  isRestoring ? 'cursor-default' : 'cursor-pointer',
                  file?.selected
                    ? (isRestoring ? 'bg-yellow-100 text-black' : 'bg-yellow-100 hover:bg-yellow-200 text-black')
                    : 'bg-default text-default'
                ]" @click="!isRestoring && toggleFileSelection(file)">
                  <td class="p-2 truncate max-w-[30ch]" :title="file.path">{{ file.path }}</td>
                  <td class="p-2 items-center" @click.stop>
                    <input type="checkbox" v-model="file.selected" :disabled="isRestoring" />
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else>
              <div class="w-full h-[300px] flex justify-center items-center">
                <div class="spinner"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isRestoring" class="my-4 text-center">
        <p>
          Restoring file {{ restoreProgress.current }} of {{ restoreProgress.total }}...
        </p>
        <p><strong>{{ restoreProgress.lastFile }}</strong></p>
        <progress :value="restoreProgress.bytesCurrent" :max="restoreProgress.bytesTotal || 1"
          class="w-full rounded-md"></progress>
      </div>


      <div v-if="showOpenFolderPrompt" class="text-center my-4 p-4 border rounded bg-yellow-100 text-black z-11">
        <p>Restore complete. Would you like to open the folder{{ restoredFolders.length > 1 ? 's' : '' }}?</p>
        <div class="flex justify-center gap-2 mt-2">
          <button class="btn btn-primary" @click="openRestoredFolders">Open {{ restoredFolders.length > 1 ? 'All' :
            'Folder' }}</button>
          <button class="btn btn-secondary" @click="showOpenFolderPrompt = false">Dismiss</button>
        </div>
      </div>
    </div>
    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row justify-between">
        <button @click="proceedToPreviousStep" class="btn btn-secondary h-20 w-40" :disabled="isRestoring">
          Back
        </button>

        <div v-if="selectedBackup" class="button-group-row justify-center gap-4 mt-2">
          <button class="btn btn-secondary px-4 py-2" @click="deselectAll" :disabled="isRestoring">
            Deselect All
          </button>
          <button class="btn btn-secondary px-4 py-2" @click="selectAll" :disabled="isRestoring">
            Select All
          </button>
          <button @click="restoreSelected" class="btn btn-primary px-4 py-2" :disabled="isRestoring">
            Restore Selected Files
          </button>
        </div>

      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import { ref, computed, inject, onActivated, onDeactivated, watch } from 'vue'
import { useWizardSteps, DynamicBrandingLogo, confirm, CardContainer, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey, restoreBackUpSetupDataKey } from '../../keys/injection-keys';
import { IPCRouter, type BackupEntry, type FileEntry } from '@45drives/houston-common-lib';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';

const division = inject(divisionCodeInjectionKey);
const restoreBackupsData = inject(restoreBackUpSetupDataKey)!;
const loading = ref<boolean>(true);

const restoreProgress = ref<{
  current: number;        // file index (1-based)
  total: number;          // total files
  lastFile: string;
  bytesCurrent: number;   // bytes copied for current file
  bytesTotal: number;     // total bytes of current file
}>({
  current: 0,
  total: 0,
  lastFile: "",
  bytesCurrent: 0,
  bytesTotal: 0,
});

const { prevStep } = useWizardSteps("restore-backup");
const proceedToPreviousStep = () => {
  prevStep();
};
const isRestoring = ref(false);

const search = ref('');
const backups = ref<BackupEntry[]>([]);
const selectedBackup = ref<BackupEntry | null>(null);
const allFilesSelected = computed(() => {
  if (!selectedBackup.value || selectedBackup.value.files.length === 0) {
    return false;
  }
  return selectedBackup.value.files.every(f => f.selected);
});
const showHiddenFiles = ref(false);

function toggleHeaderSelect() {
  if (!selectedBackup.value) return;

  const newValue = !allFilesSelected.value;
  selectedBackup.value.files.forEach(file => {
    file.selected = newValue;
  });
}

const filteredBackups = computed(() => {
  return backups.value.filter(backup =>
    backup.folder.toLowerCase().includes(search.value.toLowerCase())
  );
});

function toggleFileSelection(file: FileEntry) {
  file.selected = !file.selected;
}

const router = IPCRouter.getInstance();
let actionHandler: ((data: string) => void) | null = null;

onActivated(() => {
  loading.value = true;
  // console.debug("activated!")

  // define the handler once per activation and keep a reference
  actionHandler = (data: string) => {
    try {
      const response = JSON.parse(data);

      if (response.type === "fetchFilesFromBackupResult" && selectedBackup.value) {
        const files = response.result.map((file: string) => ({
          path: file.replace(/^\/+/, ""),
          selected: false,
        })) as FileEntry[];

        selectedBackup.value.files = files;
        console.debug("selectedBackupFiles:", selectedBackup.value.files);

      } else if (response.type === "fetchBackupsFromServerResult") {
        backups.value = response.result as BackupEntry[];
        console.debug("backupsFound:", backups.value);

      } else if (response.type === "restoreBackupsProgress") {
        const p = response.progress;
        restoreProgress.value.current = p.fileIndex;
        restoreProgress.value.total = p.totalFiles;
        restoreProgress.value.lastFile = p.file;
        restoreProgress.value.bytesCurrent = p.copiedBytes;
        restoreProgress.value.bytesTotal = p.totalBytes;

      } else if (response.type === "restoreBackupsResult") {
        // keep this for final per-file completion if you want extra logs
        if (response.result.error) {
          console.error(`Error restoring ${response.result.file}: ${response.result.error}`);
        }

      } else if (response.type === "restoreCompleted") {
        restoredFolders.value = response.allFolders ?? [response.folder];
        showOpenFolderPrompt.value = true;
        isRestoring.value = false;   
      }
    } catch (e) {
      // ignore malformed / unrelated messages
    }

    loading.value = false;
  };


  // register handler once per activation
  router.addEventListener("action", actionHandler);

  // kick off initial fetches
  router.send(
    "backend",
    "action",
    JSON.stringify({
      type: "fetchBackupsFromServer",
      data: {
        smb_host: (restoreBackupsData.server?.serverName ?? "") + ".local",
        smb_share: restoreBackupsData.server?.shareName ?? "",
        smb_user: restoreBackupsData.username,
        smb_pass: restoreBackupsData.password
      }
    })
  );

  router.send(
    "backend",
    "action",
    JSON.stringify({ type: "fetchBackupEvents" })
  );
});

onDeactivated(() => {
  // unregister the listener so we don’t accumulate duplicates
  if (actionHandler && (router as any).removeEventListener) {
    (router as any).removeEventListener("action", actionHandler);
    actionHandler = null;
  }

  // Reset all relevant state when leaving the page
  backups.value = [];
  selectedBackup.value = null;
  restoreProgress.value = {
    current: 0,
    total: 0,
    lastFile: "",
    bytesCurrent: 0,
    bytesTotal: 0,
  };

  restoredFolders.value = [];
  showOpenFolderPrompt.value = false;
  isRestoring.value = false;
});

async function selectBackup(backup: BackupEntry) {
  selectedBackup.value = { ...backup, files: [] }
  await fetchBackupFiles(backup)
}

async function fetchBackupFiles(backup: BackupEntry) {
  IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    type: "fetchFilesFromBackup",
    data: {
      smb_host: (restoreBackupsData.server?.serverName ?? "") + ".local",
      smb_share: restoreBackupsData.server?.shareName ?? "",
      smb_user: restoreBackupsData.username,
      smb_pass: restoreBackupsData.password,
      uuid: backup.uuid,
      includeHidden: showHiddenFiles.value,
    }
  }));
}

watch(showHiddenFiles, async () => {
  if (selectedBackup.value) {
    loading.value = true;
    await fetchBackupFiles(selectedBackup.value);
  }
});

function selectAll() {
  selectedBackup.value?.files.forEach(file => file.selected = true)
}

function deselectAll() {
  selectedBackup.value?.files.forEach(file => file.selected = false)
}

const isConfirmOpen = ref(false);

const showOpenFolderPrompt = ref(false);
const restoredFolders = ref<string[]>([]);

const restoreSelected = async () => {
  // const confirmed = window.confirm('Restoring these files will overwrite existing files if they exist.');
  if (!selectedBackup.value) return;

  isConfirmOpen.value = true;

  const confirmed = await 
    confirm({
      header: "Proceed with Restoring Selected Files",
      body:
        "Restoring these files will overwrite existing files if they exist.",
      dangerous: true,
      confirmButtonText: "Restore Now",
    }).unwrapOr(false)
  
  isConfirmOpen.value = false;

  if (!confirmed) return;

  const filesToRestore = selectedBackup.value.files.filter(file => file.selected)
  console.debug("[restoreBackups] Files to restore:", filesToRestore);

  restoreProgress.value = {
    current: 0,
    total: filesToRestore.length,
    lastFile: "",
    bytesCurrent: 0,
    bytesTotal: 0,
  };

  isRestoring.value = true; 

  const restorePayload = {
    smb_host: (restoreBackupsData.server?.serverName ?? "") + ".local",
    smb_share: restoreBackupsData.server?.shareName ?? "",
    smb_user: restoreBackupsData.username,
    smb_pass: restoreBackupsData.password,
    uuid: selectedBackup.value.uuid,
    client: selectedBackup.value.client,
    files: filesToRestore.map(file => file.path)
  }

  IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    type: "restoreBackups",
    data: restorePayload
  }))
}

const openRestoredFolders = () => {
  for (const folder of restoredFolders.value) {
    // const normalizedPath = folder.startsWith("/") || /^[A-Za-z]:/.test(folder)
    //   ? folder
    //   : `/${folder}`;
    const fixedFolder = folder.replace(/\\/g, "/");
    const normalizedPath = fixedFolder.match(/^([A-Za-z]:\/|\/)/) ? fixedFolder : `/${fixedFolder}`;

    IPCRouter.getInstance().send("backend", "action", JSON.stringify({
      type: "openFolder",
      path: normalizedPath
    }));
  }
  showOpenFolderPrompt.value = false;
}


useEnterToAdvance(
  () => {
    if (!isConfirmOpen.value && selectedBackup.value !== null) {
      restoreSelected();
    }
  },
  200,
  () => {
    if (!isConfirmOpen.value && selectedBackup.value !== null) {
      restoreSelected();
    }
  },
  () => {
    if (!isConfirmOpen.value) {
      proceedToPreviousStep();
    }
  }
);

</script>

<style scoped>
table {
  border-collapse: collapse;
}

th,
td {
  border: 1px solid #ccc;
}

/* Loading spinner */
.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #2c3e50;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 20px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
