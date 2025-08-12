<template>
    <div class="w-full h-full relative flex flex-col items-center justify-center">
        <webview v-if="currentServer?.ip"
            v-show="!loadingWebview" id="houstonWebview" :src="currentUrl" partition="persist:authSession"
            webpreferences="contextIsolation=true, nodeIntegration=false, enableRemoteModule=false" ref="webview"
            allowpopups @did-finish-load="onWebViewLoaded" class="h-[100vh] w-full" />

            <div v-if="loadingWebview"
                class="absolute inset-0 z-40 bg-default flex flex-col items-center justify-center w-full text-center">
                <p class="text-2xl text-center">Give us a few while we login...</p>
                <div class="spinner" />
            </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, inject, computed, nextTick, watch } from 'vue'
import { useDarkModeState } from '@45drives/houston-common-ui'
import { useAdvancedModeState } from '../composables/useAdvancedState'
import { IPCMessageRouterRenderer, IPCRouter } from '@45drives/houston-common-lib'
import { currentServerInjectionKey } from '../keys/injection-keys'
import { useHoustonWebview } from '../composables/useHoustonWebview'


// ---- inputs/state we need ----
const dark = useDarkModeState()
const adv = useAdvancedModeState()
const currentServer = inject(currentServerInjectionKey, ref(null))

// creds from main (manual user/pass)
const manualCreds = ref<{ ip: string; username: string; password: string } | null>(null)

// webview + url + loading
const webview = ref<any>(null)
const loadingWebview = ref(true)
const clientIp = ref('')

// Build the cockpit URL for the selected server.
// If you want the Cockpit home: `https://<ip>:9090`
// If you want to deep-link to your module: append `/super-simple-setup#dark=...&advanced=...`
const currentUrl = computed(() => {
    const ip = currentServer.value?.ip
    if (!ip) return 'about:blank'
    // Cockpit home:
    // return `https://${ip}:9090`

    // Or your module:
    return `https://${ip}:9090/super-simple-setup#dark=${dark.value}&advanced=${adv.value}&client_ip=${clientIp.value}&server_ip=${ip}`
})

// ---- wire renderer ready + ipc ----
onMounted(async () => {
    window.electron?.ipcRenderer.on('store-manual-creds', (_e, data) => { manualCreds.value = data })
    window.electron?.ipcRenderer.on('client-ip', (_e, ip: string) => { clientIp.value = ip })
    window.electron?.ipcRenderer.send('renderer-ready', {})
    
    console.debug('HoustonWebView currentServer:', currentServer.value)

    await nextTick()

    if (webview.value) {
        // debug: failures and lifecycle
        webview.value.addEventListener('did-fail-load', (e: any) => {
            console.error('webview did-fail-load', e.errorCode, e.errorDescription, e.validatedURL)
            loadingWebview.value = false   // don’t get stuck
        })
        webview.value.addEventListener('dom-ready', () => {
            console.debug('webview dom-ready')
        })
        webview.value.addEventListener('console-message', (e: any) => {
            console.debug('[webview]', e.message)
        })
    }

    // const stop = watch(
    //     () => webview.value,
    //     (el) => {
    //         if (!el) return
    //         const routerRenderer = IPCRouter.getInstance() as IPCMessageRouterRenderer
    //         routerRenderer.setCockpitWebView(el)   // element, not ref
    //         stop()                                 // only wire once per mount
    //     },
    //     { immediate: true }
    // )
})

onBeforeUnmount(() => {
    window.electron?.ipcRenderer.removeAllListeners?.('store-manual-creds')
    window.electron?.ipcRenderer.removeAllListeners?.('client-ip')
})

// ---- when webview loads, run the login script (or hide chrome if already logged in) ----
const { loginIntoCockpit } = useHoustonWebview()

const onWebViewLoaded = async () => {
    const view = webview.value
    if (view) {
        const routerRenderer = IPCRouter.getInstance() as IPCMessageRouterRenderer
        routerRenderer.setCockpitWebView(view)
    }

    const user = manualCreds.value?.username ?? 'root'
    const pass = manualCreds.value?.password ?? '45Dr!ves'

    try {
        await loginIntoCockpit(webview.value, { user, pass })
    } catch (e) {
        // If login fails we still reveal the webview so user can try manually
        console.error('Webview login error:', e)
    } finally {
        loadingWebview.value = false
    }

    // Optional: devtools
    const isDev = await window.electron?.ipcRenderer.invoke('is-dev')
    if (isDev) webview.value.openDevTools()
}

watch(currentUrl, (url) => {
    if (url && url !== 'about:blank') {
        loadingWebview.value = true
    } else {
        loadingWebview.value = false
    }
}, { immediate: true })
</script>

<style scoped>
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
