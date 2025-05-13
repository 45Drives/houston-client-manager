<template>
    <div class="z-50">
        <button ref="menuButton" @click="toggle" class="btn bg-well hover:bg-accent text-default p-2 rounded-full">
            <Bars3Icon class="w-6 h-6" />
        </button>

        <teleport to="body">
            <div v-if="show"
                class="fixed z-50 right-0 mt-2 w-60 bg-well shadow-lg rounded-lg border p-4 text-left text-default"
                ref="menuRef" :style="{
                    top: `${menuPosition.top}px`,
                    left: `${menuPosition.left}px`
                }">

                <div v-if="!server" class="mb-2 text-center items-center">
                    <p class="text-xs text-default mb-1">Select Wizard</p>
                    <button class="btn btn-secondary wizard-btn w-full mb-1" :class="buttonClass('storage')"
                        @click="showWizard('storage')">Setup Wizard</button>
                    <button class="btn btn-secondary wizard-btn w-full mb-1" :class="buttonClass('backup')"
                        @click="showWizard('backup')">Backup Client</button>
                    <button class="btn btn-secondary wizard-btn w-full mb-1" :class="buttonClass('restore-backup')"
                        @click="showWizard('restore-backup')">Restore Backup</button>
                </div>
                

                <div class="mb-2 text-center items-center">
                    <p class="text-xs text-default mb-1">Themes</p>
                    <button class="btn theme-btn theme-btn-default w-full mb-1"
                        @click="setTheme('theme-default')">Default</button>
                    <button class="btn theme-btn theme-btn-homelab w-full mb-1"
                        @click="setTheme('theme-homelab')">45Homelab</button>
                    <button class="btn theme-btn theme-btn-professional w-full mb-1"
                        @click="setTheme('theme-professional')">45Pro</button>
                </div>

                <div class="mb-2 items-center">
                    <button
                        class="theme-btn text-xs w-full mb-1 flex flex-row items-center text-center justify-center space-x-2 text-white rounded-md"
                        @click="toggleDarkMode()" :class="darkModeButtonClass">
                        <transition name="fade" mode="out-in">
                            <component :is="darkMode ? SunIcon : MoonIcon" class="w-6 h-6" />
                        </transition>
                        <span class="mb-0.5 font-semibold" :class="darkMode ? 'ml-5' : ' ml-4'">{{ darkModeLabel
                            }}</span>
                    </button>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, inject, type Ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { IPCRouter } from '@45drives/houston-common-lib'
import { Bars3Icon, MoonIcon, SunIcon } from '@heroicons/vue/24/outline'
import { toggleDarkMode, useDarkModeState } from '../composables/useDarkModeState'
import { currentWizardInjectionKey } from '../keys/injection-keys';

interface GlobalSetupWizardMenuProps {
    server?: boolean;
}

const props = defineProps<GlobalSetupWizardMenuProps>();

const currentWizard = inject(
    currentWizardInjectionKey,
    ref('storage')
) as Ref<'storage' | 'backup' | 'restore-backup' | null>;


if (!currentWizard) {
    throw new Error("currentWizard was not provided");
}

const buttonClass = (type: 'storage' | 'backup' | 'restore-backup') => {
    return [
        'wizard-btn',
        currentWizard?.value === type ? 'animate-glow' : ''
    ].join(' ')
}

// const buttonClass = (type: 'storage' | 'backup' | 'restore-backup') => {
//     return currentWizard?.value === type
//         ? 'animate-glow'
//         : '';
// };

const show = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLElement | null>(null)
const menuPosition = ref({ top: 0, left: 0 })

const toggle = async () => {
    show.value = !show.value

    if (show.value && menuButton.value) {
        await nextTick()
        const rect = menuButton.value.getBoundingClientRect()
        menuPosition.value = {
            top: rect.bottom + 8,
            left: rect.right - 240, // assuming menu is 240px wide
        }
    }
}

const handleClickOutside = (event: MouseEvent) => {
    const path = event.composedPath()
    if (
        show.value &&
        menuRef.value &&
        !path.includes(menuRef.value) &&
        !path.includes(menuButton.value as Node)
    ) {
        show.value = false
    }
}

const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
        show.value = false
    }
}

onMounted(() => {
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
})

const darkMode = useDarkModeState()
const darkModeLabel = computed(() => (darkMode.value ? "Light Mode" : "Dark Mode"))
const darkModeButtonClass = computed(() => (darkMode.value ? "btn-sun" : "btn-moon"))

function setTheme(theme: 'theme-default' | 'theme-homelab' | 'theme-professional') {
    const root = document.documentElement
    root.classList.remove('theme-default', 'theme-homelab', 'theme-professional')
    root.classList.add(theme)
}

function showWizard(type: 'storage' | 'backup' | 'restore-backup') {
    if (currentWizard.value === type) {
        // Reassign to force update (quickly unset then set again)
        currentWizard.value = null;
        requestAnimationFrame(() => {
            currentWizard.value = type;
        });
    } else {
        currentWizard.value = type;
        IPCRouter.getInstance().send('renderer', 'action', `show_${type}_setup_wizard`);
    }
}
</script>

<style scoped>
.btn-moon {
    background-color: #374151;
    border: 1px solid #1f2937;
    color: #e5e7eb;
    transition: all 0.2s ease-in-out;
}

.btn-moon:hover {
    background-color: #1f2937;
    border-color: #111827;
    color: #ffffff;
}

.btn-sun {
    background-color: #fef9c3;
    border: 1px solid #fcd34d;
    color: #1f2937;
    transition: all 0.2s ease-in-out;
}

.btn-sun:hover {
    background-color: #fde68a;
    border-color: #fbbf24;
    color: #111827;
}

.btn-sun,
.btn-moon {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    /* rounded-md */
    font-weight: 500;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}



/* THEME BUTTONS: Theme Color Swatches */

.theme-btn-default {
    background-color: #D92B2F;
    border: 1px solid #D92B2F;
    color: white;
    transition: all 0.2s ease-in-out;
}

.theme-btn-default:hover {
    background-color: #b02428;
    border-color: #b02428;
}

.theme-btn-homelab {
    background-color: #2563EB;
    border: 1px solid #2563EB;
    color: white;
    transition: all 0.2s ease-in-out;
}

.theme-btn-homelab:hover {
    background-color: #1E4FCB;
    border-color: #1E4FCB;
}

.theme-btn-professional {
    background-color: #65A443;
    border: 1px solid #65A443;
    color: white;
    transition: all 0.2s ease-in-out;
}

.theme-btn-professional:hover {
    background-color: #4F8F37;
    border-color: #4F8F37;
}

.theme-btn {
    font-size: 0.75rem;
    font-weight: bold;
    padding: 0.3rem 0.5rem;
    border-radius: 0.25rem;
    opacity: 0.8;
    transition: all 0.2s ease-in-out;
}

.theme-btn:hover {
    opacity: 1;
    transform: scale(1.02);
}
</style>
