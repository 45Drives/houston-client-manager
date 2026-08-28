<template>
  <transition
    enter-active-class="transition ease-out duration-200"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition ease-in duration-150"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2">
    <div v-if="visible"
      class="fixed bottom-4 right-4 z-50 w-80 max-w-[90vw] text-left bg-default text-default border border-default rounded-lg shadow-lg p-4">
      <div class="flex items-start gap-3">
        <ArrowDownTrayIcon class="w-6 h-6 shrink-0 text-green-600 dark:text-green-400 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm">{{ title }}</p>
          <p class="text-xs text-muted mt-1">{{ subtitle }}</p>

          <div v-if="state.status === 'downloading'" class="mt-2 h-1.5 w-full rounded bg-well overflow-hidden">
            <div class="h-full bg-green-600 dark:bg-green-500 transition-all duration-200" :style="{ width: `${percent}%` }" />
          </div>

          <div class="flex gap-2 mt-3">
            <button v-if="state.status === 'downloaded'" class="btn btn-sm btn-primary h-fit" @click="install">
              Restart &amp; Install
            </button>
            <button class="btn btn-sm btn-secondary h-fit" @click="dismiss">
              {{ state.status === 'downloaded' ? 'Later' : 'Dismiss' }}
            </button>
          </div>
        </div>
        <button class="text-muted hover:text-default" title="Dismiss" @click="dismiss">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/vue/24/outline'

type UpdateState = {
  status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  currentVersion?: string
  version?: string
  percent?: number
  message?: string
}

const state = ref<UpdateState>({ status: 'idle' })
const dismissedVersion = ref<string | null>(null)

const percent = computed(() => Math.min(100, Math.max(0, Math.round(state.value.percent ?? 0))))

// 'checking' and 'none' stay silent — background checks should not interrupt the user.
const visible = computed(() => {
  const s = state.value.status
  if (s !== 'available' && s !== 'downloading' && s !== 'downloaded') return false
  return dismissedVersion.value !== (state.value.version ?? 'unknown')
})

const title = computed(() => {
  switch (state.value.status) {
    case 'downloaded': return `Update ready — v${state.value.version}`
    case 'downloading': return `Downloading v${state.value.version ?? ''}…`
    default: return `Update available — v${state.value.version}`
  }
})

const subtitle = computed(() => {
  switch (state.value.status) {
    case 'downloaded': return 'Restart the Storage Wizard to finish installing.'
    case 'downloading': return `${percent.value}% complete`
    default: return `You are on v${state.value.currentVersion}. The update is downloading now.`
  }
})

function dismiss() {
  dismissedVersion.value = state.value.version ?? 'unknown'
}

async function install() {
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
