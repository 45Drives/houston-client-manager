<template>
    <div class="w-full relative flex flex-col items-center justify-center" :class="wrapperClass">
        <webview v-if="currentServer?.ip && ready" v-show="!loadingWebview && !connectionIssue" id="cockpitWebview"
            :src="currentUrl" partition="persist:authSession"
            webpreferences="contextIsolation=true, nodeIntegration=false, enableRemoteModule=false" ref="webview"
            allowpopups :class="['w-full', heightClass]" @did-finish-load="onWebViewLoaded" />

        <div v-if="loadingWebview && !connectionIssue"
            class="absolute inset-0 bg-default flex flex-col items-center justify-center w-full text-center rounded-lg">
            <p class="text-2xl text-center">Give us a few while we login…</p>
            <div class="spinner" />
        </div>

        <div v-else-if="connectionIssue"
            class="absolute inset-0 bg-default flex flex-col items-center justify-center w-full text-center rounded-lg px-6">
            <div class="max-w-md space-y-3">
                <div v-if="!reconnectGaveUp" class="spinner mx-auto" />
                <p class="text-2xl">
                    {{ reconnectGaveUp ? 'Still waiting on the server' : 'Reconnecting…' }}
                </p>
                <p class="text-base text-default">{{ connectionIssue.message }}</p>
                <p v-if="connectionIssue.hint" class="text-sm text-muted">{{ connectionIssue.hint }}</p>
                <p v-if="!reconnectGaveUp" class="text-xs text-muted">
                    <template v-if="retryCountdown > 0">Trying again in {{ retryCountdown }}s</template>
                    <template v-else>Trying again now</template>
                    — attempt {{ retryAttempt + 1 }} of {{ MAX_RETRY_ATTEMPTS }}
                </p>
                <button class="btn btn-primary h-fit" type="button" @click="retryNow">
                    {{ reconnectGaveUp ? 'Try again' : 'Try now' }}
                </button>
            </div>
        </div>

        <div v-if="!currentServer?.ip && !loadingWebview && !connectionIssue"
            class="flex items-center justify-center text-muted w-full" :class="heightClass">
            Select a server to load Cockpit.
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDarkModeState } from '@45drives/houston-common-ui'
import { useAdvancedModeState } from '../composables/useAdvancedState'
import { currentServerInjectionKey } from '../keys/injection-keys'
import { IPCRouter, IPCMessageRouterRenderer } from '@45drives/houston-common-lib'
import { useHoustonWebview } from '../composables/useHoustonWebview'
import { useServerCredentials } from '../composables/useServerCredentials'
import { describeLoadError, failureLine, type ConnectivityFailure } from '../../shared/connectionErrors'

const props = withDefaults(defineProps<{
    routePath?: string              // e.g. '/super-simple-setup' or '/scheduler-test'
    hash?: string                   // e.g. 'simple' (appended as the first hash part)
    heightClass?: string            // Tailwind height utility, e.g. 'h-[100vh]' or 'h-[42vh]'
    wrapperClass?: string           // optional extra classes on the outer wrapper
    openDevtoolsInDev?: boolean     // set true to auto-open devtools in dev
    requireAdmin?: boolean          // attempt superuser elevation after login (default true)
}>(), {
    routePath: '/super-simple-setup',
    hash: '',
    heightClass: 'h-[100vh]',
    wrapperClass: '',
    openDevtoolsInDev: false,
    requireAdmin: true,
})

const dark = useDarkModeState()
const adv = useAdvancedModeState()
const currentServer = inject(currentServerInjectionKey, ref<any>(null))
const { getCredentials } = useServerCredentials()

// Resolve theme alias from the connected server's info
const serverAliasStyle = computed(() => currentServer.value?.serverInfo?.aliasStyle || '')

// creds & ip supplied by main like HoustonWebView
const manualCreds = ref<{ ip: string; username: string; password: string } | null>(null)
const clientIp = ref('')
const clientId = ref('');
const disconnected = ref(false);

const webview = ref<any>(null)
const loadingWebview = ref(true)
// Guard to prevent dark-mode sync feedback loops between client ↔ webview
let suppressDarkSync = false

// ── Reconnect handling ──────────────────────────────────────────────────
// A server restart (updates, hostname change, reboot) makes Cockpit briefly
// unreachable. Rather than dumping a Chromium error page and a stack of
// console errors on the user, we show a "Reconnecting…" panel and retry.
const RETRY_DELAYS_SEC = [2, 3, 5, 8, 10, 15]
const MAX_RETRY_ATTEMPTS = 12

const connectionIssue = ref<ConnectivityFailure | null>(null)
const retryAttempt = ref(0)
const retryCountdown = ref(0)
const reconnectGaveUp = ref(false)
let retryTimer: ReturnType<typeof setTimeout> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null
// Set while the current navigation is known to have failed, so `dom-ready`
// on the Chromium error page doesn't try to inject scripts into it.
let navigationFailed = false

const serverLabel = computed(
    () => currentServer.value?.name || currentServer.value?.ip || 'the server'
)

function clearRetryTimers() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    retryCountdown.value = 0
}

function resetConnectionState() {
    clearRetryTimers()
    connectionIssue.value = null
    retryAttempt.value = 0
    reconnectGaveUp.value = false
    navigationFailed = false
}

function reloadWebview() {
    clearRetryTimers()
    const wv = webview.value
    if (!wv || !ready.value) return
    navigationFailed = false
    loadingWebview.value = true
    try {
        // The rejection here duplicates `did-fail-load`, which is where the
        // retry decision is made — swallow it so it isn't reported twice.
        wv.loadURL(currentUrl.value)?.catch?.(() => { })
    } catch {
        // The element can be torn down between the timer firing and this call.
    }
}

function scheduleReconnect() {
    clearRetryTimers()
    const delay = RETRY_DELAYS_SEC[Math.min(retryAttempt.value, RETRY_DELAYS_SEC.length - 1)]
    retryCountdown.value = delay
    countdownTimer = setInterval(() => {
        if (retryCountdown.value > 0) retryCountdown.value -= 1
    }, 1000)
    retryTimer = setTimeout(() => {
        retryAttempt.value += 1
        reloadWebview()
    }, delay * 1000)
}

function retryNow() {
    reconnectGaveUp.value = false
    retryAttempt.value = 0
    reloadWebview()
}

/**
 * Run a script inside the webview without turning an expected teardown
 * (server restart, navigation) into a user-visible error.
 */
function safeInject(wv: any, script: string, label: string) {
    if (navigationFailed) return
    wv.executeJavaScript(script).catch((err: any) => {
        console.debug(`[CockpitWebview] ${label} skipped — page unavailable:`, err?.message || err)
    })
}

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

    // Only include stable values in the URL – reactive flags like dark/advanced
    // must NOT go here because changing them would recompute the URL and force
    // the webview to navigate (full page reload).  Dark mode is synced via
    // localStorage injection (see watch(dark, …) below).
    const searchQS = new URLSearchParams({
        client_ip: clientIp.value || '',
        server_ip: ip,
    }).toString()

    // client_id + aliasStyle in the hash so they survive Cockpit's rewrite
    const parts = [`client_id=${encodeURIComponent(clientId.value)}`]
    if (serverAliasStyle.value) parts.push(`aliasStyle=${encodeURIComponent(serverAliasStyle.value)}`)
    const hashQS = parts.join('&')
    const url = `${base}${searchQS ? `?${searchQS}` : ''}#${withQs(route, hashQS)}`
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

// Attach webview event listeners when the element appears in the DOM.
// The webview uses v-if so it may not exist at onMounted time.
watch(webview, (wv) => {
    if (!wv) return
    wv.addEventListener('did-start-loading', () => { navigationFailed = false })
    wv.addEventListener('did-fail-load', (e: any) => {
        // Sub-resource/iframe failures inside Cockpit shouldn't tear down the shell.
        if (e.isMainFrame === false) return

        const failure = describeLoadError(e.errorCode, serverLabel.value, e.errorDescription)
        // -3 ABORTED just means a newer navigation replaced this one.
        if (failure.kind === 'aborted') return

        navigationFailed = true
        loadingWebview.value = false
        connectionIssue.value = failure

        if (failure.transient && retryAttempt.value < MAX_RETRY_ATTEMPTS) {
            reconnectGaveUp.value = false
            // One line when the outage starts; retries stay at debug so a
            // 30-second reboot doesn't fill the log viewer with red rows.
            if (retryAttempt.value === 0) {
                console.warn(`[CockpitWebview] ${failureLine(failure)} Reconnecting automatically.`)
            } else {
                console.debug(`[CockpitWebview] reconnect attempt ${retryAttempt.value} failed (${failure.detail})`)
            }
            scheduleReconnect()
            return
        }

        clearRetryTimers()
        reconnectGaveUp.value = true
        console.error(`[CockpitWebview] ${failureLine(failure)} (${failure.detail})`)
    })
    wv.addEventListener('dom-ready', () => {
        console.debug('cockpit webview dom-ready')
        if (navigationFailed) return
        injectChromeCSS(wv)
        // Sync client dark mode into the webview's localStorage and fire
        // the custom event so useDarkModeState picks it up immediately.
        const darkStyle = dark.value ? 'dark' : 'light'
        safeInject(wv, `
            localStorage.setItem('shell:style', '${darkStyle}');
            window.dispatchEvent(new CustomEvent('cockpit-style', { detail: { style: '${darkStyle}' } }));
        `, 'dark mode sync')
        // Inject a relay so dark mode changes made INSIDE the webview
        // (e.g. via the setup module's theme toggle) propagate back to the
        // client app.  Uses a tagged console.log picked up by console-message.
        safeInject(wv, `
          (function() {
            if (window.__darkModeRelayInstalled) return;
            window.__darkModeRelayInstalled = true;
            window.addEventListener('cockpit-style', function(e) {
              var style = e.detail && e.detail.style;
              if (style === 'dark' || style === 'light') {
                console.log('__45D_DARK_MODE__:' + style);
              }
            });
          })();
        `, 'dark mode relay')
        // Inject a postMessage relay so scheduler iframe can request OAuth
        // and receive tokens back. The scheduler cannot call window.open()
        // from within its Cockpit iframe, so it posts a message upward.
        // The relay logs a tagged string which the console-message listener
        // on the Electron side picks up to open a real BrowserWindow via IPC.
        safeInject(wv, `
          (function() {
            if (window.__oauthRelayInstalled) return;
            window.__oauthRelayInstalled = true;
            window.addEventListener('message', function(e) {
              if (e.data && e.data.type === '45d-oauth-request' && e.data.url) {
                console.log('__45D_OAUTH_REQUEST__:' + e.data.url);
              }
              if (e.data && e.data.type === '45d-client-log' && e.data.entry) {
                try { console.log('__45D_CLIENT_LOG__:' + JSON.stringify(e.data.entry)); } catch (err) {}
              }
            });
          })();
        `, 'OAuth relay')
    })
    wv.addEventListener('console-message', async (e: any) => {
        const message = e.message || ''
        // Structured activity relayed from the embedded Cockpit module (scheduler, setup, …)
        if (typeof message === 'string' && message.startsWith('__45D_CLIENT_LOG__:')) {
            try {
                const entry = JSON.parse(message.slice('__45D_CLIENT_LOG__:'.length))
                window.electron?.ipcRenderer.send('logs:module-event', entry)
            } catch {
                /* malformed payload from webview — drop it */
            }
            return
        }
        // Handle dark mode changes relayed from inside the webview
        if (typeof message === 'string' && message.startsWith('__45D_DARK_MODE__:')) {
            const style = message.slice('__45D_DARK_MODE__:'.length)
            const shouldBeDark = style === 'dark'
            if (dark.value !== shouldBeDark) {
                suppressDarkSync = true
                localStorage.setItem('shell:style', style)
                window.dispatchEvent(new CustomEvent('cockpit-style', { detail: { style } }))
                suppressDarkSync = false
            }
            return
        }
        // Handle OAuth requests relayed from scheduler iframe via console.log
        if (typeof message === 'string' && message.startsWith('__45D_OAUTH_REQUEST__:')) {
            const url = message.slice('__45D_OAUTH_REQUEST__:'.length)
            console.log('[CockpitWebview] OAuth request intercepted:', url)
            try {
                const result = await window.electron?.ipcRenderer.invoke('oauth:open', url)
                if (result?.success && result.token) {
                    const envelope = JSON.stringify({ type: '45d-oauth-response', ...result.token })
                    wv.executeJavaScript(`
                        (function() {
                            var data = ${envelope};
                            function broadcast(win, d) {
                                for (var i = 0; i < win.frames.length; i++) {
                                    try { win.frames[i].postMessage(d, '*'); } catch(e) {}
                                    try { broadcast(win.frames[i], d); } catch(e) {}
                                }
                            }
                            window.postMessage(data, '*');
                            broadcast(window, data);
                        })();
                    `)
                }
            } catch (err) {
                console.error('OAuth IPC error:', err)
            }
            return
        }
        const msg = `[webview:${e.level}] ${message}`
        if (e.level >= 3) console.error(msg)
        else if (e.level === 2) console.warn(msg)
        else console.log(msg)
    })
})

onMounted(() => {
    // Hydrate credentials from the shared store (set before navigation)
    const ip = currentServer.value?.ip
    if (ip && !manualCreds.value) {
        const stored = getCredentials(ip)
        if (stored) {
            manualCreds.value = { ip, username: stored.username, password: stored.password }
        }
    }

    window.electron?.ipcRenderer.on('client-ident', (_e, x) => {
        if (!clientId.value) clientId.value = x?.installId || ''
    })
    window.electron?.ipcRenderer.on('client-ip', (_e, ipVal: string) => { clientIp.value = ipVal || '' })

    window.electron?.ipcRenderer.send('renderer-ready', {})  // send once
})

onBeforeUnmount(() => {
    clearRetryTimers()
    window.electron?.ipcRenderer.removeAllListeners?.('store-manual-creds')
    window.electron?.ipcRenderer.removeAllListeners?.('client-ip')
})

const { loginIntoCockpit, injectChromeCSS } = useHoustonWebview()

const onWebViewLoaded = async () => {
    // The page came back — drop any "Reconnecting…" state.
    resetConnectionState()
    const view = webview.value
    if (view) {
        const routerRenderer = IPCRouter.getInstance() as IPCMessageRouterRenderer
        routerRenderer.setCockpitWebView(view)
    }

    // If manualCreds are missing, try hydrating from the in-memory store
    // (covers tab-switch: component is recreated but the store still has creds).
    if (!manualCreds.value && !disconnected.value) {
        const ip = currentServer.value?.ip
        if (ip) {
            const stored = getCredentials(ip)
            if (stored) {
                manualCreds.value = { ip, username: stored.username, password: stored.password }
            }
        }
    }

    if (!manualCreds.value || disconnected.value) { loadingWebview.value = false; return; }
    const { username: user, password: pass } = manualCreds.value;

    try {
        await loginIntoCockpit(webview.value, { user, pass, elevate: props.requireAdmin })
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

// Push dark mode changes to the webview in real-time.
// Update localStorage AND dispatch the custom event so both cross-frame
// storage listeners and same-frame cockpit-style listeners pick it up.
watch(dark, (isDark) => {
    if (suppressDarkSync) return
    const wv = webview.value
    if (!wv) return
    const style = isDark ? 'dark' : 'light'
    wv.executeJavaScript(`
        localStorage.setItem('shell:style', '${style}');
        window.dispatchEvent(new CustomEvent('cockpit-style', { detail: { style: '${style}' } }));
    `).catch(() => {})
})

// When URL changes (server or flags), show loader again
watch(currentUrl, (url) => {
    resetConnectionState()
    loadingWebview.value = url !== 'about:blank'
}, { immediate: true })

window.electron?.ipcRenderer.on('store-manual-creds', (_e, creds: { ip: string; username: string; password: string }) => {
    if (currentServer.value?.ip === creds.ip) {
        disconnected.value = false;
        manualCreds.value = creds;
    }
});

// When currentServer changes, check the shared credential store
watch(() => currentServer.value?.ip, (ip) => {
    disconnected.value = false;
    if (!ip || manualCreds.value?.ip === ip) return
    const stored = getCredentials(ip)
    if (stored) {
        manualCreds.value = { ip, username: stored.username, password: stored.password }
    }
}, { immediate: false })

// If credentials arrive after the webview has already loaded (e.g. favorite
// auto-connect), trigger login now instead of showing the Cockpit login screen.
watch(manualCreds, async (creds) => {
    if (!creds || !webview.value || disconnected.value) return;
    // Still loading → onWebViewLoaded will handle it
    if (loadingWebview.value) return;

    loadingWebview.value = true;
    try {
        await loginIntoCockpit(webview.value, { user: creds.username, pass: creds.password, elevate: props.requireAdmin });
    } catch (e) {
        console.error('Webview auto-login error:', e);
    } finally {
        loadingWebview.value = false;
    }
});

async function logoutFromCurrentServer() {
    const ip = currentServer.value?.ip;
    if (!ip || !webview.value) return;

    const origin = `https://${ip}:9090`;

    // 1. Tell Cockpit to log out (drops its server-side session + cookies)
    try {
        await webview.value.executeJavaScript(`
            fetch('/cockpit/logout', { method: 'POST', credentials: 'same-origin' })
                .catch(function() {})
        `)
    } catch (e) {
        console.error('Cockpit logout request error:', e)
    }

    // 2. Clear in-page storage
    try {
        await webview.value.executeJavaScript(`
            try { sessionStorage.clear(); localStorage.clear(); } catch(e) {}
        `)
    } catch (e) {
        console.error('Storage clear error:', e)
    }

    // 3. Clear the partition's cookies/storage for this origin via main process
    try {
        await window.electron?.ipcRenderer.invoke('session:clear-origin', origin)
    } catch (e) {
        console.error('session:clear-origin error:', e)
    }

    // 4. Drop in-memory creds and suppress auto-login
    disconnected.value = true;
    manualCreds.value = null;
    loadingWebview.value = true;
    webview.value.reload();
}

defineExpose({ logoutFromCurrentServer });
</script>

<style scoped>
.spinner {
    border: 4px solid rgba(128, 128, 128, 0.2);
    border-left-color: currentColor;
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
