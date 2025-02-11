<template>
  <!-- List of servers to click -->
  <div class="flex flex-col h-full flex-2">
    <div class="font-bold text-center border-b-2">
      Houston Servers
    </div>

    <div v-if="servers.length == 0" class="spinner"></div>

    <div class="flex flex-col space-y-1 p-2">
      <button class="btn btn-primary" v-for="server in servers" :key="server.ip" @click="handleSelection(server)">
        {{ server.name }} - {{ server.ip }}
      </button>
    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Server } from '../types'

const servers = ref<Server[]>([]);

// Receive the discovered servers from the main process
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

const props = defineProps<{
  onSelectedServerChange: (server: Server) => void;
}>();

const handleSelection = (server: Server) => {
  props.onSelectedServerChange(server);
};

</script>

<style scoped></style>
