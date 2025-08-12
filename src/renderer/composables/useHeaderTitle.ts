// src/renderer/composables/useHeaderTitle.ts
import { ref } from 'vue'

const _headerTitle = ref<string>('')

export function useHeaderTitle() {
    const setHeaderTitle = (title: string) => { _headerTitle.value = title }
    const clearHeaderTitle = () => { _headerTitle.value = '' }
    return { headerTitle: _headerTitle, setHeaderTitle, clearHeaderTitle }
}
