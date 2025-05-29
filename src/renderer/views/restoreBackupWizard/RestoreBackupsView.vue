<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="relative flex items-center justify-center h-18 w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
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
              class="w-full p-2 border rounded bg-white text-black" />
          </div>
          <table class="max-h-96 overflow-y-auto w-full border text-left">
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
              'cursor-pointer ',
  selectedBackup?.uuid === backup.uuid ? 'bg-yellow-100 hover:bg-yellow-200 text-black' : 'bg-default text-default'
            ]" @click="selectBackup(backup)">
                <td class="p-2">{{ backup.folder }}</td>
                <td class="p-2">{{ backup.client }}</td>
                <td class="p-2">{{ backup.server }}</td>
                <td class="p-2">{{ backup.lastBackup }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="w-1/2 pl-2">
          <div class="text-center mb-2">
            <input class="bg-well w-full p-2 border rounded text-default" disabled
              placeholder="Select a backup to see files">
            </input>
          </div>
          <div class="max-h-96 overflow-y-auto text-default" v-if="selectedBackup">

            <table class="w-full border text-left">
              <thead>
                <tr class="bg-secondary">
                  <th class="p-2">File</th>
                  <th class="p-2">Select</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(file, index) in selectedBackup.files" :key="index" class="cursor-pointer" :class="[
                'cursor-pointer ',
  file?.selected ? 'bg-yellow-100 hover:bg-yellow-200 text-black' : 'bg-default text-default'
              ]" @click="toggleFileSelection(file)">
                  <td class="p-2 truncate max-w-[30ch]" :title="file.path">{{ file.path }}</td>
                  <td class="p-2" @click.stop>
                    <input type="checkbox" v-model="file.selected" />
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-if="restoreProgress.total > 0 && restoreProgress.current < restoreProgress.total" class="my-4 text-center">
        <p>Restoring file {{ restoreProgress.current }} of {{ restoreProgress.total }}...</p>
        <p><strong>{{ restoreProgress.lastFile }}</strong></p>
        <progress :value="restoreProgress.current" :max="restoreProgress.total" class="w-full"></progress>
      </div>
      <div v-if="restoreProgress.total > 0 && restoreProgress.current == restoreProgress.total">
        <p>Restored {{ restoreProgress.current }} of {{ restoreProgress.total }} file(s).</p>
        <p><strong>{{ restoreProgress.lastFile }}</strong></p>
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
        <button @click="proceedToPreviousStep" class="btn btn-secondary h-20 w-40">
          Back
        </button>
        <div v-if="selectedBackup" class="flex justify-center gap-4 mt-2">
          <button class="btn btn-secondary px-4 py-2 rounded" @click="deselectAll">Deselect All</button>
          <button class="btn btn-secondary px-4 py-2 rounded" @click="selectAll">Select All</button>
          <button @click="restoreSelected" class="btn btn-primary px-4 py-2 rounded">Restore Selected
            Files</button>
        </div>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import { ref, computed, inject, onActivated } from 'vue'
import { useWizardSteps, DynamicBrandingLogo, confirm, CardContainer, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey, restoreBackUpSetupDataKey } from '../../keys/injection-keys';
import { IPCRouter, type BackupEntry, type FileEntry } from '@45drives/houston-common-lib';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';

const division = inject(divisionCodeInjectionKey);
const restoreBackupsData = inject(restoreBackUpSetupDataKey)!;
const loading = ref<boolean>(true);
const restoreProgress = ref<{ current: number; total: number; lastFile: string }>({
  current: 0,
  total: 0,
  lastFile: ""
});

const { prevStep } = useWizardSteps("restore-backup");

const proceedToPreviousStep = () => {
  prevStep();
};

const search = ref('')

const backups = ref<BackupEntry[]>([])

const selectedBackup = ref<BackupEntry | null>(null)

const filteredBackups = computed(() => {
  return backups.value.filter(backup =>
    backup.folder.toLowerCase().includes(search.value.toLowerCase())
  )
})

function toggleFileSelection(file: FileEntry) {
  file.selected = !file.selected;
}

onActivated(() => {

  loading.value = true;
  console.log("activated!")

  IPCRouter.getInstance().addEventListener("action", data => {
    try {
      const response = JSON.parse(data);
      if (response.type === "fetchFilesFromBackupResult" && selectedBackup.value) {
        const files = response.result.map((file: string) => ({ path: file.replace(selectedBackup.value!.client, ""), selected: false })) as FileEntry[]
        selectedBackup.value.files = files;
      } else if (response.type === "fetchBackupsFromServerResult") {
        backups.value = response.result as BackupEntry[];
      } else if (response.type === "restoreBackupsResult") {
        console.log("restore happened")
        restoreProgress.value.current++;
        restoreProgress.value.lastFile = response.value.file;
        // Optional: track errors
        if (response.value.error) {
          console.error(`Error restoring ${response.value.file}: ${response.value.error}`);
        }
      } else if (response.type === "restoreCompleted") {
        restoredFolders.value = response.allFolders ?? [response.folder];
        showOpenFolderPrompt.value = true;
      }

    } catch (e) { }

    loading.value = false;
  });


  IPCRouter.getInstance().send("backend", 'action', JSON.stringify(
    {
      type: "fetchBackupsFromServer",
      data: {
        smb_host: (restoreBackupsData.server?.serverName ?? "") + ".local",
        smb_share: restoreBackupsData.server?.shareName ?? "",
        smb_user: restoreBackupsData.username,
        smb_pass: restoreBackupsData.password,
      }
    }))

});

async function selectBackup(backup: BackupEntry) {
  selectedBackup.value = { ...backup, files: [] }
  await fetchBackupFiles(backup)
}

async function fetchBackupFiles(backup: BackupEntry) {
  console.log("fetchFilesFromBackup")
  IPCRouter.getInstance().send("backend", 'action', JSON.stringify(
    {
      type: "fetchFilesFromBackup",
      data: {
        smb_host: (restoreBackupsData.server?.serverName ?? "") + ".local",
        smb_share: restoreBackupsData.server?.shareName ?? "",
        smb_user: restoreBackupsData.username,
        smb_pass: restoreBackupsData.password,
        uuid: backup.uuid
      }
    }))
}

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

  restoreProgress.value = {
    current: 0,
    total: filesToRestore.length,
    lastFile: ""
  };

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
    IPCRouter.getInstance().send("backend", "action", JSON.stringify({
      type: "openFolder",
      path: folder
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
</style>
