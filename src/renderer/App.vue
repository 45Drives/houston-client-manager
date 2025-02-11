<template>

  <div class="w-screen h-screen overflow-hidden flex items-center justify-center text-default" >

    <Wizard v-if="!welcomeWizardComplete" :steps="steps" :onComplete="onWelcomeWizardComplete" class="h-full flex-1" />
  
    <div v-else-if="welcomeWizardComplete">
      Welcome Wizard Complate!!!
    </div>

    <NotificationView /> 

  </div>
    <!-- <div v-if="!loadingWebview" class="spinner"></div>

    <webview id="myWebview" :class="['h-[100vh] w-full']" title="test" :src="currentUrl" allowpopups nodeintegration
      allow-same-origin allow-scripts partition="persist:authSession"
      webpreferences="javascript=yes,webSecurity=no,enable-cookies=true,nodeIntegration=false,contextIsolation=true"
      ref="webview" @did-finish-load="onWebViewLoaded" />
-->

</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDarkModeState } from './composables/useDarkModeState';
import { useAdvancedModeState } from './composables/useAdvancedState';
import { reportError, reportSuccess } from './components/NotificationView.vue';
import NotificationView from './components/NotificationView.vue';
import { Server } from './types';
import { Wizard } from './components/wizard';
import WelcomeView from './views/WelcomeView.vue';

const steps = [
  { label: "Welcome", component: WelcomeView },
];

const darkModeState = useDarkModeState();
const advancedState = useAdvancedModeState();
const welcomeWizardComplete = ref(false);

const currentServer = ref<Server | null>(null);
const clientip = ref<string>("");
const webview = ref();
const loadingWebview = ref(false);
const currentUrl = ref<string>('https://45drives.com');


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

  currentServer.value = server;
  let newUrl = "";
  if (server) {

    newUrl = `https://${server.ip}:9090/super-simple-setup-test#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;

  } else {
    currentUrl.value = "";
  }

  if (newUrl !== currentUrl.value) {
    loadingWebview.value = false;
    webview.value.style.visibility = "hidden";
    currentUrl.value = newUrl;
  }

};

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

const onWelcomeWizardComplete = () => {
  welcomeWizardComplete.value = true;
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
