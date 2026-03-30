import { ref, watchEffect } from 'vue'

type Theme = 'theme-homelab' | 'theme-professional' | 'theme-default' | 'theme-studio'
type Division = 'studio' | 'homelab' | 'professional' | 'default'

const THEME_STORAGE_KEY = 'houston:theme'
const validThemes: Theme[] = ['theme-homelab', 'theme-professional', 'theme-default', 'theme-studio']

const aliasToTheme: Record<string, Theme> = {
  homelab: 'theme-homelab',
  professional: 'theme-professional',
  default: 'theme-default',
}

const themeToDivision: Record<Theme, Division> = {
  'theme-homelab': 'homelab',
  'theme-professional': 'professional',
  'theme-studio': 'studio',
  'theme-default': 'default'
}

function loadPersistedTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored && validThemes.includes(stored as Theme)) return stored as Theme
  return 'theme-homelab'
}

const currentTheme = ref<Theme>(loadPersistedTheme())
const currentDivision = ref<Division>(themeToDivision[currentTheme.value])

function setHtmlThemeClass(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('theme-default', 'theme-homelab', 'theme-professional', 'theme-studio')
  root.classList.add(theme)
}

watchEffect(() => {
  setHtmlThemeClass(currentTheme.value)
  currentDivision.value = themeToDivision[currentTheme.value]
  localStorage.setItem(THEME_STORAGE_KEY, currentTheme.value)
})

/** Apply a theme using the 45Drives alias coming from the server (e.g. "homelab"|"professional") */
function applyThemeFromAlias(aliasStyle?: string) {
  const normalized = (aliasStyle || '').toLowerCase()
  currentTheme.value = aliasToTheme[normalized] ?? 'theme-homelab'
}

/** Directly set a theme */
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
