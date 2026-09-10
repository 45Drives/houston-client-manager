/**
 * useAdminGate — re-authentication prompt for destructive server actions.
 *
 * The password is never compared locally. It is handed to the main process,
 * which opens a password-only SSH session with it, so a wrong password fails at
 * the server rather than at a client-side check.
 *
 * Module-scoped state: one prompt at a time, rendered by AdminGateModal in the
 * app shell so any view can trigger it.
 */

import { ref, readonly } from 'vue'

/** How long a verified password stays usable, matching sudo's default. */
const GRACE_MS = 5 * 60 * 1000

interface PendingPrompt {
    host: string
    username: string
    label: string
    error: string
    resolve: (password: string | null) => void
}

const pending = ref<PendingPrompt | null>(null)
const verified = new Map<string, { password: string; expiresAt: number }>()

function key(host: string, username: string) {
    return `${username}@${host}`
}

/** Returns a still-valid password from the grace window, or null. */
export function cachedAdminPassword(host: string, username: string): string | null {
    const hit = verified.get(key(host, username))
    if (!hit) return null
    if (Date.now() >= hit.expiresAt) {
        verified.delete(key(host, username))
        return null
    }
    return hit.password
}

export function rememberAdminPassword(host: string, username: string, password: string): void {
    verified.set(key(host, username), { password, expiresAt: Date.now() + GRACE_MS })
}

export function forgetAdminPassword(host: string, username: string): void {
    verified.delete(key(host, username))
}

/** Clears every grace window. Called when leaving a management view. */
export function forgetAllAdminPasswords(): void {
    verified.clear()
}

/** Resolves with the typed password, or null if the user cancelled. */
export function promptAdminPassword(
    host: string,
    username: string,
    label: string,
    error = '',
): Promise<string | null> {
    // A second prompt would orphan the first caller's promise.
    if (pending.value) pending.value.resolve(null)
    return new Promise(resolve => {
        pending.value = { host, username, label, error, resolve }
    })
}

export function useAdminGatePrompt() {
    function submit(password: string) {
        const p = pending.value
        if (!p) return
        pending.value = null
        p.resolve(password)
    }

    function cancel() {
        const p = pending.value
        if (!p) return
        pending.value = null
        p.resolve(null)
    }

    return { pending: readonly(pending), submit, cancel }
}
