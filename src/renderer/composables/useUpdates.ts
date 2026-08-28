import { ref, computed, watch } from 'vue'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'none'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateState = {
  status: UpdateStatus
  currentVersion?: string
  platform?: string
  version?: string
  releaseNotes?: string
  percent?: number
  message?: string
}

const CHANNELS = [
  'update:checking',
  'update:available',
  'update:none',
  'update:progress',
  'update:downloaded',
  'update:error',
] as const

const state = ref<UpdateState>({ status: 'idle' })
// Tracks the modal only; Settings always renders the current state.
const dismissed = ref(false)
// Background check failures stay silent; errors surface only after a click.
const userActed = ref(false)

let initialized = false

function onUpdate(_e: any, payload: UpdateState) {
  if (!payload) return
  state.value = payload
}

function init() {
  if (initialized) return
  initialized = true

  for (const ch of CHANNELS) {
    window.electron?.ipcRenderer.removeAllListeners?.(ch)
    window.electron?.ipcRenderer.on(ch, onUpdate)
  }

  window.electron?.ipcRenderer
    .invoke('update:status')
    .then((current: UpdateState) => {
      if (current) state.value = current
    })
    .catch(() => { /* updater unavailable */ })
}

// Re-surface the modal after "Continue in Background" once the download settles.
watch(
  () => state.value.status,
  (status, previous) => {
    if (status !== previous && (status === 'downloaded' || status === 'error')) {
      dismissed.value = false
    }
  },
)

export function useUpdates() {
  init()

  const percent = computed(() =>
    Math.min(100, Math.max(0, Math.round(state.value.percent ?? 0))),
  )

  const releaseNotes = computed(() =>
    (state.value.releaseNotes ?? '').replace(/<[^>]+>/g, '').trim(),
  )

  const isPending = computed(
    () =>
      state.value.status === 'available' ||
      state.value.status === 'downloading' ||
      state.value.status === 'downloaded',
  )

  const modalVisible = computed(() => {
    if (dismissed.value) return false
    if (state.value.status === 'error') return userActed.value
    return isPending.value
  })

  function dismissModal() {
    dismissed.value = true
  }

  function showModal() {
    dismissed.value = false
  }

  async function check() {
    try {
      return await window.electron?.ipcRenderer.invoke('update:check')
    } catch (err) {
      console.error('[updates] check failed', err)
      throw err
    }
  }

  async function download() {
    userActed.value = true
    try {
      return await window.electron?.ipcRenderer.invoke('update:download')
    } catch (err) {
      console.error('[updates] download failed', err)
    }
  }

  async function install() {
    userActed.value = true
    try {
      return await window.electron?.ipcRenderer.invoke('update:install')
    } catch (err) {
      console.error('[updates] install failed', err)
    }
  }

  return {
    updateState: state,
    percent,
    releaseNotes,
    isPending,
    modalVisible,
    dismissModal,
    showModal,
    check,
    download,
    install,
  }
}
