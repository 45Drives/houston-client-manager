// src/renderer/composables/useHeader.ts
import { onMounted, onActivated, onDeactivated } from 'vue'
import { useHeaderTitle } from './useHeaderTitle'

export function useHeader(text: string, opts: { clearOnLeave?: boolean } = { clearOnLeave: false }) {
    const { setHeaderTitle, clearHeaderTitle } = useHeaderTitle()
    const apply = () => setHeaderTitle(text)

    onMounted(apply)
    onActivated(apply)

    // Only clear if you *really* want to show a default between views.
    if (opts.clearOnLeave) {
        onDeactivated(clearHeaderTitle)
    }
}
