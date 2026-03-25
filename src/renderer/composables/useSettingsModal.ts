import { ref } from 'vue'

type SettingsSection = 'servers' | 'display' | 'connection' | 'advanced';

const _open = ref(false)
const _initialSection = ref<SettingsSection>('servers')

export function useSettingsModal() {
  function openSettingsModal(section?: SettingsSection) {
    _initialSection.value = section ?? 'servers'
    _open.value = true
  }

  function closeSettingsModal() {
    _open.value = false
  }

  return {
    settingsModalOpen: _open,
    settingsInitialSection: _initialSection,
    openSettingsModal,
    closeSettingsModal,
  }
}
