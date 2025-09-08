// registerIpcActionListener.ts
import { IPCRouter } from "@45drives/houston-common-lib";
import type { Router } from "vue-router";

type Options = {
  vueRouter: Router;

  // Optional hooks you may already have in your app:
  setShowWebView?: (v: boolean) => void;        // e.g. show/hide WebView pane
  setCurrentWizard?: (w: string | null) => void; // store the current wizard id
  openStorageSetup?: (arg: unknown) => void;     // existing helper from your old app
  openHoustonWindow?: () => void;                // existing helper from your old app

  // Reboot helpers from your old flow (recommended to pass in):
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
    // Prefer named routes if you have them registered
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
              pushRoute({ name: "BackupManager" }); // or { path: "/backup-manager" }
              break;
            }

            // Preserve old behavior for storage / restore-backup
            if (["storage", "restore-backup"].includes(wiz)) {
              setCurrentWizard?.(wiz);
              setShowWebView?.(false);
              if (openStorageSetup) {
                openStorageSetup(null);
              } else {
                // Sensible fallback if you don’t pass openStorageSetup:
                const fallbackName = wiz === "storage" ? "StorageSetup" : "RestoreBackupWizard";
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

            // Keep old flow if you provide the helper:
            if (waitForServerRebootAndShowWizard) {
              await waitForServerRebootAndShowWizard();
            }

            // After reboot, route accordingly:
            if (wiz === "backup") {
              pushRoute({ name: "BackupManager" });
            } else if (wiz === "storage") {
              if (openStorageSetup) openStorageSetup(null);
              else pushRoute({ name: "StorageSetup" });
            } else if (wiz === "restore-backup") {
              pushRoute({ name: "RestoreBackupWizard" });
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
              // Fallback: navigate to a webview route if you have one
              pushRoute({ name: "HoustonWebView" });
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
              pushRoute({ name: "HoustonWebView" });
            }

            isRebootWatcherRunning = false;
            break;
          }

          // Optional: a generic route message if you ever send it
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

  // Return an unregister to call on unmount if you want cleanup
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
