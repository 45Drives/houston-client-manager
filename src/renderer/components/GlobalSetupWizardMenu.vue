<template>
    <div class="z-50">
        <button ref="menuButton" @click="toggle" class="btn bg-well hover:bg-accent text-default p-2 rounded-full">
            <Bars3Icon class="w-6 h-6" />
        </button>

        <teleport to="body">
            <div v-if="show"
                class="fixed z-50 right-0 w-60 bg-well -mt-1 shadow-lg rounded-lg border border-default p-3 text-left text-default"
                ref="menuRef" :style="{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }">

                <!-- Navigation -->
                <p class="text-xs text-muted mb-2 px-1">Quick Navigation</p>

                <button class="menu-item" :class="{ 'menu-item-active': isActive('dashboard') }"
                    @click="goto('dashboard')">
                    <HomeIcon class="w-4 h-4" />
                    Dashboard
                </button>
                <button class="menu-item" :class="{ 'menu-item-active': isActive('setup') }"
                    @click="goto('setup')">
                    <ServerIcon class="w-4 h-4" />
                    Setup Wizard
                </button>
                <button class="menu-item" :class="{ 'menu-item-active': isActive('backup-manage') }"
                    @click="goto('backup-manage')">
                    <CircleStackIcon class="w-4 h-4" />
                    Backup Manager
                </button>
                <button class="menu-item" @click="openLogs">
                    <DocumentTextIcon class="w-4 h-4" />
                    View Logs
                </button>

                <hr class="my-2 border-default" />

                <!-- Themes -->
                <p class="text-xs text-muted mb-2 px-1">Theme</p>
                <div class="grid grid-cols-2 gap-1.5 px-1 mb-2">
                    <button v-for="t in themes" :key="t.value"
                        class="px-2 py-1.5 rounded text-xs font-semibold text-white transition-all"
                        :class="currentTheme === t.value ? 'ring-2 ring-offset-1 ring-primary' : 'opacity-75 hover:opacity-100'"
                        :style="{ backgroundColor: t.color }"
                        @click="selectTheme(t.value)">
                        {{ t.label }}
                    </button>
                </div>

                <!-- Dark mode -->
                <button class="menu-item justify-center gap-2" @click="toggleDarkMode()">
                    <component :is="darkMode ? SunIcon : MoonIcon" class="w-4 h-4" />
                    {{ darkMode ? 'Light Mode' : 'Dark Mode' }}
                </button>
            </div>
        </teleport>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
    Bars3Icon, HomeIcon, ServerIcon, CircleStackIcon,
    DocumentTextIcon, MoonIcon, SunIcon
} from '@heroicons/vue/24/outline'
import { toggleDarkMode, useDarkModeState } from '@45drives/houston-common-ui'
import { useThemeFromAlias } from '../composables/useThemeFromAlias'
import { useLogModal } from '../composables/useLogModal'

const router = useRouter()
const route = useRoute()
const darkMode = useDarkModeState()
const { setTheme, currentTheme } = useThemeFromAlias()
const { openLogModal } = useLogModal()

const themes = [
    { value: 'theme-default' as const, label: 'Default', color: '#D92B2F' },
    { value: 'theme-homelab' as const, label: '45Homelab', color: '#2563EB' },
    { value: 'theme-professional' as const, label: '45Pro', color: '#65A443' },
    { value: 'theme-studio' as const, label: '45Studio', color: '#6557A5' },
]

const show = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLElement | null>(null)
const menuPosition = ref({ top: 0, left: 0 })

const toggle = async () => {
    show.value = !show.value
    if (show.value && menuButton.value) {
        await nextTick()
        const rect = menuButton.value.getBoundingClientRect()
        menuPosition.value = { top: rect.bottom + 8, left: rect.right - 240 }
    }
}

const handleClickOutside = (event: MouseEvent) => {
    const path = event.composedPath()
    if (show.value && menuRef.value && !path.includes(menuRef.value) && !path.includes(menuButton.value as Node)) {
        show.value = false
    }
}
const handleKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') show.value = false }

onMounted(() => {
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside)
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

function selectTheme(theme: 'theme-default' | 'theme-homelab' | 'theme-professional' | 'theme-studio') {
    setTheme(theme)
}

const isActive = (name: string) => route.name === name
</script>

<style scoped>
.menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background-color 0.15s ease;
}
.menu-item:hover {
    background-color: rgba(0,0,0,0.05);
}
:root.dark .menu-item:hover {
    background-color: rgba(255,255,255,0.08);
}
.menu-item-active {
    background-color: rgba(0,0,0,0.08);
    font-weight: 600;
}
:root.dark .menu-item-active {
    background-color: rgba(255,255,255,0.1);
}
</style>
