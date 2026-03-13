// 1) capture originals
const _origWarn = console.warn.bind(console)
const _origError = console.error.bind(console)

// 2) override warn & error
console.warn = (...args: any[]) => {
    const msg = args.map(String).join(' ')
    if (
        msg.includes('APPIMAGE env is not defined') ||
        msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')
    ) return
    _origWarn(...args)
}

console.error = (...args: any[]) => {
    const msg = args.map(String).join(' ')
    if (msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return
    _origError(...args)
}

// Tell TS about the preload API
declare global {
    interface Window {
        electron: {
            ipcRenderer: {
                send: (channel: string, data?: any) => void;
                on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
                invoke: (channel: string, ...args: any[]) => Promise<any>;
                once: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
                removeListener: (channel: string, listener: (...args: any[]) => void) => void;
                removeAllListeners: (channel: string) => void;
            };
            selectFolder: () => Promise<string | null>;
            getOS: () => Promise<string>;
            isFirstRunNeeded: (host: string, share: string, smbUser: string) => Promise<boolean>;
            log: {
                debug: (...args: any[]) => void;
                info: (...args: any[]) => void;
                warn: (...args: any[]) => void;
                error: (...args: any[]) => void;
                log: (...args: any[]) => void;
            };
        };
    }
}

import { IPCRouter } from '@45drives/houston-common-lib'
IPCRouter.initRenderer()

import { createApp, onMounted } from 'vue';
import "@45drives/houston-common-css/src/index.css"; 
import "@45drives/houston-common-ui/style.css"; 
import "./style.css"; 
import AppShell from '../app/AppShell.vue'
import { router } from '../app/routes'
import { enterNextDirective } from '@45drives/houston-common-ui'

document.title = `45Drives Storage Wizard v${__APP_VERSION__}`;

const app = createApp(AppShell)
app.use(router)
app.directive('enter-next', enterNextDirective);
app.mount('#app');
document.documentElement.classList.add('theme-homelab');
window.electron?.ipcRenderer.send('renderer-ready');

const IGNORE = [
    'setup() return property "_" should not start with "$" or "_"',
    'Extraneous non-props attributes'
]

app.config.warnHandler = (msg, instance, trace) => {
    // swallow any warning whose text matches one of the patterns
    if (IGNORE.some(p => msg.includes(p))) return

    // otherwise let it through
    console.warn(`[Vue warn]: ${msg}${trace}`)
}

// Forward renderer console output to main process Winston logger
;(async () => {
    let isDev = false;
    try {
        isDev = await window.electron.ipcRenderer.invoke("is-dev");
    } catch {
        isDev =
            typeof import.meta !== "undefined" &&
            (import.meta as any).env &&
            (import.meta as any).env.MODE === "development";
    }

    const originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };

    (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
        (console as any)[level] = (...args: any[]) => {
            // Send to main logger
            try {
                const mapped = level === "log" ? "info" : level;
                if (window.electron?.log) {
                    (window.electron.log as any)[mapped](...args);
                }
            } catch {
                // never let logging break the app
            }

            // Also show in DevTools in dev
            if (isDev) {
                (originalConsole as any)[level](...args);
            }
        };
    });
})();