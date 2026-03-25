<template>
    <div class="z-50">
        <button ref="menuButton" @click="toggle"
            class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <Bars3Icon class="w-5 h-5" />
        </button>

        <teleport to="body">
            <!-- Backdrop -->
            <Transition enter-from-class="opacity-0" leave-to-class="opacity-0"
                enter-active-class="transition-opacity duration-200"
                leave-active-class="transition-opacity duration-150">
                <div v-if="show" class="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
                    @click="show = false" />
            </Transition>

            <!-- Slide-out panel -->
            <Transition enter-from-class="translate-x-full" leave-to-class="translate-x-full"
                enter-active-class="transition-transform duration-250 ease-out"
                leave-active-class="transition-transform duration-200 ease-in">
                <div v-if="show" ref="menuRef"
                    class="fixed right-0 top-0 h-full w-72 bg-white dark:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700 shadow-xl z-50 flex flex-col overflow-y-auto text-left text-default">

                    <!-- Panel header -->
                    <div class="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-700">
                        <span class="text-sm font-semibold text-default">Menu</span>
                        <button @click="show = false"
                            class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                            <XMarkIcon class="w-4 h-4" />
                        </button>
                    </div>

                    <!-- Navigation section -->
                    <div class="px-4 pt-4 pb-2">
                        <p class="section-label">Navigation</p>
                        <nav class="flex flex-col gap-0.5">
                            <button class="nav-item" :class="{ 'nav-item-active': isActive('dashboard') }"
                                @click="goto('dashboard')">
                                <HomeIcon class="w-4 h-4 shrink-0" />
                                Dashboard
                            </button>
                            <button class="nav-item" :class="{ 'nav-item-active': isActive('setup') }"
                                @click="goto('setup')">
                                <ServerIcon class="w-4 h-4 shrink-0" />
                                Setup Wizard
                            </button>
                            <button class="nav-item" :class="{ 'nav-item-active': isActive('backup-manage') }"
                                @click="goto('backup-manage')">
                                <CircleStackIcon class="w-4 h-4 shrink-0" />
                                Backup Manager
                            </button>
                            <button class="nav-item" @click="openLogs">
                                <DocumentTextIcon class="w-4 h-4 shrink-0" />
                                View Logs
                            </button>
                            <button class="nav-item" @click="openSettings">
                                <Cog6ToothIcon class="w-4 h-4 shrink-0" />
                                Settings
                            </button>
                        </nav>
                    </div>

                    <!-- Appearance section -->
                    <div class="px-4 pt-3 pb-2">
                        <p class="section-label">Appearance</p>

                        <!-- Theme swatches -->
                        <div class="flex items-center gap-2 mb-3">
                            <button v-for="t in themes" :key="t.value"
                                class="w-8 h-8 rounded-full transition-all flex items-center justify-center"
                                :class="currentTheme === t.value ? 'ring-2 ring-offset-2 ring-slate-600 dark:ring-slate-400 dark:ring-offset-neutral-800' : 'opacity-60 hover:opacity-100'"
                                :style="{ backgroundColor: t.color }"
                                :title="t.label"
                                @click="selectTheme(t.value)">
                                <CheckIcon v-if="currentTheme === t.value" class="w-4 h-4 text-white" />
                            </button>
                        </div>

                        <!-- Dark mode segmented control -->
                        <div class="segmented-control w-full">
                            <button class="segmented-control-item flex-1 flex items-center justify-center gap-1.5"
                                :class="!darkMode ? 'segmented-control-item-active' : 'segmented-control-item-inactive'"
                                @click="darkMode && toggleDarkMode()">
                                <SunIcon class="w-4 h-4" />
                                Light
                            </button>
                            <button class="segmented-control-item flex-1 flex items-center justify-center gap-1.5"
                                :class="darkMode ? 'segmented-control-item-active' : 'segmented-control-item-inactive'"
                                @click="!darkMode && toggleDarkMode()">
                                <MoonIcon class="w-4 h-4" />
                                Dark
                            </button>
                        </div>
                    </div>

                    <!-- Spacer -->
                    <div class="flex-1" />

                    <!-- Footer -->
                    <div class="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 text-xs text-gray-400 dark:text-gray-500">
                        45Drives Storage Wizard
                    </div>
                </div>
            </Transition>
        </teleport>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
    Bars3Icon, HomeIcon, ServerIcon, CircleStackIcon,
    DocumentTextIcon, MoonIcon, SunIcon, XMarkIcon, CheckIcon, Cog6ToothIcon
} from '@heroicons/vue/24/outline'
import { toggleDarkMode, useDarkModeState } from '@45drives/houston-common-ui'
import { useThemeFromAlias } from '../composables/useThemeFromAlias'
import { useLogModal } from '../composables/useLogModal'
import { useSettingsModal } from '../composables/useSettingsModal'

const router = useRouter()
const route = useRoute()
const darkMode = useDarkModeState()
const { setTheme, currentTheme } = useThemeFromAlias()
const { openLogModal } = useLogModal()
const { openSettingsModal } = useSettingsModal()

const themes = [
    { value: 'theme-default' as const, label: '45Drives', color: '#D92B2F' },
    { value: 'theme-homelab' as const, label: '45Homelab', color: '#2563EB' },
    { value: 'theme-professional' as const, label: '45Pro', color: '#65A443' },
    { value: 'theme-studio' as const, label: '45Studio', color: '#6557A5' },
]

const show = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLElement | null>(null)

const toggle = () => {
    show.value = !show.value
}

const handleKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') show.value = false }

onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown)
})

function goto(name: string) {
    router.push({ name })
    show.value = false
}

function openLogs() {
    openLogModal()
    show.value = false
}

function openSettings() {
    openSettingsModal()
    show.value = false
}

function selectTheme(theme: 'theme-default' | 'theme-homelab' | 'theme-professional' | 'theme-studio') {
    setTheme(theme)
}

const isActive = (name: string) => route.name === name
</script>

<style scoped>
.section-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgb(156 163 175); /* gray-400 */
    margin-bottom: 0.5rem;
}
:root.dark .section-label {
    color: rgb(107 114 128); /* gray-500 */
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(55 65 81); /* gray-700 */
    transition: all 0.15s ease;
    border-left: 2px solid transparent;
}
:root.dark .nav-item {
    color: rgb(209 213 219); /* gray-300 */
}
.nav-item:hover {
    background-color: rgb(249 250 251); /* gray-50 */
}
:root.dark .nav-item:hover {
    background-color: rgba(255,255,255,0.06);
}

.nav-item-active {
    background-color: rgba(71, 85, 105, 0.08); /* slate-600/8% */
    color: rgb(71 85 105); /* slate-600 */
    font-weight: 600;
    border-left-color: rgb(71 85 105);
}
:root.dark .nav-item-active {
    background-color: rgba(148, 163, 184, 0.1); /* slate-400/10% */
    color: rgb(148 163 184); /* slate-400 */
    border-left-color: rgb(148 163 184);
}
</style>
