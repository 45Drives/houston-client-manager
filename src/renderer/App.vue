<template>
  <!-- Container for the whole app -->
  <div class="app-container">

    <!-- List of servers to click -->
    <div>
      <Text>Houston Servers</Text>

      <div v-if="servers.length == 0" class="spinner"></div>

      <ul>
        <li v-for="server in servers" :key="server.ip" @click="openServerWebsite(server)">
          {{ server.name }} - {{ server.ip }}
        </li>
      </ul>
    </div>

    <div class="webview-container">

      <webview v-if="currentUrl" :src="currentUrl" style="width: 100%; height: 100%;" ref="webview" />

    </div>

  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Server {
  ip: string;
  name: string;
}

const servers = ref<Server[]>([]);
const currentServer = ref<Server | null>(null);
const currentUrl = ref<string>('');

// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  servers.value = discoveredServers;
});

// Handle server click to open the website
const openServerWebsite = (server: Server) => {
  currentServer.value = server;
  currentUrl.value = `https://${server.ip}:9090/cockpit/@localhost/file-sharing/index.html `;

};

</script>

<style scoped>
/* Ensure the app takes full height and width */
html,
body {
  height: 100%;
  margin: 0;
}

.app-container {
  display: flex;
  flex-direction: row;
  height: 100%;
  width: 100%;
  padding: 10px;
}

.buttons-container {
  margin-bottom: 10px;
}

button {
  margin: 5px;
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}

ul {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

ul li {
  cursor: pointer;
  padding: 5px;
}


ul {
  list-style: none;
  padding: 0;
}

li {
  cursor: pointer;
  padding: 8px;
  border: 1px solid #ddd;
  margin: 5px;
  width: 250px;
  text-align: center;
  background: #f9f9f9;
}

li:hover {
  background: #e0e0e0;
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
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.webview-container {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  /* Takes the remaining space */
  border: 1px solid #ccc;
}

webview {
  width: 100%;
  height: 100%;
}
</style>
