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

import { ref, computed, readonly } from 'vue'

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

// Passwords are deliberately kept out of reactive state so they never surface in
// devtools; only the expiry timestamps are reactive, for the countdown badge.
const secrets = new Map<string, string>()
const expiries = ref<Record<string, number>>({})

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function key(host: string, username: string) {
    return `${username}@${host}`
}

function prune() {
    const t = Date.now()
    for (const [k, expiresAt] of Object.entries(expiries.value)) {
        if (t >= expiresAt) {
            delete expiries.value[k]
            secrets.delete(k)
        }
    }
}

function syncTicker() {
    const anyActive = Object.keys(expiries.value).length > 0
    if (anyActive && !ticker) {
        ticker = setInterval(() => {
            now.value = Date.now()
            prune()
            syncTicker()
        }, 1000)
    } else if (!anyActive && ticker) {
        clearInterval(ticker)
        ticker = null
    }
}

/** Returns a still-valid password from the grace window, or null. */
export function cachedAdminPassword(host: string, username: string): string | null {
    const k = key(host, username)
    const expiresAt = expiries.value[k]
    if (!expiresAt || Date.now() >= expiresAt) {
        if (expiresAt) { delete expiries.value[k]; secrets.delete(k); syncTicker() }
        return null
    }
    return secrets.get(k) ?? null
}

export function rememberAdminPassword(host: string, username: string, password: string): void {
    const k = key(host, username)
    secrets.set(k, password)
    expiries.value[k] = Date.now() + GRACE_MS
    now.value = Date.now()
    syncTicker()
}

export function forgetAdminPassword(host: string, username: string): void {
    const k = key(host, username)
    secrets.delete(k)
    delete expiries.value[k]
    syncTicker()
}

/** Clears every grace window. Called when leaving a management view. */
export function forgetAllAdminPasswords(): void {
    secrets.clear()
    expiries.value = {}
    syncTicker()
}

/** Reactive view of one server's grace window, for the header badge. */
export function useAdminSession(getHost: () => string, getUsername: () => string) {
    const expiresAt = computed(() => expiries.value[key(getHost(), getUsername())] ?? 0)
    const active = computed(() => expiresAt.value > now.value)
    const remaining = computed(() => {
        if (!active.value) return ''
        const total = Math.ceil((expiresAt.value - now.value) / 1000)
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
    })

    return {
        active,
        remaining,
        revoke: () => forgetAdminPassword(getHost(), getUsername()),
    }
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
