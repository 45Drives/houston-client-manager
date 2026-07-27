/**
 * useWireWizard — Composable for managing WireGuard VPN tunnels on remote servers.
 *
 * Wraps the `wirewizard:*` IPC channels with typed helpers for pairing, status, and teardown.
 */

import { ref, type Ref } from 'vue'

type ActionResult<T = any> = { success: boolean; error?: string; data?: T }

export interface WireWizardTunnel {
  name: string
  publicKey: string
  listenPort: number
  peers: Array<{
    publicKey: string
    endpoint: string
    allowedIPs: string
    latestHandshake: number
    transferRx: number
    transferTx: number
    keepalive: number
  }>
}

export interface WireWizardStatus {
  installed: boolean
  configured: boolean
  interfaces: WireWizardTunnel[]
}

export interface PairInitiateResult {
  code: string
  endpoint: string
  port: string
}

export interface PairCompleteResult {
  status: string
  interface: string
  address: string
  listenPort: string
  peerEndpoint: string
}

export interface PollResult {
  claimed: boolean
  claimer?: {
    publicKey: string
    endpoint: string
    localEndpoint?: string
    allowedIPs: string
  }
}

export function useWireWizard(getHost: () => string, getUsername: () => string) {
  const busy = ref(false)
  const lastError = ref<string | null>(null)
  const status: Ref<WireWizardStatus | null> = ref(null)

  async function getPassword(): Promise<string> {
    const cred = await window.electron.ipcRenderer.invoke('cred:get-for', getHost())
    return cred?.password || ''
  }

  // Get tunnel status from the server
  async function fetchStatus(): Promise<WireWizardStatus | null> {
    busy.value = true
    lastError.value = null
    try {
      const password = await getPassword()
      const result: ActionResult<WireWizardStatus> = await window.electron.ipcRenderer.invoke('wirewizard:status', {
        host: getHost(),
        username: getUsername(),
        password,
      })
      if (result.success) {
        status.value = result.data!
        return result.data!
      }
      lastError.value = result.error || 'Failed to get status'
      return null
    } finally {
      busy.value = false
    }
  }

  // Initiate pairing (generates code on the server)
  async function initiate(opts: { name?: string; ttl?: number } = {}): Promise<PairInitiateResult | null> {
    busy.value = true
    lastError.value = null
    try {
      const password = await getPassword()
      const result: ActionResult<PairInitiateResult> = await window.electron.ipcRenderer.invoke('wirewizard:initiate', {
        host: getHost(),
        username: getUsername(),
        password,
        name: opts.name,
        ttl: opts.ttl,
      })
      if (result.success) return result.data!
      lastError.value = result.error || 'Initiate failed'
      return null
    } finally {
      busy.value = false
    }
  }

  // Join a pairing code (configures tunnel on server)
  async function join(code: string, opts: { name?: string } = {}): Promise<PairCompleteResult | null> {
    busy.value = true
    lastError.value = null
    try {
      const password = await getPassword()
      const result: ActionResult<PairCompleteResult> = await window.electron.ipcRenderer.invoke('wirewizard:join', {
        host: getHost(),
        username: getUsername(),
        password,
        code,
        name: opts.name,
      })
      if (result.success) return result.data!
      lastError.value = result.error || 'Join failed'
      return null
    } finally {
      busy.value = false
    }
  }

  // Poll for joiner (initiator checks if code was claimed)
  async function poll(code: string): Promise<PollResult | null> {
    try {
      const password = await getPassword()
      const result: ActionResult<PollResult> = await window.electron.ipcRenderer.invoke('wirewizard:poll', {
        host: getHost(),
        username: getUsername(),
        password,
        code,
      })
      if (result.success) return result.data!
      return null
    } catch {
      return null
    }
  }

  // Complete pairing (initiator side, after joiner claims)
  async function complete(code: string, peer: { publicKey: string; endpoint: string; localEndpoint?: string }): Promise<PairCompleteResult | null> {
    busy.value = true
    lastError.value = null
    try {
      const password = await getPassword()
      const result: ActionResult<PairCompleteResult> = await window.electron.ipcRenderer.invoke('wirewizard:complete', {
        host: getHost(),
        username: getUsername(),
        password,
        code,
        peerPubkey: peer.publicKey,
        peerEndpoint: peer.endpoint,
        peerLocalEndpoint: peer.localEndpoint,
      })
      if (result.success) return result.data!
      lastError.value = result.error || 'Complete failed'
      return null
    } finally {
      busy.value = false
    }
  }

  // Tear down a tunnel
  async function teardown(iface: string): Promise<boolean> {
    busy.value = true
    lastError.value = null
    try {
      const password = await getPassword()
      const result: ActionResult = await window.electron.ipcRenderer.invoke('wirewizard:teardown', {
        host: getHost(),
        username: getUsername(),
        password,
        iface,
      })
      if (result.success) return true
      lastError.value = result.error || 'Teardown failed'
      return false
    } finally {
      busy.value = false
    }
  }

  // Run preflight check
  async function preflight(iface?: string): Promise<{ healthy: boolean; output: string } | null> {
    try {
      const password = await getPassword()
      const result: ActionResult<{ healthy: boolean; output: string; error: string }> =
        await window.electron.ipcRenderer.invoke('wirewizard:preflight', {
          host: getHost(),
          username: getUsername(),
          password,
          iface,
        })
      if (result.success) return result.data!
      return null
    } catch {
      return null
    }
  }

  return {
    busy,
    lastError,
    status,
    fetchStatus,
    initiate,
    join,
    poll,
    complete,
    teardown,
    preflight,
  }
}
