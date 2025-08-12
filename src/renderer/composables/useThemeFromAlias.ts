// src/renderer/composables/useThemeFromAlias.ts
import { ref, watchEffect } from 'vue'

type Theme = 'theme-homelab' | 'theme-professional' | 'theme-default'
type Division = 'homelab' | 'professional' | 'default'

const aliasToTheme: Record<string, Theme> = {
  homelab: 'theme-homelab',
  professional: 'theme-professional',
}

const themeToDivision: Record<Theme, Division> = {
  'theme-homelab': 'homelab',
  'theme-professional': 'professional',
  'theme-default': 'default',
}

const currentTheme = ref<Theme>('theme-homelab')      // default boot theme
const currentDivision = ref<Division>('homelab')

function setHtmlThemeClass(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('theme-default', 'theme-homelab', 'theme-professional')
  root.classList.add(theme)
}

watchEffect(() => {
  setHtmlThemeClass(currentTheme.value)
  currentDivision.value = themeToDivision[currentTheme.value]
})

/** Apply a theme using the 45Drives alias coming from the server (e.g. "homelab"|"professional") */
function applyThemeFromAlias(aliasStyle?: string) {
  const normalized = (aliasStyle || '').toLowerCase()
  currentTheme.value = aliasToTheme[normalized] ?? 'theme-homelab'
}

/** Directly set a theme (if you ever need to switch by hand) */
function setTheme(theme: Theme) {
  currentTheme.value = theme
}

export function useThemeFromAlias() {
  return {
    currentTheme,         // reactive (theme-homelab|theme-professional|theme-default)
    currentDivision,      // reactive (homelab|professional|default)
    applyThemeFromAlias,  // call with aliasStyle from server info
    setTheme,             // optional manual setter
  }
}
