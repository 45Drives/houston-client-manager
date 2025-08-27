<template>
    <div class="w-full relative flex flex-col items-center justify-center" :class="wrapperClass">
        <webview v-if="currentServer?.ip && ready" v-show="!loadingWebview" id="cockpitWebview" :src="currentUrl"
            partition="persist:authSession"
            webpreferences="contextIsolation=true, nodeIntegration=false, enableRemoteModule=false" ref="webview"
            allowpopups :class="['w-full', heightClass]" @did-finish-load="onWebViewLoaded" />

        <div v-if="loadingWebview"
            class="absolute inset-0 bg-default flex flex-col items-center justify-center w-full text-center rounded-lg">
            <p class="text-2xl text-center">Give us a few while we login…</p>
            <div class="spinner" />
        </div>

        <div v-if="!currentServer?.ip && !loadingWebview" class="flex items-center justify-center text-muted w-full"
            :class="heightClass">
            Select a server to load Cockpit.
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDarkModeState } from '@45drives/houston-common-ui'
import { useAdvancedModeState } from '../composables/useAdvancedState'
import { currentServerInjectionKey } from '../keys/injection-keys'
import { IPCRouter, IPCMessageRouterRenderer } from '@45drives/houston-common-lib'
import { useHoustonWebview } from '../composables/useHoustonWebview'

const props = withDefaults(defineProps<{
    routePath?: string              // e.g. '/super-simple-setup' or '/scheduler-test'
    hash?: string                   // e.g. 'simple' (appended as the first hash part)
    heightClass?: string            // Tailwind height utility, e.g. 'h-[100vh]' or 'h-[42vh]'
    wrapperClass?: string           // optional extra classes on the outer wrapper
    openDevtoolsInDev?: boolean     // set true to auto-open devtools in dev
}>(), {
    routePath: '/super-simple-setup',
    hash: '',
    heightClass: 'h-[100vh]',
    wrapperClass: '',
    openDevtoolsInDev: false,
})

const dark = useDarkModeState()
const adv = useAdvancedModeState()
const currentServer = inject(currentServerInjectionKey, ref<any>(null))

// creds & ip supplied by main like your HoustonWebView
const manualCreds = ref<{ ip: string; username: string; password: string } | null>(null)
const clientIp = ref('')
const clientId = ref('');

const webview = ref<any>(null)
const loadingWebview = ref(true)

// Request the ID synchronously before mount so first URL has it
onBeforeMount(async () => {
    try {
        const ident = await window.electron?.ipcRenderer.invoke('get-client-ident')
        clientId.value = ident?.installId || ''
    } catch (e) { console.error('get-client-ident failed', e) }
})


function withQs(path: string, qs: string) {
    if (!qs) return path
    return `${path}${path.includes('?') ? '&' : '?'}${qs}`
}

const currentUrl = computed(() => {
    const ip = currentServer.value?.ip
    if (!ip || !clientId.value) return 'about:blank'

    const base = `https://${ip}:9090${props.routePath}`
    const route = props.hash ? (props.hash.startsWith('/') ? props.hash : `/${props.hash}`) : ''

    // optional: keep dark/advanced/client_ip/server_ip only in search if you want,
    // but they're not needed for this problem.
    const searchQS = new URLSearchParams({
        dark: String(dark.value),
        advanced: String(adv.value),
        client_ip: clientIp.value || '',
        server_ip: ip,
    }).toString()

    // ONLY client_id in the hash so it survives Cockpit’s rewrite
    const hashQS = `client_id=${encodeURIComponent(clientId.value)}`
    const url = `${base}${searchQS ? `?${searchQS}` : ''}#${withQs(route, hashQS)}`
    // console.log('[CockpitWebview] URL:', url)
    return url
})

// Only show the webview when we have a real URL
const ready = computed(() => currentUrl.value !== 'about:blank')

webview.value?.addEventListener('console-message', (e: any) => {
    const msg = `[webview:${e.level}] ${e.message}`
    if (e.level >= 3) console.error(msg)
    else if (e.level === 2) console.warn(msg)
    else console.log(msg)
})


onMounted(async () => {
    window.electron?.ipcRenderer.on('client-ident', (_e, x) => {
        if (!clientId.value) clientId.value = x?.installId || ''
    })
    window.electron?.ipcRenderer.on('client-ip', (_e, ip: string) => { clientIp.value = ip || '' })

    window.electron?.ipcRenderer.send('renderer-ready', {})  // send once

    await nextTick()

    if (webview.value) {
        webview.value.addEventListener('did-fail-load', (e: any) => {
            console.error('webview did-fail-load', e.errorCode, e.errorDescription, e.validatedURL)
            loadingWebview.value = false
        })
        webview.value.addEventListener('dom-ready', () => {
            console.debug('cockpit webview dom-ready')
        })
        webview.value.addEventListener('console-message', (e: any) => {
            const msg = `[webview:${e.level}] ${e.message}`
            if (e.level >= 3) console.error(msg)
            else if (e.level === 2) console.warn(msg)
            else console.log(msg)
        })
    }
})

onBeforeUnmount(() => {
    window.electron?.ipcRenderer.removeAllListeners?.('store-manual-creds')
    window.electron?.ipcRenderer.removeAllListeners?.('client-ip')
})

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
        console.error('Webview login error:', e)
    } finally {
        loadingWebview.value = false
    }

    if (clientId.value) {
        await webview.value?.executeJavaScript(`
      try {
        sessionStorage.setItem('client_id', ${JSON.stringify(clientId.value)});
        localStorage.setItem('client_id', ${JSON.stringify(clientId.value)});
      } catch (e) {}
    `, true)
    }

    if (props.openDevtoolsInDev) {
        const isDev = await window.electron?.ipcRenderer.invoke('is-dev')
        if (isDev) webview.value?.openDevTools?.()
    }

}

// When URL changes (server or flags), show loader again
watch(currentUrl, (url) => {
    loadingWebview.value = url !== 'about:blank'
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
        transform: rotate(0deg)
    }

    100% {
        transform: rotate(360deg)
    }
}
</style>
