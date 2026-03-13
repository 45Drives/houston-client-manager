// registerIpcActionListener.ts
import { IPCRouter } from "@45drives/houston-common-lib";
import type { Router } from "vue-router";

type Options = {
  vueRouter: Router;

  // Optional hooks:
  setShowWebView?: (v: boolean) => void;        // show/hide WebView pane
  setCurrentWizard?: (w: string | null) => void; // store the current wizard id
  openStorageSetup?: (arg: unknown) => void;
  openHoustonWindow?: () => void;

  // Reboot helpers (recommended to pass in):
  waitForServerRebootAndShowWizard?: () => Promise<void>;
  waitForServerRebootAndOpenHouston?: () => Promise<void>;
};

export function registerIpcActionListener(opts: Options) {
  const {
    vueRouter,
    setShowWebView,
    setCurrentWizard,
    openStorageSetup,
    openHoustonWindow,
    waitForServerRebootAndShowWizard,
    waitForServerRebootAndOpenHouston,
  } = opts;

  const ipc = IPCRouter.getInstance();

  let actionListener: ((data: any) => void | Promise<void>) | null = null;
  let isRebootWatcherRunning = false;

  const pushRoute = (nameOrPath: { name?: string; path?: string }) => {
    // Prefer named routes if registered
    vueRouter.push(nameOrPath).catch((e) => {
      // Ignore NavigationDuplicated or similar benign errors
      if (e && e.name !== "NavigationDuplicated") console.error(e);
    });
  };

  if (!actionListener) {
    actionListener = async (data: any) => {
      try {
        const message = typeof data === "string" ? JSON.parse(data) : data;

        switch (message.type) {
          // === OLD SYNTAX: KEEP BEHAVIOR ===
          case "show_wizard":
          case "wizard_go_back": {
            const wiz = message.wizard as string | undefined;

            if (!wiz) break;

            // New behavior for "backup": go to BackupManager route.
            if (wiz === "backup") {
              setCurrentWizard?.("backup");
              setShowWebView?.(false);
              pushRoute({ name: "backup" });
              break;
            }

            // Preserve old behavior for storage / restore-backup
            if (["storage", "restore-backup"].includes(wiz)) {
              setCurrentWizard?.(wiz);
              setShowWebView?.(false);
              if (openStorageSetup) {
                openStorageSetup(null);
              } else {
                // Fallback if openStorageSetup not provided:
                const fallbackName = wiz === "storage" ? "setup" : "restore";
                pushRoute({ name: fallbackName });
              }
            }
            break;
          }

          case "reboot_and_show_wizard": {
            if (isRebootWatcherRunning) return;
            isRebootWatcherRunning = true;

            const wiz = message.wizard as string | undefined;
            setCurrentWizard?.(wiz ?? null);
            setShowWebView?.(false);

            // Keep old flow if the helper is provided:
            if (waitForServerRebootAndShowWizard) {
              await waitForServerRebootAndShowWizard();
            }

            // After reboot, route accordingly:
            if (wiz === "backup") {
              pushRoute({ name: "backup" });
            } else if (wiz === "storage") {
              if (openStorageSetup) openStorageSetup(null);
              else pushRoute({ name: "setup" });
            } else if (wiz === "restore-backup") {
              pushRoute({ name: "restore" });
            }

            isRebootWatcherRunning = false;
            break;
          }

          case "show_webview": {
            setCurrentWizard?.(null);
            setShowWebView?.(true);
            if (openHoustonWindow) {
              openHoustonWindow();
            } else {
              // Fallback: navigate to a webview route
              pushRoute({ name: "houston" });
            }
            break;
          }

          case "reboot_and_show_webview": {
            if (isRebootWatcherRunning) return;
            isRebootWatcherRunning = true;

            if (waitForServerRebootAndOpenHouston) {
              await waitForServerRebootAndOpenHouston();
            }

            setCurrentWizard?.(null);
            setShowWebView?.(true);
            if (openHoustonWindow) {
              openHoustonWindow();
            } else {
              pushRoute({ name: "houston" });
            }

            isRebootWatcherRunning = false;
            break;
          }

          // Generic route message handler
          case "show_route": {
            if (message.route) {
              // Accept either a name or a path from the payload
              if (message.by === "path") pushRoute({ path: String(message.route) });
              else pushRoute({ name: String(message.route) });
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error(" IPC action handler error:", err);
      }
    };

    ipc.addEventListener("action", actionListener);
  }

  // Return unregister function for cleanup on unmount
  return () => {
    if (actionListener) {
      try {
        ipc.removeEventListener?.("action", actionListener as any);
      } catch {
        // Older builds may not have removeEventListener; ignore safely
      }
      actionListener = null;
    }
  };
}
