// src/renderer/main.ts

// Tell TS about the preload API
declare global {
    interface Window {
        electron: {
            ipcRenderer: {
                invoke: (channel: string, ...args: any[]) => Promise<any>;
            };
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

// Patch console → send to main → Winston
(async () => {
    let isDev = false;
    try {
        // main.ts already has: ipcMain.handle("is-dev", ...)
        isDev = await window.electron.ipcRenderer.invoke("is-dev");
    } catch {
        // optional fallback if you use Vite env
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

    const NOISY_WARNINGS = [
        "APPIMAGE env is not defined",
        "NODE_TLS_REJECT_UNAUTHORIZED",
    ];

    function shouldDrop(msg: string) {
        return NOISY_WARNINGS.some((p) => msg.includes(p));
    }

    (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
        (console as any)[level] = (...args: any[]) => {
            const msg = args.map((a) => String(a)).join(" ");

            // Drop specific noisy messages on warn/error
            if (
                (level === "warn" || level === "error") &&
                shouldDrop(msg)
            ) {
                if (isDev) {
                    // if you still want to see them in dev, keep this line
                    (originalConsole as any)[level](...args);
                }
                return;
            }

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

// ---------------- Vue bootstrapping ----------------

import { createApp } from "vue";
import "@45drives/houston-common-css/src/index.css";
import "@45drives/houston-common-ui/style.css";
import "./style.css";
import App from "./App.vue";
import { enterNextDirective } from "@45drives/houston-common-ui";

document.title = `45Drives Setup & Backup Wizard v${__APP_VERSION__}`;

const app = createApp(App);
app.directive("enter-next", enterNextDirective);
app.mount("#app");
document.documentElement.classList.add("theme-homelab");

const IGNORE = [
    'setup() return property "_" should not start with "$" or "_"',
    "Extraneous non-props attributes",
];

app.config.warnHandler = (msg, instance, trace) => {
    if (IGNORE.some((p) => msg.includes(p))) return;
    console.warn(`[Vue warn]: ${msg}${trace}`);
};
