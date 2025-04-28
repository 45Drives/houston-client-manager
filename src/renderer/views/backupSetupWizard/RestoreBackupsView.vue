<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="relative flex items-center justify-center h-24">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Restore Backups
        </p>
      </div>
    </template>

    <div class="flex justify-between">
      <div class="w-1/2 pr-2">
        <div class="mb-2">
          <input v-model="search" type="text" placeholder="Type To Search For backup?"
            class="w-full p-2 border rounded" />
        </div>
        <table class="w-full border text-left">
          <thead>
            <tr class="bg-gray-300">
              <th class="p-2">Folder</th>
              <th class="p-2">Client</th>
              <th class="p-2">Server</th>
              <th class="p-2">Last Backup</th>
              <th class="p-2">On System</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="backup in filteredBackups" :key="backup.uuid"
              :class="{ 'bg-yellow-100': selectedBackup?.uuid === backup.uuid }" @click="selectBackup(backup)"
              class="cursor-pointer hover:bg-gray-100">
              <td class="p-2">{{ backup.folder }}</td>
              <td class="p-2">{{ backup.client }}</td>
              <td class="p-2">{{ backup.server }}</td>
              <td class="p-2">{{ backup.lastBackup }}</td>
              <td class="p-2">{{ backup.onSystem }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="w-1/2 pl-2">
        <div class="text-center mb-2">
          <input class="bg-blue-300 hover:bg-blue-300 text-white w-full p-2 border rounded" disabled
            placeholder="Select a backup to see files">
          </input>
        </div>
        <div v-if="selectedBackup">

          <table class="w-full border text-left">
            <thead>
              <tr class="bg-gray-300">
                <th class="p-2">File</th>
                <th class="p-2">Select</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(file, index) in selectedBackup.files" :key="index">
                <td class="p-2">{{ file.path }}</td>
                <td class="p-2">
                  <input type="checkbox" v-model="file.selected" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row justify-between">
        <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">
          Back
        </button>
        <div v-if="selectedBackup" class="flex justify-center gap-4 mt-2">
          <button class="bg-blue-500 text-white px-4 py-2 rounded" @click="deselectAll">Deselect All</button>
          <button class="bg-blue-500 text-white px-4 py-2 rounded" @click="selectAll">Select All</button>
          <button class="bg-blue-500 text-white px-4 py-2 rounded" @click="restoreSelected">Restore Selected
            Files</button>
        </div>
      </div>
    </template>
  </CardContainer>
</template>

<script lang="ts" setup>
import { ref, computed, inject, onMounted, watch } from 'vue'
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { CardContainer } from "@45drives/houston-common-ui";
import { IPCRouter, type BackupEntry, type FileEntry } from '@45drives/houston-common-lib';
import { Server } from '../../types';

const division = inject(divisionCodeInjectionKey);

const { prevStep } = useWizardSteps("backup");

const proceedToPreviousStep = () => {
  prevStep();
};

const serverList = ref<Server[]>([]);
// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', async (_event, discoveredServers: Server[]) => {
  const isDev = await window.electron.ipcRenderer.invoke("is-dev")

  const servers = discoveredServers;
  if (!isDev) {

    serverList.value = discoveredServers.filter(server => server.status !== "complete");
  } 

  if (serverList.value.length !== servers.length) {
    serverList.value = servers;
  }

});

const search = ref('')

const backups = ref<BackupEntry[]>([])

const selectedBackup = ref<BackupEntry | null>(null)

const filteredBackups = computed(() => {
  return backups.value.filter(backup =>
    backup.folder.toLowerCase().includes(search.value.toLowerCase())
  )
})

async function fetchBackupsFromServer(server: Server): Promise<BackupEntry[]> {
  // This function should make a real call in production
  try {
    const response = await fetch(`http://${server.ip}:9095/backups`)
    const data = await response.json()
    const result = data as BackupEntry[];

    return result;
  } catch (e) {

    return [];
  }
}

watch(serverList, async () => {
  const allBackups = await Promise.all(serverList.value.map(fetchBackupsFromServer))
  console.log('Fetched all backups:', allBackups)
  backups.value = allBackups.flat()
})

async function selectBackup(backup: BackupEntry) {
  selectedBackup.value = { ...backup, files: [] }
  const files = await fetchBackupFiles(backup)
  selectedBackup.value.files = files
}

async function fetchBackupFiles(backup: BackupEntry): Promise<FileEntry[]> {
  const response = await fetch(`http://${backup.server}:9095/backups/files?uuid=${backup.uuid}`)
  const files = await response.json()
  return files.map((file: string) => ({path: file.replace(backup.client, ""), selected: false})) as FileEntry[]
}

function selectAll() {
  selectedBackup.value?.files.forEach(file => file.selected = true)
}

function deselectAll() {
  selectedBackup.value?.files.forEach(file => file.selected = false)
}

function restoreSelected() {
  if (!selectedBackup.value) return
  if (!selectedBackup.value) return
  const filesToRestore = selectedBackup.value.files.filter(file => file.selected)

  const restorePayload = {
    target: selectedBackup.value.server,
    folder: selectedBackup.value.folder,
    files: filesToRestore.map(file => file.path)
  }

  IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    type: "restore-backup",
    restorePayload
  }))
}
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
