<template>
  <!-- List of servers to click -->
  <div class="flex flex-col">
    <div class="font-bold text-center border-b-2">
      Houston Servers
    </div>

    <div v-if="servers.length == 0" class="spinner"></div>

    <div class="flex flex-col space-y-1 p-2">
      <label
      v-for="server in servers"
      :key="server.ip"
      class="flex items-center space-x-2 p-2"
    >
      <input
        type="checkbox"
        :checked="selectedServer?.ip === server.ip"
        @change="handleSelection(server)"
        class="form-checkbox h-5 w-5 text-blue-600"
      />
      <span>{{ server.name }} - {{ server.ip }}</span>
    </label>

    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Server } from '../types'

const servers = ref<Server[]>([]);
const selectedServer = ref<Server | null>(null);

// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', async (_event, discoveredServers: Server[]) => {
  const isDev = await window.electron.ipcRenderer.invoke("is-dev")

  if (isDev) {

    servers.value = discoveredServers;
  } else {

    servers.value = discoveredServers.filter(server => server.status !== "complete");
  } 

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
