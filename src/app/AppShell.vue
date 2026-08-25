<template>
  <div
    class="w-screen h-screen overflow-hidden flex flex-col items-center justify-center text-default bg-default text-center">
    <header v-if="!hideHeader" class="relative flex items-center justify-center w-full h-16 shrink-0 bg-plugin-header shadow-sm border-b border-neutral-200 dark:border-neutral-700 overflow-hidden">
      <!-- Left (logo + breadcrumb) -->
      <div id="app-header-left" class="absolute left-0 p-1 px-4 rounded-l flex items-center gap-3">
        <button @click="router.push({ name: 'dashboard' })" class="hover:opacity-80 transition-opacity" title="Go to Dashboard">
          <DynamicBrandingLogo :division="divisionCode" :height="12" />
        </button>
        <div class="border-l border-default pl-3 hidden sm:block">
          <AppBreadcrumb />
        </div>
      </div>

      <!-- Center (title) -->
      <div id="app-header-title" class="text-sm sm:text-lg font-medium text-center">
         {{ headerTitle || (route.meta.title as string) || 'Storage Wizard' }}
      </div>

      <!-- Right (menu) -->
      <div id="app-header-right" class="absolute right-3 top-1/2 -translate-y-1/2">
        <GlobalSetupWizardMenu />
      </div>
    </header>

    <main class="flex-1 min-h-0 w-full">
      <router-view />
    </main>
    <GlobalModalConfirm />
    <NotificationView />
    <LogModal />
    <SettingsModal :open="settingsModalOpen" @close="closeSettingsModal" @serversChanged="() => {}" />
    <GuidedTour v-if="activeTour" :steps="activeTour.steps" :active="true" @done="finishTour" @skip="finishTour" />
  </div>
</template>

<script setup lang="ts">
import { ref, provide, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { DynamicBrandingLogo, GlobalModalConfirm, NotificationView, reportError, reportSuccess } from '@45drives/houston-common-ui'
import GlobalSetupWizardMenu from '../renderer/components/GlobalSetupWizardMenu.vue'
import AppBreadcrumb from '../renderer/components/AppBreadcrumb.vue'
import LogModal from '../renderer/components/LogModal.vue'
import SettingsModal from '../renderer/views/backupSetupWizard/SettingsModal.vue'
import GuidedTour from '../renderer/components/GuidedTour.vue'
import { divisionCodeInjectionKey, currentServerInjectionKey, discoveryStateInjectionKey, discoveryRescanInjectionKey, thisOsInjectionKey } from '../renderer/keys/injection-keys'
import type { Server, DivisionType, DiscoveryState } from '../renderer/types'
import { useServerDiscovery } from '../renderer/composables/useServerDiscovery'
import { useIpcActions } from '../renderer/composables/useIpcActions'
import { useThemeFromAlias } from '../renderer/composables/useThemeFromAlias'
import { useRoute, useRouter } from 'vue-router'
import { useHeaderTitle } from '../renderer/composables/useHeaderTitle'
import { useSettingsModal } from '../renderer/composables/useSettingsModal'
import { useTourManager } from '../renderer/composables/useTourManager'
import { registerIpcActionListener } from "../renderer/composables/registerIpcActionListener";

// provide shared refs
const currentServer = ref<Server | null>(null)
const divisionCode = ref<DivisionType>('default')
const thisOS = ref<string>('')
const route = useRoute()
const router = useRouter()
const hideHeader = computed(() => route.meta.hideHeader === true)
const { headerTitle } = useHeaderTitle()
const { settingsModalOpen, closeSettingsModal } = useSettingsModal()
const { activeTour, finishTour } = useTourManager()

provide(currentServerInjectionKey, currentServer)
provide(divisionCodeInjectionKey, divisionCode)
provide(thisOsInjectionKey, thisOS)

// discovery (optional to provide globally)
const { discoveryState, rescan } = useServerDiscovery()
provide(discoveryStateInjectionKey, discoveryState as DiscoveryState)
provide(discoveryRescanInjectionKey, rescan)


// THEME: hook composable and reflect division into provided ref
const { currentTheme, currentDivision, applyThemeFromAlias } = useThemeFromAlias()

watch(currentDivision, (d) => { divisionCode.value = d as DivisionType }, { immediate: true })

// Apply theme when the connected server changes
watch(currentServer, (srv) => {
  if (srv?.serverInfo?.aliasStyle) applyThemeFromAlias(srv.serverInfo.aliasStyle)
})

let unregisterIpcListener: (() => void) | null = null

// IPC → router navigation (uses currentServer IP)
useIpcActions(() => currentServer.value)

// (optional) global notifications
onMounted(() => {
  // IPC → router navigation listener
  unregisterIpcListener = registerIpcActionListener({
    vueRouter: router,
    setCurrentWizard: (w) => { /* optional: track wizard here if needed */ },
    setShowWebView: (v) => { /* optional: track webview toggle */ },
    // pass old helpers if available:
    // openStorageSetup,
    // openHoustonWindow,
    // waitForServerRebootAndShowWizard,
    // waitForServerRebootAndOpenHouston
  })

  const isJson = (s: string) => { try { JSON.parse(s); return true } catch { return false } }
  const isErrorMessage = (s: string) => s.startsWith('Error') || /\bfailed\b/i.test(s)
  const notificationHandler = (_e: any, message: string) => {
    if (isErrorMessage(message)) return reportError(new Error(message))
    if (isJson(message)) {
      const m = JSON.parse(message)
      m.error ? reportError(new Error(m.error)) : reportSuccess(message)
    } else reportSuccess(message)
  }
  // Remove any stale listener (HMR) before adding
  window.electron?.ipcRenderer.removeAllListeners?.('notification')
  window.electron?.ipcRenderer.on('notification', notificationHandler)
})

onBeforeUnmount(() => {
  unregisterIpcListener?.()
  window.electron?.ipcRenderer.removeAllListeners?.('notification')
})
</script>
