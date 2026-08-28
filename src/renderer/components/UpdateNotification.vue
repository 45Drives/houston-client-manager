<template>
  <transition
    enter-active-class="transition ease-out duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition ease-in duration-150"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="backdropDismiss">
      <div
        class="bg-default rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-md mx-4 overflow-hidden text-left">

        <div class="px-6 pt-5 pb-4 flex items-start gap-3">
          <div class="shrink-0 mt-0.5 w-9 h-9 rounded-full flex items-center justify-center"
            :class="state.status === 'error' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'">
            <ExclamationTriangleIcon v-if="state.status === 'error'" class="w-5 h-5 text-red-600 dark:text-red-400" />
            <CheckCircleIcon v-else-if="state.status === 'downloaded'" class="w-5 h-5 text-green-600 dark:text-green-400" />
            <ArrowDownTrayIcon v-else class="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-bold text-default">{{ title }}</h2>
            <p class="text-sm text-muted mt-1">{{ subtitle }}</p>
          </div>
          <button v-if="state.status !== 'downloading'" class="text-muted hover:text-default shrink-0" title="Dismiss"
            @click="dismiss">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>

        <div v-if="state.status === 'downloading'" class="px-6 pb-4">
          <div class="h-2 w-full rounded-full bg-well overflow-hidden">
            <div class="h-full bg-green-600 dark:bg-green-500 transition-all duration-200" :style="{ width: `${percent}%` }" />
          </div>
          <p class="text-xs text-muted mt-2">{{ percent }}% complete</p>
        </div>

        <div v-else-if="state.status === 'available' && releaseNotes"
          class="px-6 pb-4 max-h-40 overflow-y-auto text-xs text-muted whitespace-pre-line">
          {{ releaseNotes }}
        </div>

        <div v-if="state.status === 'downloaded'" class="px-6 pb-4">
          <div
            class="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 flex items-start gap-2.5">
            <LockClosedIcon class="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div class="text-xs text-default">
              <p class="font-semibold">{{ installNote.title }}</p>
              <p class="text-muted mt-0.5">{{ installNote.body }}</p>
            </div>
          </div>
        </div>

        <div
          class="px-6 py-4 border-t border-neutral-200 dark:border-neutral-700 flex justify-end gap-2 bg-neutral-50 dark:bg-neutral-800/50">
          <template v-if="state.status === 'available'">
            <button class="btn btn-secondary h-fit" @click="dismiss">Dismiss</button>
            <button class="btn btn-primary h-fit" @click="download">Download Update</button>
          </template>
          <template v-else-if="state.status === 'downloading'">
            <button class="btn btn-secondary h-fit" @click="dismiss">Continue in Background</button>
          </template>
          <template v-else-if="state.status === 'downloaded'">
            <button class="btn btn-secondary h-fit" @click="dismiss">Later</button>
            <button class="btn btn-primary h-fit" @click="install">{{ installLabel }}</button>
          </template>
          <template v-else>
            <button class="btn btn-secondary h-fit" @click="dismiss">Close</button>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'

type UpdateState = {
  status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  currentVersion?: string
  platform?: string
  version?: string
  releaseNotes?: string
  percent?: number
  message?: string
}

const state = ref<UpdateState>({ status: 'idle' })
const hidden = ref(false)
// Background check failures stay silent; errors are only shown after a click.
const userActed = ref(false)

const percent = computed(() => Math.min(100, Math.max(0, Math.round(state.value.percent ?? 0))))

const releaseNotes = computed(() => (state.value.releaseNotes ?? '').replace(/<[^>]+>/g, '').trim())

const visible = computed(() => {
  if (hidden.value) return false
  const s = state.value.status
  if (s === 'error') return userActed.value
  return s === 'available' || s === 'downloading' || s === 'downloaded'
})

const title = computed(() => {
  switch (state.value.status) {
    case 'downloaded': return 'Update Ready to Install'
    case 'downloading': return 'Downloading Update'
    case 'error': return 'Update Failed'
    default: return 'Update Available'
  }
})

const subtitle = computed(() => {
  switch (state.value.status) {
    case 'downloaded':
      return `Version ${state.value.version} has been downloaded and is ready to install.`
    case 'downloading':
      return `Getting version ${state.value.version ?? ''} ready…`
    case 'error':
      return state.value.message || 'Please try again later.'
    default:
      return `Version ${state.value.version} is available. You are on ${state.value.currentVersion}.`
  }
})

const installLabel = computed(() =>
  state.value.platform === 'linux' ? 'Install Now' : 'Restart & Install',
)

const installNote = computed(() => {
  switch (state.value.platform) {
    case 'linux':
      return {
        title: 'Your computer will ask for your password',
        body: 'Installing replaces the 45Drives Storage Wizard system package, which needs administrator access. Enter the password for this computer — not for a server.',
      }
    case 'win32':
      return {
        title: 'The app will close and reopen',
        body: 'The installer runs in the background and the Storage Wizard reopens automatically when it finishes. Windows may briefly show a security prompt.',
      }
    case 'darwin':
      return {
        title: 'The app will close and reopen',
        body: 'macOS applies the update and the Storage Wizard reopens automatically. If you launched the app from its disk image, move it to Applications first.',
      }
    default:
      return {
        title: 'The app will close and reopen',
        body: 'The Storage Wizard restarts to finish installing the update.',
      }
  }
})

function dismiss() {
  hidden.value = true
}

function backdropDismiss() {
  if (state.value.status !== 'downloading') dismiss()
}

async function download() {
  userActed.value = true
  try {
    await window.electron?.ipcRenderer.invoke('update:download')
  } catch (err) {
    console.error('[updates] download failed', err)
  }
}

async function install() {
  userActed.value = true
  try {
    await window.electron?.ipcRenderer.invoke('update:install')
  } catch (err) {
    console.error('[updates] install failed', err)
  }
}

const channels = ['update:checking', 'update:available', 'update:none', 'update:progress', 'update:downloaded', 'update:error'] as const

function onUpdate(_e: any, payload: UpdateState) {
  if (!payload) return
  state.value = payload
}

// Re-surface after "Continue in Background" once the download finishes or fails.
watch(() => state.value.status, (status, previous) => {
  if (status !== previous && (status === 'downloaded' || status === 'error')) hidden.value = false
})

onMounted(async () => {
  for (const ch of channels) {
    window.electron?.ipcRenderer.removeAllListeners?.(ch)
    window.electron?.ipcRenderer.on(ch, onUpdate)
  }
  try {
    const current = await window.electron?.ipcRenderer.invoke('update:status')
    if (current) state.value = current
  } catch { /* updater unavailable */ }
})

onBeforeUnmount(() => {
  for (const ch of channels) window.electron?.ipcRenderer.removeListener?.(ch, onUpdate)
})
</script>
