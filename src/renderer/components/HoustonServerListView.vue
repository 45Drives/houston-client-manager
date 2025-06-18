<template>
  <!-- List of servers to click -->
  <div class="flex flex-col items-center justify-center w-full mt-4">
    <div class="font-bold text-center text-xl mb-2 border-b-2 border-default pb-1 w-full max-w-md">
      45Drives Servers
    </div>

    <div v-if="servers.length === 0" class="spinner my-4"></div>

    <table class="table-auto border-collapse border border-default w-full max-w-md">
      <thead>
        <tr class="bg-accent">
          <th class="border border-default p-2 text-center">Select</th>
          <th class="border border-default p-2 text-center">Name</th>
          <th class="border border-default p-2 text-center">IP Address</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="server in servers" :key="server.ip" class="hover:bg-accent cursor-pointer"
          @click="handleSelection(server)">
          <td class="border border-default p-2 text-center">
            <input type="checkbox" :checked="selectedServer?.ip === server.ip" @click.stop
              @change="handleSelection(server)" class="form-checkbox h-5 w-5 text-blue-600" />
          </td>
          <td class="border border-default p-2 text-center">{{ server.name }}</td>
          <td class="border border-default p-2 text-center">{{ server.ip }}</td>
        </tr>
      </tbody>
    </table>
  </div>


</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Server } from '../types'

const props = defineProps<{ filterOutStorageSetupComplete: boolean }>();

const servers = ref<Server[]>([]);
const selectedServer = ref<Server | null>(null);

// Receive the discovered servers from the main process
// window.electron.ipcRenderer.on('discovered-servers', async (_event, discoveredServers: Server[]) => {
//   // console.log("📡 Received discovered servers:", discoveredServers);

//   const isDev = await window.electron.ipcRenderer.invoke("is-dev")

//   if (isDev || !props.filterOutStorageSetupComplete) {

//     servers.value = discoveredServers;
//   } else {

//     servers.value = discoveredServers.filter(server => server.status !== "complete");
//   }

// });

window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  servers.value = discoveredServers;
});

watch(servers, () => {
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
    });
  });
})

// Define event emitter
const emit = defineEmits<{
  (event: 'serverSelected', server: Server | null): void;
}>();

// Emit event when a server is selected
const handleSelection = (server: Server) => {
  // If the same server is clicked again, toggle selection
  if (selectedServer.value?.ip === server.ip) {
    selectedServer.value = null;
    emit('serverSelected', null);
  } else {
    selectedServer.value = server;
    emit('serverSelected', server);
  }
};

</script>

<style scoped></style>
