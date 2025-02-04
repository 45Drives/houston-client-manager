<template>
  <div class="flex flex-row h-full bg-default text-default">

    <!-- List of servers to click -->
    <div class="flex flex-col h-full">
      <div class="font-bold text-center border-b-2">
        Houston Servers
      </div>

      <div class="flex p-2 space-x-1">

        <span>Dark</span>
        <Switch v-model="darkModeState"
          :class="[darkModeState ? 'bg-45d' : 'bg-well', 'inline-flex shrink-0 h-6 w-11 p-[2px] rounded-full cursor-pointer shadow-inner transition-colors ease-in-out duration-200']">
          <span aria-hidden="true"
            :class="[darkModeState ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 rounded-full bg-default shadow-md transform transition-transform ease-in-out duration-200']" />
        </Switch>

        <span>Advanced</span>
        <Switch v-model="advancedState"
          :class="[advancedState ? 'bg-45d' : 'bg-well', 'inline-flex shrink-0 h-6 w-11 p-[2px] rounded-full cursor-pointer shadow-inner transition-colors ease-in-out duration-200']">
          <span aria-hidden="true"
            :class="[advancedState ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 rounded-full bg-default shadow-md transform transition-transform ease-in-out duration-200']" />
        </Switch>

      </div>

      <div v-if="servers.length == 0" class="spinner"></div>

      <div class="flex flex-col space-y-1 p-2">
        <button class="btn btn-primary" v-for="server in servers" :key="server.ip" @click="openServerWebsite(server)">
          {{ server.name }} - {{ server.ip }}
        </button>
      </div>
    </div>

    <div v-if="!loadingWebview" class="spinner"></div>

    <webview id="myWebview" :class="['h-[100vh] w-full']" title="test" :src="currentUrl" allowpopups nodeintegration
      allow-same-origin allow-scripts partition="persist:authSession"
      webpreferences="javascript=yes,webSecurity=no,enable-cookies=true,nodeIntegration=false,contextIsolation=true"
      ref="webview" 
      @did-finish-load="onWebViewLoaded" />

      <NotificationView />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDarkModeState } from './composables/useDarkModeState';
import { useAdvancedModeState } from './composables/useAdvancedState';
import { Switch } from '@headlessui/vue';
import { reportError, reportSuccess } from './components/NotificationView.vue';
import NotificationView from './components/NotificationView.vue';

const darkModeState = useDarkModeState();
const advancedState = useAdvancedModeState();

interface Server {
  ip: string;
  name: string;
}

const servers = ref<Server[]>([]);
const clientip = ref<string>("");
const webview = ref();
const loadingWebview = ref(false);
const currentServer = ref<Server | null>(null);
const currentUrl = ref<string>('https://45drives.com');

// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  servers.value = discoveredServers;
});
window.electron.ipcRenderer.on('client-ip', (_event, ip: string) => {
  clientip.value = ip;
});
window.electron.ipcRenderer.on('notification', (_event, message: string) => {
  if (message.startsWith("Error")) {

    reportError(new Error(message))
  } else {

    reportSuccess(message);
  }

});
// Handle server click to open the website
const openServerWebsite = (server: Server | null) => {
  loadingWebview.value = false;
  webview.value.style.visibility = "hidden";

  currentServer.value = server;
  if (server) {

    currentUrl.value = `https://${server.ip}:9090/super-simple-setup-test#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;
    
  } else {
    currentUrl.value = "";
  }
};

watch(servers, () => {
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
    });
  });
  watch(advancedState, () => {
    openServerWebsite(currentServer.value)
  })
  watch(darkModeState, () => {
    openServerWebsite(currentServer.value)
  })
})

const onWebViewLoaded = () => {
  webview.value.executeJavaScript(`
        if (!document.querySelector("#login")) {
          [...document.querySelectorAll('#main > div')].forEach((e) => {
            if (e.id !== 'content') e.style.display = 'none';
          });

          [...document.querySelectorAll('#main > nav')].forEach((e) => {
            if (e.id !== 'content') e.style.display = 'none';
          });

          document.querySelector('#main').style.gridTemplateAreas = '"header" "main"';
          document.querySelector('#main').style.gridTemplateColumns = '1fr';
          document.body.style.visibility = 'visible';  // Show the page after modifications
        }
      `);
  webview.value.style.visibility = "visible";
  loadingWebview.value = true;
  webview.value.openDevTools();
}
</script>

<style scoped>
.selected {
  @apply bg-blue-500 text-white border-blue-600;
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
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
