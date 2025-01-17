<template>
  <div id="app">
    <h1>Discovered Web Servers</h1>
    <ul>
      <li v-for="server in servers" :key="server.ip" @click="openServerWebsite(server)">
        {{ server.name }} - {{ server.ip }}
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from 'vue';
import { ipcRenderer } from 'electron';

interface Server {
  ip: string;
  name: string;
}

export default defineComponent({
  name: 'App',
  setup() {
    const servers = ref<Server[]>([]);

    onMounted(() => {
      // Listen for the servers from the main process
      ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
        servers.value = discoveredServers;
      });
    });

    const openServerWebsite = (server: Server) => {
      // Open the server's website (could use a WebView or open in a new window)
      const url = `http://${server.ip}`;
      window.open(url, '_blank');
    };

    return {
      servers,
      openServerWebsite,
    };
  },
});
</script>

<style scoped>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
