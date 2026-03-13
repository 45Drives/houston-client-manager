import { app, BrowserWindow, ipcMain } from 'electron'

export function initAutoUpdates(getMainWindow: () => BrowserWindow | null) {
    // Never run auto-update in dev
    if (!app.isPackaged) return

    let autoUpdater: any
    try {
        ;({ autoUpdater } = require('electron-updater'))
    } catch (e) {
        console.warn('[updates] electron-updater is unavailable; auto-update disabled.', e)
        return
    }

    // Optional: safer UX defaults
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.fullChangelog = false
    autoUpdater.allowPrerelease = false

    function normalizeUpdaterError(err: any): string {
        const raw = String(err?.message || err || 'Unknown updater error')
        const compact = raw.replace(/\s+/g, ' ').trim()

        // electron-updater can surface entire GitHub Atom/XML payloads in error messages.
        // Convert those into actionable, user-facing text.
        if (/<(feed|entry|content|title|updated|link)\b/i.test(compact) || /&lt;[a-z!/]/i.test(compact)) {
            return 'We could not read update information right now. Please try again in a minute. If this keeps happening, make sure the GitHub release is published and includes update files.'
        }
        if (/prerelease|pre-release/i.test(compact)) {
            return 'No stable update is available yet. Pre-release versions may not appear in automatic update checks.'
        }
        if (/No published versions on GitHub/i.test(compact)) {
            return 'No published update is available yet.'
        }
        if (/Cannot find .*latest\.yml|404/i.test(compact)) {
            return 'Update files are not available for this release yet. Please try again later.'
        }

        if (/GitHubProvider|getLatestVersion|checkForUpdates|electron-updater|AppUpdater/i.test(compact)) {
            return 'We could not check for updates right now. Please try again later.'
        }

        return 'We could not check for updates right now. Please try again later.'
    }

    autoUpdater.on('checking-for-update', () => {
        getMainWindow()?.webContents.send('update:checking')
    })

    autoUpdater.on('update-available', (info) => {
        getMainWindow()?.webContents.send('update:available', info)
    })

    autoUpdater.on('update-not-available', (info) => {
        getMainWindow()?.webContents.send('update:none', info)
    })

    autoUpdater.on('download-progress', (p) => {
        getMainWindow()?.webContents.send('update:progress', {
            percent: p.percent,
            transferred: p.transferred,
            total: p.total,
            bytesPerSecond: p.bytesPerSecond,
        })
    })

    autoUpdater.on('update-downloaded', (info) => {
        getMainWindow()?.webContents.send('update:downloaded', info)
    })

    autoUpdater.on('error', (err) => {
        getMainWindow()?.webContents.send('update:error', {
            message: normalizeUpdaterError(err),
        })
    })

    ipcMain.handle('update:check', async () => {
        try {
            return await autoUpdater.checkForUpdates()
        } catch (err) {
            throw new Error(normalizeUpdaterError(err))
        }
    })

    ipcMain.handle('update:install', async () => {
        autoUpdater.quitAndInstall(false, true)
        return { ok: true }
    })

    // Do an initial check shortly after app is ready
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 5_000)
}
