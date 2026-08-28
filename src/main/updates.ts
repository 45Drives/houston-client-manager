import { app, BrowserWindow, ipcMain } from 'electron'

type UpdateState = {
    status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
    currentVersion: string
    platform: NodeJS.Platform
    version?: string
    releaseNotes?: string
    percent?: number
    message?: string
}

export function initAutoUpdates(getMainWindow: () => BrowserWindow | null) {
    // Never run auto-update in dev
    if (!app.isPackaged) {
        ipcMain.handle('update:status', async () => ({
            status: 'idle',
            currentVersion: app.getVersion(),
            platform: process.platform,
        }))
        ipcMain.handle('update:check', async () => ({ ok: false, devMode: true }))
        ipcMain.handle('update:download', async () => ({ ok: false, devMode: true }))
        ipcMain.handle('update:install', async () => ({ ok: false, devMode: true }))
        return
    }

    let autoUpdater: any
    try {
        ;({ autoUpdater } = require('electron-updater'))
    } catch (e) {
        console.warn('[updates] electron-updater is unavailable; auto-update disabled.', e)
        return
    }

    // Cached so the renderer can recover state if it mounts after an event fired.
    let lastState: UpdateState = {
        status: 'idle',
        currentVersion: app.getVersion(),
        platform: process.platform,
    }

    function emit(channel: string, state: UpdateState) {
        lastState = state
        getMainWindow()?.webContents.send(channel, state)
    }

    // Both opt-in: the in-app prompt drives download and install, so the user is
    // never surprised by a background download or an unexplained elevation prompt
    // on quit (pkexec on Linux, the NSIS installer on Windows).
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
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

    const base = () => ({ currentVersion: app.getVersion(), platform: process.platform })

    autoUpdater.on('checking-for-update', () => {
        emit('update:checking', { ...base(), status: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
        console.info(`[updates] update available: ${info?.version}`)
        emit('update:available', {
            ...base(),
            status: 'available',
            version: info?.version,
            releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : undefined,
        })
    })

    autoUpdater.on('update-not-available', () => {
        emit('update:none', { ...base(), status: 'none' })
    })

    autoUpdater.on('download-progress', (p) => {
        emit('update:progress', {
            ...base(),
            status: 'downloading',
            version: lastState.version,
            percent: p?.percent ?? 0,
        })
    })

    autoUpdater.on('update-downloaded', (info) => {
        console.info(`[updates] update downloaded: ${info?.version}`)
        emit('update:downloaded', {
            ...base(),
            status: 'downloaded',
            version: info?.version ?? lastState.version,
        })
    })

    autoUpdater.on('error', (err) => {
        console.warn('[updates] updater error', err)
        emit('update:error', { ...base(), status: 'error', message: normalizeUpdaterError(err) })
    })

    ipcMain.handle('update:status', async () => lastState)

    ipcMain.handle('update:check', async () => {
        try {
            await autoUpdater.checkForUpdates()
            return { ok: true }
        } catch (err) {
            throw new Error(normalizeUpdaterError(err))
        }
    })
    ipcMain.handle('update:download', async () => {
        console.info(`update:download \u2014 downloading v${lastState.version}`)
        emit('update:progress', { ...base(), status: 'downloading', version: lastState.version, percent: 0 })
        try {
            await autoUpdater.downloadUpdate()
            return { ok: true }
        } catch (err) {
            const message = normalizeUpdaterError(err)
            emit('update:error', { ...base(), status: 'error', version: lastState.version, message })
            throw new Error(message)
        }
    })
    ipcMain.handle('update:install', async () => {
        console.info('update:install — quitting and installing update');
        // isSilent suppresses the NSIS installer UI on Windows; ignored on macOS/Linux.
        autoUpdater.quitAndInstall(true, true)
        return { ok: true }
    })

    const check = () => autoUpdater.checkForUpdates().catch(() => { /* surfaced via the error event */ })

    // Initial check once the renderer has had time to subscribe, then every 6 hours.
    setTimeout(check, 8_000)
    setInterval(check, 6 * 60 * 60 * 1000)
}
